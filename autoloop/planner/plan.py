"""Planner: asks Claude (headless, no tools, no MCP, no session) for the next experiment of the autonomous loop.
Context = policy, search space, cost model, feature catalog, ledger, champion state and the latest diagnostics.
The answer is checked mechanically (package validator, budget, novelty); a rejected answer goes back with the reason, at most twice.
usage: plan.py <run-id> <out-plan.json>"""
import hashlib,json,os,shutil,subprocess,sys,tempfile,time,types
from pathlib import Path
A=Path(__file__).resolve().parents[1];PKG=A/'pkg'
C=types.ModuleType('c');C.__file__=str(PKG/'common.py');exec(compile((PKG/'common.py').read_bytes(),'common.py','exec'),C.__dict__)
SYSTEM=("너는 버스 도착 시 잔여좌석 예보 모델을 개선하는 자율 실험 루프의 실험 플래너다. 사람에게 묻지 않고 스스로 다음 실험을 정한다.\n"
 "목표: 고정 데이터셋에서 DEV_S의 가중 MAE를 현재 챔피언보다 유의하게 낮추되, 보호 지표(학습에 없던 노선 MAE, 노선 평균 MAE, 실제 만석일 때 2석 미만 예보 비율, 10석 이상 오류 비율)를 나쁘게 하지 않는다.\n"
 "규칙: 탐색 범위와 비용 모델 안에서만 후보를 만든다. 봉인 H는 존재를 고려하지 말고 쓰지 않는다. 이미 해 본 후보를 반복하지 않는다. "
 "가설은 한국어로, 장부와 진단의 구체적 근거를 들어 쓴다. 한 실험에 여러 후보를 넣어 가설을 한 번에 가르는 대조를 만든다. "
 "예상 비용이 회당 예산을 넘지 않게 라운드와 후보 수를 고른다. 출력은 지정된 JSON 형식만 쓴다.")
def schema(feature_names):
    num={'type':'number'}
    cand={'type':'object','additionalProperties':False,'required':['candidate','kind','head','features','blocks','params'],
          'properties':{'candidate':{'type':'string','pattern':'^[A-Z][A-Z0-9_]{0,31}$'},'kind':{'enum':list(C.SEARCH['kinds'])},'head':{'enum':['SEAT','FULL']},
                        'features':{'anyOf':[{'enum':C.SEARCH['featureSets']},{'type':'array','items':{'enum':feature_names},'minItems':3}]},
                        'blocks':{'enum':C.SEARCH['blocks']},'objective':{'type':'string'},'params':{'type':'object','additionalProperties':{'anyOf':[num,{'type':'string'}]}},
                        'rounds':{'type':'integer'},'curve':{'type':'array','items':{'type':'integer'}},'quantileAlphas':{'type':'array','items':num},'note':{'type':'string'}}}
    return {'type':'object','additionalProperties':False,'required':['id','hypothesis','rationale','expectedEffect','candidates'],
            'properties':{'id':{'type':'string','pattern':'^[A-Z][A-Z0-9_]{2,40}$'},'hypothesis':{'type':'string'},'rationale':{'type':'string'},'expectedEffect':{'type':'string'},'candidates':{'type':'array','items':cand,'minItems':1,'maxItems':C.SEARCH['maxCandidates']}}}
def load_json(p,default=None):
    p=Path(p);return json.loads(p.read_bytes()) if p.exists() else default
def ledger_view():
    rows=[json.loads(l) for l in (A/'ledger.jsonl').read_text().splitlines() if l.strip()] if (A/'ledger.jsonl').exists() else []
    out=[]
    for r in rows:
        out.append({k:r.get(k) for k in ('runId','experimentId','hypothesis','status','estimatedUSD','actualUSD','championBefore','championAfter','candidates','failure')})
    return out
def prompt(run_id,state,policy,feature_names):
    diag=load_json(state['lastDiagnostics']) if state.get('lastDiagnostics') else None
    if diag:diag={'champion':diag.get('champion'),'featureImportance':diag.get('featureImportance'),'candidates':diag.get('candidates')}
    budget=state['budget'];today=time.strftime('%Y-%m-%d',time.gmtime(time.time()+9*3600))
    remaining=min(policy['budget']['perRunUSD'],policy['budget']['perDayUSD']-budget.get('spentByDay',{}).get(today,0.0),policy['budget']['totalUSD']-budget.get('spentTotal',0))
    ctx={'runId':run_id,'policy':{k:policy[k] for k in ('objective','gate','features','forbidden')},
         'searchSpace':C.SEARCH,'baseParams':C.BASE_PARAMS,'costModel':{'fixedSeconds':C.FIXED_SECONDS,'secondsPerRoundByDepth':C.SECONDS_PER_ROUND,'matrixSecondsPerFeatureSet':C.MATRIX_SECONDS,'linearSeconds':C.LINEAR_SECONDS,'hourlyUSD':C.HOURLY_USD,'margin':1.25,'perRunBudgetUSD':round(remaining,3),'note':'quantile objectives multiply per-round time by the number of alphas; ROUTE_HORIZON blocks multiply by 1.6 and add matrix time'},
         'featureCatalog':load_json(A/'planner/feature_catalog.json'),'champion':{k:v for k,v in state['champion'].items() if not k.startswith('fullDev')},'consecutiveNoImprovement':state.get('consecutiveNoImprovement',0),
         'ledger':ledger_view(),'incidents':load_json(A/'incidents.json',[]),'latestDiagnostics':diag,'initialIdeas':load_json(A/'planner/initial_ideas.json',[])}
    text=("아래 자료를 보고 다음 실험 하나를 설계하라. 자료는 JSON이다.\n\n"+json.dumps(ctx,ensure_ascii=False,indent=1)+
          "\n\n출력 형식: id(대문자), hypothesis(한국어 가설), rationale(근거: 장부·진단의 구체 수치), expectedEffect(기대 효과와 판정 기준), candidates(탐색 범위 안의 후보 목록). "
          "XGB 후보에는 objective, rounds, params.max_depth, params.eta가 반드시 있어야 한다. reg:quantileerror는 quantileAlphas에 0.5를 넣는다. LINEAR 후보 params는 ridge 하나만 둔다.")
    return text,remaining
KEY_HELPER=A/'planner/anthropic_key_helper.sh'
def call(text,feature_names,model,effort='high',auth='api',max_usd=1.0):
    base=['claude','-p','--model',model,'--effort',effort,'--tools','','--strict-mcp-config','--no-session-persistence','--max-budget-usd','%.2f'%max_usd,'--output-format','json','--json-schema',json.dumps(schema(feature_names)),'--system-prompt',SYSTEM]
    env={**os.environ,'CLAUDE_CODE_DISABLE_CLAUDE_MDS':'1','CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1'}
    for k in ('CLAUDE_CODE_EFFORT_LEVEL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'):env.pop(k,None)
    if auth=='api':cmd=base[:2]+['--bare','--settings',json.dumps({'apiKeyHelper':str(KEY_HELPER)})]+base[2:]
    else:cmd=base[:2]+['--setting-sources','project']+base[2:]
    cwd=tempfile.mkdtemp(prefix='autoloop-planner-')
    try:p=subprocess.run(cmd,input=text,capture_output=True,text=True,timeout=1800,cwd=cwd,env=env)
    finally:shutil.rmtree(cwd,ignore_errors=True)
    if p.returncode!=0:
        try:sub=json.loads(p.stdout).get('subtype')
        except Exception:sub=None
        raise RuntimeError('PLANNER_CLI_FAILED:'+str(sub)+':'+p.stderr[-300:])
    d=json.loads(p.stdout);
    if d.get('is_error') or not isinstance(d.get('structured_output'),dict):raise RuntimeError('PLANNER_NO_STRUCTURED_OUTPUT:'+str(d.get('result'))[:300])
    u=d.get('usage') or {}
    return d['structured_output'],{'costUSD':d.get('total_cost_usd'),'durationMs':d.get('duration_ms'),'turns':d.get('num_turns'),'model':model,'effort':effort,'auth':auth,
        'usage':{k:u.get(k) for k in ('input_tokens','cache_creation_input_tokens','cache_read_input_tokens','output_tokens')}|{'thinking_tokens':(u.get('output_tokens_details') or {}).get('thinking_tokens')}}
def novelty(exp):
    seen=set()
    for r in ledger_view():
        if r.get('status')!='COMPLETED':continue
        for c in r.get('candidates') or []:seen.add(json.dumps({k:v for k,v in c.get('spec',{}).items() if k not in ('candidate','note')},sort_keys=True))
    return [c['candidate'] for c in exp['candidates'] if json.dumps({k:v for k,v in c.items() if k not in ('candidate','note')},sort_keys=True) in seen]
def main(run_id,out_path):
    state=json.loads((A/'state.json').read_bytes());policy=json.loads((A/'policy.json').read_bytes())
    m8=json.loads(Path(state['featuresManifestLocal']).read_bytes());m9=json.loads(Path(state['stopDemandManifestLocal']).read_bytes());feature_names=m8['featureNames']+m9['featureNames']
    text,remaining=prompt(run_id,state,policy,feature_names);model=policy.get('planner',{}).get('model','fable');effort=policy.get('planner',{}).get('effort','high');auth=policy.get('planner',{}).get('auth','api');guard=float(policy.get('aiBudget',{}).get('perCallGuardUSD',1.0));attempts=[]
    for i in range(3):
        out,meta=call(text,feature_names,model,effort,auth,guard);exp={'id':out['id'],'hypothesis':out['hypothesis'],'candidates':out['candidates']}
        try:
            C.validate_experiment(exp,feature_names);usd=C.estimate_usd(exp)
            if usd>remaining:raise C.Stop('OVER_BUDGET:%.3f>%.3f'%(usd,remaining))
            dup=novelty(exp)
            if dup:raise C.Stop('REPEATED_CANDIDATES:'+','.join(dup))
            plan={'schema':'AUTOLOOP_PLAN/1','runId':run_id,'model':model,'promptSha256':hashlib.sha256(text.encode()).hexdigest(),'experiment':exp,'rationale':out['rationale'],'expectedEffect':out['expectedEffect'],'estimatedUSD':usd,'budgetRemainingUSD':remaining,'attempts':attempts+[{'accepted':True,**meta}],'createdAt':time.time()}
            Path(out_path).parent.mkdir(parents=True,exist_ok=True)
            with open(out_path,'x') as f:json.dump(plan,f,ensure_ascii=False,indent=1)
            print(json.dumps({'accepted':True,'experiment':exp['id'],'candidates':len(exp['candidates']),'estimatedUSD':usd}));return 0
        except C.Stop as e:
            attempts.append({'accepted':False,'reason':str(e),**meta})
            text=text+"\n\n직전 답은 검증에서 거부됐다. 사유: "+str(e)+"\n사유를 고친 실험을 다시 내라."
    with open(str(out_path)+'.rejected.json','x') as f:json.dump({'runId':run_id,'attempts':attempts},f,ensure_ascii=False,indent=1)
    print(json.dumps({'accepted':False,'attempts':attempts}));return 1
if __name__=='__main__':raise SystemExit(main(sys.argv[1],sys.argv[2]))
