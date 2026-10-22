"""Planner v2: designs the next experiment together with a pre-registration and calls Claude only through the AI gateway (role designer).
Reuses planner/plan.py (output schema, ledger view, novelty, JSON loader) and pkg/common.py (validate_experiment, estimate_usd) by importing plan.py from its path; plan.py itself is not changed.
Additions over plan.py: required preregistration and per-candidate note in the schema; journal digest, earlier plans' rationale and expected effect, and incidents in the context; validate_prereg and a Korean-text check on the human-facing fields.
Token economy: compact JSON, floats rounded to 5 significant digits, champion prediction pin and per-candidate slice weights (equal to the champion's) left out.
Prompts to the model are English; hypothesis, rationale, expectedEffect (and notes, reasons) are Korean for the site. A rejected answer goes back with the reason; a gateway refusal or failed call stops at once (never auto-resent).
design() (CLI --debate) runs the two-party review of ai/debate.py instead: author = this designer (context in the system prompt, local absolute paths stripped, candidate route/kstHour
diagnostics slices left out), reviewer = DESIGN_CHECKLIST, validate_artifact = check(). Config: policy.json 'debate' over DEBATE_DEFAULTS; the record is persisted to design-debate.json next to the plan.
Exit codes: 0 plan written (AGREED, plan carries a debate summary); 4 DEADLOCK or AUTHOR_INVALID (<out>.deadlock.json); 5 debate BUDGET, gateway AI-budget refusal or CLI max-budget stop; 1 any other refusal or gateway failure (<out>.rejected.json).
usage: planner_v2.py <run-id> <out-plan.json> [--attempts N] [--debate [--max-total-usd X]]"""
import hashlib,importlib.util,json,os,re,sys,time
from pathlib import Path
H=Path(__file__).resolve().parent
if str(H) not in sys.path:sys.path.insert(0,str(H))
import gateway as G,journal as J,debate as D
A=H.parent
def _load_plan_module():
    if 'autoloop_plan_v1' in sys.modules:return sys.modules['autoloop_plan_v1']
    s=importlib.util.spec_from_file_location('autoloop_plan_v1',A/'planner/plan.py');m=importlib.util.module_from_spec(s);sys.modules['autoloop_plan_v1']=m;s.loader.exec_module(m);return m
P=_load_plan_module();C=P.C
SYSTEM=("You are the experiment designer of an autonomous loop that improves a forecast of remaining bus seats when a bus reaches a target stop. No human answers questions; you decide the next experiment.\n"
 "Goal: lower DEV_S weighted MAE significantly versus the current champion without worsening the guards (unseenRouteMAE, routeMacroMAE, fullBusUnder2Share, over10Share).\n"
 "Rules: stay inside searchSpace and costModel; the sealed split H does not exist for you; never repeat a measured candidate; ground every claim in concrete numbers from ledger, journal, previousPlans or diagnostics; "
 "put several candidates in one experiment so the contrasts split the hypothesis in one run; keep the estimated cost within costModel.perRunBudgetUSD.\n"
 "Pre-register before results exist. Each prediction names one SEAT candidate, one metric, a direction and minEffect in the metric's absolute units (seats for MAE metrics, fraction 0-1 for shares). "
 "It is judged mechanically on the 95% block-bootstrap interval [lo,hi] of (candidate - champion): lower is SUPPORTED if hi < -minEffect, REFUTED if lo > -minEffect, otherwise INCONCLUSIVE; higher mirrors this. "
 "Use journal verdicts as evidence: do not retest a REFUTED idea without a new reason; INCONCLUSIVE is not REFUTED; INVALID carries no evidence.\n"
 "Write every free-text field (hypothesis, rationale, expectedEffect, note, why, refutedIf) in Korean for human readers. Output only the JSON of the given schema.")
TAIL=("\n\nOutput: id (uppercase), hypothesis, rationale (cite concrete numbers), expectedEffect (expected effect and decision criteria), candidates (each with a note on its role in the contrast), preregistration. "
 "XGB candidates need objective, rounds, params.max_depth and params.eta. reg:quantileerror needs quantileAlphas containing 0.5. LINEAR params hold only ridge. "
 "Predictions: 1-12, SEAT candidates of this experiment only, comparator CHAMPION, ids P1, P2, ...; skip controls you expect to show no effect. refutedIf: one sentence naming the result that would refute the hypothesis.")
KOREAN_FIELDS=('hypothesis','rationale','expectedEffect')
def schema(feature_names):
    s=json.loads(json.dumps(P.schema(feature_names)));cand=s['properties']['candidates']['items'];cand['required']=cand['required']+['note']
    s['properties']['preregistration']=json.loads(json.dumps(J.PREREG));s['required']=s['required']+['preregistration'];return s
def korean(text,min_hangul=10,min_ratio=0.25):
    h=len(re.findall('[가-힣]',text or ''));l=len(re.findall('[A-Za-z]',text or ''));return h>=min_hangul and h/(h+l)>=min_ratio
def previous_plans(run_id,n=3):
    out=[]
    for d in sorted((A/'runs').glob('AUTOLOOP_[0-9][0-9][0-9]')):
        if d.name>=run_id:continue
        p=P.load_json(d/'plan.json')
        if p:out.append({'runId':d.name,'experimentId':p['experiment']['id'],'rationale':(p.get('rationale') or '')[:1500],'expectedEffect':(p.get('expectedEffect') or '')[:1200],'preregistration':p.get('preregistration')})
    return out[-n:]
def remaining_gpu(state,policy):
    b=state['budget'];pb=policy['budget'];today=G.kst_day(time.time())
    return min(pb['perRunUSD'],pb['perDayUSD']-b.get('spentByDay',{}).get(today,0.0),pb['totalUSD']-b.get('spentTotal',0))
def context(run_id,state,policy):
    diag=P.load_json(state['lastDiagnostics']) if state.get('lastDiagnostics') else None
    if diag:
        cands={n:{k:[{f:r[f] for f in ('key','MAE','bias') if f in r} for r in rows] for k,rows in sl.items()} for n,sl in (diag.get('candidates') or {}).items()}
        diag={'champion':diag.get('champion'),'featureImportance':diag.get('featureImportance'),'candidates':cands,'note':'candidate slice rows share the champion row weights'}
    remaining=remaining_gpu(state,policy)
    ctx={'runId':run_id,'policy':{k:policy[k] for k in ('objective','gate','features','forbidden')},'searchSpace':C.SEARCH,'baseParams':C.BASE_PARAMS,
         'costModel':{'fixedSeconds':C.FIXED_SECONDS,'secondsPerRoundByDepth':C.SECONDS_PER_ROUND,'matrixSecondsPerFeatureSet':C.MATRIX_SECONDS,'linearSeconds':C.LINEAR_SECONDS,'hourlyUSD':C.HOURLY_USD,'margin':1.25,'perRunBudgetUSD':round(remaining,3),
                      'note':'quantile objectives multiply per-round time by the number of alphas; ROUTE_HORIZON blocks multiply by 1.6 and add matrix time'},
         'featureCatalog':P.load_json(A/'planner/feature_catalog.json'),'champion':{k:v for k,v in state['champion'].items() if not k.startswith('fullDev') and k!='predictions'},'consecutiveNoImprovement':state.get('consecutiveNoImprovement',0),
         'ledger':P.ledger_view(),'journal':J.digest(),'previousPlans':previous_plans(run_id),'incidents':P.load_json(A/'incidents.json',[]),'latestDiagnostics':diag,'initialIdeas':P.load_json(A/'planner/initial_ideas.json',[])}
    return ctx,remaining
def compact(v,digits=5):
    if isinstance(v,float):return float('%.*g'%(digits,v)) if v==v and v not in (float('inf'),float('-inf')) else None
    if isinstance(v,dict):return {k:compact(x,digits) for k,x in v.items()}
    if isinstance(v,list):return [compact(x,digits) for x in v]
    return v
def prompt(ctx):return "Design the next experiment from the JSON data below (floats rounded to 5 significant digits).\n\n"+json.dumps(compact(ctx),ensure_ascii=False,separators=(',',':'))+TAIL
def _attempt(meta):return {k:meta.get(k) for k in ('callId','costUSD','chargedUSD','durationMs','turns','model','effort','auth','usage','outputSha256') if k in meta}
def check(out,feature_names,remaining):
    try:exp={'id':out['id'],'hypothesis':out['hypothesis'],'candidates':out['candidates']};prereg=out['preregistration'];texts={k:out[k] for k in KOREAN_FIELDS}
    except (KeyError,TypeError):raise C.Stop('OUTPUT_FIELDS') from None
    C.validate_experiment(exp,feature_names)
    for k,v in texts.items():
        if type(v) is not str or not korean(v):raise C.Stop('KOREAN_TEXT:'+k)
    try:J.validate_prereg(prereg,exp)
    except J.PreregInvalid as e:raise C.Stop(str(e)) from None
    usd=C.estimate_usd(exp)
    if usd>remaining:raise C.Stop('OVER_BUDGET:%.3f>%.3f'%(usd,remaining))
    dup=P.novelty(exp)
    if dup:raise C.Stop('REPEATED_CANDIDATES:'+','.join(dup))
    return exp,prereg,usd
def _inputs():
    state=json.loads((A/'state.json').read_bytes());policy=json.loads((A/'policy.json').read_bytes())
    m8=json.loads(Path(state['featuresManifestLocal']).read_bytes());m9=json.loads(Path(state['stopDemandManifestLocal']).read_bytes());return state,policy,m8['featureNames']+m9['featureNames']
def main(run_id,out_path,attempts=3,gateway_call=None):
    call=gateway_call or G.call;state,policy,feature_names=_inputs()
    ctx,remaining=context(run_id,state,policy);text=prompt(ctx);sch=schema(feature_names);Path(out_path).parent.mkdir(parents=True,exist_ok=True)
    pl=policy.get('planner') or {};model=pl.get('model','claude-opus-5-5');effort=pl.get('effort','high');guard=float((policy.get('aiBudget') or {}).get('perCallGuardUSD',1.0));log=[]
    for i in range(attempts):
        try:out,meta=call(role='designer',model=model,effort=effort,system=SYSTEM,user=text,schema=sch,max_usd=guard,run_id=run_id,purpose='plan')
        except G.GatewayError as e:
            log.append({'accepted':False,'reason':str(e),'gateway':e.code,**_attempt(e.meta)});break
        try:
            exp,prereg,usd=check(out,feature_names,remaining)
            plan={'schema':'AUTOLOOP_PLAN/1','runId':run_id,'model':model,'planner':'planner_v2','promptSha256':hashlib.sha256(text.encode()).hexdigest(),'experiment':exp,'rationale':out['rationale'],'expectedEffect':out['expectedEffect'],
                  'preregistration':prereg,'estimatedUSD':usd,'budgetRemainingUSD':remaining,'attempts':log+[{'accepted':True,**_attempt(meta)}],'createdAt':time.time()}
            with open(out_path,'x') as f:json.dump(plan,f,ensure_ascii=False,indent=1)
            print(json.dumps({'accepted':True,'experiment':exp['id'],'candidates':len(exp['candidates']),'predictions':len(prereg['predictions']),'estimatedUSD':usd,'aiCostUSD':round(sum(float(a.get('costUSD') or 0) for a in plan['attempts']),6)}));return 0
        except C.Stop as e:
            log.append({'accepted':False,'reason':str(e),**_attempt(meta)})
            text=text+"\n\nYour previous answer was rejected by validation. Reason: "+str(e)+"\nFix that reason and output the corrected experiment."
    with open(str(out_path)+'.rejected.json','x') as f:json.dump({'runId':run_id,'planner':'planner_v2','attempts':log},f,ensure_ascii=False,indent=1)
    print(json.dumps({'accepted':False,'attempts':log},ensure_ascii=False));return 1
DEBATE_DEFAULTS={'maxRoundTrips':2,'authorModel':'claude-opus-5-5','authorEffort':'high','reviewerModel':'claude-opus-5-5','reviewerEffort':'medium','maxTotalUSD':2.0}
EXIT_DEADLOCK=4;EXIT_BUDGET=5;AI_BUDGET_REFUSALS=('AI_BUDGET_TODAY','AI_BUDGET_TOTAL')
LOCAL_PATH=re.compile(r'(?:/Users|/home|/private|/var/folders|/Volumes|/tmp)/[^\s"\'<>]*')
AUTHOR_NOTE=("\nYou write the proposal in a two-party review: a reviewer checks it against a checklist and may ask for revisions; answer its items as the request says. "
 "CONTEXT below is all the data there is; JSON paths such as $.ledger[0].status refer to it.")
def strip_paths(v):
    if isinstance(v,str):return LOCAL_PATH.sub('<local-path>',v)
    if isinstance(v,dict):return {(strip_paths(k) if isinstance(k,str) else k):strip_paths(x) for k,x in v.items()}
    if isinstance(v,list):return [strip_paths(x) for x in v]
    return v
def slim(ctx):
    d=ctx.get('latestDiagnostics')
    if not (isinstance(d,dict) and isinstance(d.get('candidates'),dict)):return ctx
    d={**d,'candidates':{n:{k:v for k,v in sl.items() if k not in ('route','kstHour')} for n,sl in d['candidates'].items()},'note':str(d.get('note') or '')+'; candidate route and kstHour slices omitted (the champion keeps them)'}
    return {**ctx,'latestDiagnostics':d}
def debate_cfg(policy,cfg=None):
    c={**DEBATE_DEFAULTS,**(policy.get('debate') or {}),**(cfg or {})};cap=float((policy.get('aiBudget') or {}).get('perRoundUSD',c['maxTotalUSD']))
    if not (type(c['maxRoundTrips']) is int and 1<=c['maxRoundTrips']<=4 and c['authorEffort'] in G.EFFORTS and c['reviewerEffort'] in G.EFFORTS and all(type(c[k]) is str and c[k] for k in ('authorModel','reviewerModel'))
            and G.finite(c['maxTotalUSD']) and 0<c['maxTotalUSD']<=cap):raise ValueError('DEBATE_CONFIG')
    return c
def debate_context(run_id,state,policy):
    ctx,remaining=context(run_id,state,policy);return strip_paths(slim(compact(ctx))),remaining
def _write(path,obj):
    with open(path,'x') as f:json.dump(obj,f,ensure_ascii=False,indent=1)
def _persister(path,last):
    def persist(rec):
        last['rec']=rec;tmp=Path(str(path)+'.next');tmp.write_text(json.dumps(rec,ensure_ascii=False,indent=1));os.replace(tmp,path)
    return persist
def _summary(rec,name):return {'status':rec.get('status'),'reason':rec.get('reason'),'rounds':rec.get('rounds'),'costUSD':rec.get('costUSD'),'downgraded':rec.get('downgraded') or [],'record':name,'contextSha256':rec.get('contextSha256')}
def _debate_attempts(rec):
    agreed=D._sha(rec['artifact']) if rec.get('status')=='AGREED' and rec.get('artifact') is not None else None;out=[]
    for e in rec.get('transcript') or []:
        m=e.get('meta') if isinstance(e.get('meta'),dict) else {}
        a={'role':e.get('role'),'round':e.get('round'),'purpose':e.get('purpose'),'accepted':agreed is not None and e.get('role')=='author' and e.get('artifactSha256')==agreed,**_attempt(m),'costUSD':m.get('costUSD'),'chargedUSD':e.get('costUSD',0.0)}
        for k in ('valid','decision'):
            if k in e:a[k]=e[k]
        if 'error' in e:a['error']=str(e['error'])[:300]
        out.append(a)
    return out
def design(run_id,out_path,*,call=None,cfg=None):
    call=call or G.call;state,policy,feature_names=_inputs();c=debate_cfg(policy,cfg);out_path=Path(out_path);out_path.parent.mkdir(parents=True,exist_ok=True);rec_path=out_path.parent/'design-debate.json'
    dctx,remaining=debate_context(run_id,state,policy)
    system=SYSTEM+AUTHOR_NOTE+'\n\nCONTEXT (JSON, floats rounded to 5 significant digits)\n'+json.dumps(dctx,ensure_ascii=False,separators=(',',':'))
    user='Design the next experiment from CONTEXT in the system prompt.'+TAIL;guard=float((policy.get('aiBudget') or {}).get('perCallGuardUSD',1.0));refusals=[];last={}
    def gw(**kw):
        try:return call(**kw)
        except G.GatewayRefused as e:refusals.append(e.code);raise
    def validate(art):
        try:check(art,feature_names,remaining);return []
        except C.Stop as e:return [str(e)]
    base={'runId':run_id,'planner':'planner_v2/debate','record':rec_path.name}
    def report(status,code,**kw):print(json.dumps({'accepted':code==0,'status':status,'exit':code,**kw},ensure_ascii=False));return code
    try:
        rec=D.run(kind='design',context=dctx,author_system=system,author_schema=schema(feature_names),initial_author_user=user,validate_artifact=validate,author_call=gw,reviewer_call=gw,
                  author_model=c['authorModel'],reviewer_model=c['reviewerModel'],author_effort=c['authorEffort'],reviewer_effort=c['reviewerEffort'],max_round_trips=c['maxRoundTrips'],
                  max_total_usd=float(c['maxTotalUSD']),run_id=run_id,persist=_persister(rec_path,last),checklist=D.BY_KIND['design'],max_call_usd=guard,roles=('designer','design-reviewer'))
    except G.GatewayFailed as e:
        rec=last.get('rec') or {};code=EXIT_BUDGET if e.code=='BUDGET_STOP' else 1
        _write(str(out_path)+'.rejected.json',{**base,'status':'GATEWAY_'+e.code,'reason':str(e)[:300],'debate':_summary(rec,rec_path.name),'attempts':_debate_attempts(rec)})
        return report('GATEWAY_'+e.code,code,costUSD=rec.get('costUSD'))
    summ=_summary(rec,rec_path.name);att=_debate_attempts(rec)
    if rec['status']=='AGREED':
        art=rec['artifact']
        try:exp,prereg,usd=check(art,feature_names,remaining)
        except C.Stop as e:rec={**rec,'status':'AUTHOR_INVALID','reason':'FINAL_VALIDATION:'+str(e)};summ=_summary(rec,rec_path.name)
        else:
            _write(out_path,{'schema':'AUTOLOOP_PLAN/1','runId':run_id,'model':c['authorModel'],'planner':'planner_v2/debate','promptSha256':hashlib.sha256((system+'\n'+user).encode()).hexdigest(),'experiment':exp,
                             'rationale':art['rationale'],'expectedEffect':art['expectedEffect'],'preregistration':prereg,'estimatedUSD':usd,'budgetRemainingUSD':remaining,'debate':summ,'attempts':att,'createdAt':time.time()})
            return report('AGREED',0,experiment=exp['id'],rounds=rec['rounds'],costUSD=rec['costUSD'],estimatedUSD=usd)
    if rec['status'] in ('DEADLOCK','AUTHOR_INVALID'):
        ob=[{k:i[k] for k in ('itemId','severity','citations','objection','requestedChange','errors') if k in i} for i in rec.get('openBlocking') or []]
        _write(str(out_path)+'.deadlock.json',{**base,'status':rec['status'],'reason':rec['reason'],'openBlocking':ob,'artifact':rec.get('artifact'),'debate':summ,'attempts':att})
        return report(rec['status'],EXIT_DEADLOCK,reason=rec['reason'],rounds=rec['rounds'],costUSD=rec['costUSD'])
    code=EXIT_BUDGET if rec['status']=='BUDGET' or any(r in AI_BUDGET_REFUSALS for r in refusals) else 1
    _write(str(out_path)+'.rejected.json',{**base,'status':rec['status'],'reason':rec['reason'],'refusals':refusals,'debate':summ,'attempts':att})
    return report(rec['status'],code,reason=rec['reason'],refusals=refusals,costUSD=rec['costUSD'])
USAGE=__doc__.splitlines()[-1]
def parse_cli(argv):
    args=list(argv);n=3;mx=None;deb='--debate' in args
    try:
        if '--attempts' in args:i=args.index('--attempts');n=int(args[i+1]);del args[i:i+2]
        if '--max-total-usd' in args:i=args.index('--max-total-usd');mx=float(args[i+1]);del args[i:i+2]
    except (IndexError,ValueError):raise SystemExit(USAGE) from None
    if deb:args.remove('--debate')
    if len(args)!=2 or not 1<=n<=3 or (mx is not None and not (deb and G.finite(mx) and mx>0)):raise SystemExit(USAGE)
    return args[0],args[1],n,deb,mx
if __name__=='__main__':
    run_id,out,n,deb,mx=parse_cli(sys.argv[1:])
    if not deb:raise SystemExit(main(run_id,out,n))
    cfg=None
    if mx is not None:
        cap=debate_cfg(json.loads((A/'policy.json').read_bytes()))['maxTotalUSD']
        if mx>cap:raise SystemExit('--max-total-usd may only lower the policy debate cap %.2f'%cap)
        cfg={'maxTotalUSD':mx}
    raise SystemExit(design(run_id,out,cfg=cfg))
