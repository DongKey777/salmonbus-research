"""Tests for ai/planner_v2.py with a fake model (no network): schema extension, English prompt with journal digest, previous plans and incidents, the current real context passing the outbound filter (read-only), validation retries, gateway failure handling, and an end-to-end run through the real gateway with a fake CLI runner."""
import copy,json,os,shutil,subprocess,sys,tempfile
from functools import partial
from pathlib import Path
A=Path(__file__).resolve().parents[1];sys.path.insert(0,str(A/'ai'))
import planner_v2 as V,gateway as G,journal as J,chainlog as CL
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
real_state=json.loads((A/'state.json').read_bytes());real_policy=json.loads((A/'policy.json').read_bytes())
FEAT=json.loads(Path(real_state['featuresManifestLocal']).read_bytes())['featureNames']+json.loads(Path(real_state['stopDemandManifestLocal']).read_bytes())['featureNames']
ctx,rem=V.context('AUTOLOOP_099',real_state,real_policy);text=V.prompt(ctx);sch=V.schema(FEAT)
check('the real current context passes the outbound filter (no secrets, no /Users/ paths, under 200 KB)',G.outbound(V.SYSTEM,text,json.dumps(sch,ensure_ascii=False,sort_keys=True,separators=(',',':')))<G.REQUEST_CAP)
check('the real context drops the champion prediction path',"predictions" not in ctx['champion'] and '/workspace/salmonbus-full-v1/outputs/SEAT_FEATURES_V2_002' not in text)
base=V.P.schema(FEAT)
check('schema adds a required preregistration and a required candidate note',sch['required'][-1]=='preregistration' and sch['properties']['preregistration']==J.PREREG and 'note' in sch['properties']['candidates']['items']['required'])
check('plan.py schema itself is untouched',('preregistration' not in base['required']) and 'note' not in base['properties']['candidates']['items']['required'])
check('system prompt is English and asks for Korean human-facing text',V.SYSTEM.isascii() and 'Korean' in V.SYSTEM and 'INCONCLUSIVE is not REFUTED' in V.SYSTEM)
R=Path(tempfile.mkdtemp(prefix='ai-planner-test-'))
for d in ('planner','runs/AUTOLOOP_001','ai'):(R/d).mkdir(parents=True)
for f in ('planner/feature_catalog.json','planner/initial_ideas.json','incidents.json','runs/AUTOLOOP_001/plan.json'):shutil.copyfile(A/f,R/f)
(R/'m8.json').write_text(json.dumps({'featureNames':FEAT[:-3]}));(R/'m9.json').write_text(json.dumps({'featureNames':FEAT[-3:]}))
st=copy.deepcopy(real_state);st.update(featuresManifestLocal=str(R/'m8.json'),stopDemandManifestLocal=str(R/'m9.json'),lastDiagnostics=None);st['budget']={'spentTotal':0.0,'spentByDay':{}}
def write_state(**kw):s=copy.deepcopy(st);s['budget'].update(kw);(R/'state.json').write_text(json.dumps(s))
write_state();(R/'policy.json').write_text(json.dumps({**real_policy,'aiBudget':{**real_policy['aiBudget'],'perDayUSD':5.0,'totalUSD':5.0,'perCallGuardUSD':1.0}}))
DUP={'candidate':'SQ_D6_R256','kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','rounds':256,'params':{'max_depth':6,'eta':0.1}}
(R/'ledger.jsonl').write_text(json.dumps({'runId':'AUTOLOOP_000','experimentId':'OLD','hypothesis':'h','status':'COMPLETED','estimatedUSD':0.1,'actualUSD':0.1,'championBefore':'SEAT.V2_D8','championAfter':'SEAT.V2_D8','candidates':[{'spec':DUP}]})+'\n')
V.A=R;V.P.A=R;J.JOURNAL=R/'ai/journal.jsonl';G.AI=R/'ai';G.POLICY=R/'policy.json'
J.append_entry(run_id='AUTOLOOP_001',plan=R/'runs/AUTOLOOP_001/plan.json',status='INFRASTRUCTURE_FAILURE',failure='SWEEP_EXIT_1: worker IndexError on 1-D quantile predictions')
KO='챔피언은 평균을 맞추지만 판정 지표는 가중 MAE라서 조건부 중앙값을 맞추는 L1 목적함수가 DEV_S MAE를 낮출 것이다. 만석 도착 때 평균 5.7석 예보가 근거다.'
C1={'candidate':'ABS_D8_R512','kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:absoluteerror','rounds':512,'params':{'max_depth':8,'eta':0.1},'note':'주 후보. 목적함수만 L1로 바꾼다.'}
C2={'candidate':'SQ_D8_R512','kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','rounds':512,'params':{'max_depth':8,'eta':0.1},'note':'대조군. 라운드 몫을 뺀다.'}
PRE={'predictions':[{'id':'P1','candidate':'ABS_D8_R512','metric':'MAE','comparator':'CHAMPION','direction':'lower','minEffect':0.02,'why':'중앙값이 MAE 최적이다'},
                    {'id':'P2','candidate':'ABS_D8_R512','metric':'fullBusUnder2Share','direction':'higher','comparator':'CHAMPION','minEffect':0.05,'why':'만석 쪽 치우침이 줄어든다'}],'refutedIf':'ABS_D8_R512의 MAE 차 구간 전체가 -0.02 위에 있으면 가설은 반박된다.'}
GOOD={'id':'OBJ_L1_TEST_001','hypothesis':KO,'rationale':KO+' 학습 곡선은 768→1024 구간에서 −0.004에 그쳤다.','expectedEffect':'ABS_D8_R512의 MAE가 챔피언보다 0.02석 이상 낮고 보호 지표는 나빠지지 않을 것으로 본다.','candidates':[C1,C2],'preregistration':PRE}
def variant(**kw):o=copy.deepcopy(GOOD);o.update(kw);return o
META={'callId':'c','costUSD':0.11,'chargedUSD':0.11,'durationMs':10,'turns':2,'model':'claude-opus-5-5','effort':'high','auth':'api','usage':{'output_tokens':10},'outputSha256':'0'*64,'status':'OK'}
class FakeCall:
    def __init__(self,*outs):self.outs=list(outs);self.kw=[]
    def __call__(self,**kw):
        self.kw.append(kw);o=self.outs.pop(0)
        if isinstance(o,BaseException):raise o
        return copy.deepcopy(o),dict(META)
def run(fake,name,attempts=3):
    out=R/'runs'/name/'plan.json';rc=V.main(name,out,attempts,gateway_call=fake);return rc,out
bad=variant(preregistration={**PRE,'predictions':[{**PRE['predictions'][0],'candidate':'NOT_IN_EXPERIMENT'}]})
f=FakeCall(bad,GOOD);rc,out=run(f,'AUTOLOOP_002')
plan=json.loads(out.read_bytes()) if out.exists() else {}
check('rejected pre-registration goes back with its reason, then the corrected answer is accepted',rc==0 and len(f.kw)==2 and [a['accepted'] for a in plan['attempts']]==[False,True] and plan['attempts'][0]['reason']=='PREREG_CANDIDATE:P1'
      and 'rejected by validation. Reason: PREREG_CANDIDATE:P1' in f.kw[1]['user'])
check('plan.json keeps the plan.py shape plus preregistration',set(plan)=={'schema','runId','model','promptSha256','experiment','rationale','expectedEffect','estimatedUSD','budgetRemainingUSD','attempts','createdAt','preregistration','planner'}
      and plan['experiment']=={'id':GOOD['id'],'hypothesis':KO,'candidates':[C1,C2]} and plan['preregistration']==PRE and plan['schema']=='AUTOLOOP_PLAN/1')
check('attempts carry costUSD so loop.py can account AI spend',sum(float(a.get('costUSD') or 0) for a in plan['attempts'])==0.22)
k=f.kw[0]
check('the call goes through the gateway as designer/plan with the policy model, effort and per-call guard',k['role']=='designer' and k['purpose']=='plan' and k['model']==real_policy['planner']['model'] and k['effort']==real_policy['planner']['effort'] and k['max_usd']==1.0 and k['run_id']=='AUTOLOOP_002')
u=k['user'];c=json.loads(u.split('\n\n')[1])
check('prompt is English around compact JSON context',u.startswith('Design the next experiment from the JSON data below') and u.split('\n\n')[0].isascii() and u.split('\n\n')[2].isascii())
check('context carries the journal digest, previous plans with rationale and expectedEffect, and incidents',c['journal'][0]['runId']=='AUTOLOOP_001' and c['journal'][0]['status']=='INFRASTRUCTURE_FAILURE'
      and c['previousPlans'][0]['runId']=='AUTOLOOP_001' and c['previousPlans'][0]['rationale'][:20]==json.loads((R/'runs/AUTOLOOP_001/plan.json').read_bytes())['rationale'][:20] and c['previousPlans'][0]['expectedEffect'] and c['incidents'][0]['runId']=='AUTOLOOP_001')
check('previous plans exclude the run being planned and later runs',all(p['runId']<'AUTOLOOP_002' for p in c['previousPlans']))
f=FakeCall(variant(hypothesis='The L1 objective should lower DEV_S MAE because the champion fits the mean.'),GOOD);rc,out=run(f,'AUTOLOOP_003')
check('English hypothesis is rejected (Korean required for humans)',rc==0 and json.loads(out.read_bytes())['attempts'][0]['reason']=='KOREAN_TEXT:hypothesis')
f=FakeCall(variant(candidates=[C1,{**DUP,'note':'반복 후보'}],preregistration=PRE),GOOD);rc,out=run(f,'AUTOLOOP_004')
check('a measured candidate is rejected by plan.py novelty',rc==0 and json.loads(out.read_bytes())['attempts'][0]['reason']=='REPEATED_CANDIDATES:SQ_D6_R256')
f=FakeCall(variant(candidates=[{**C1,'params':{'max_depth':30,'eta':0.1}},C2]),GOOD);rc,out=run(f,'AUTOLOOP_005')
check('an out-of-range parameter is rejected by the package validator',rc==0 and json.loads(out.read_bytes())['attempts'][0]['reason']=='CANDIDATE_PARAM:ABS_D8_R512:max_depth')
write_state(spentTotal=19.95);f=FakeCall(GOOD,GOOD,GOOD);rc,out=run(f,'AUTOLOOP_006')
rej=json.loads(Path(str(out)+'.rejected.json').read_bytes())
check('over the GPU budget three times ends rejected with every attempt and cost recorded',rc==1 and not out.exists() and len(rej['attempts'])==3 and all(a['reason'].startswith('OVER_BUDGET:') for a in rej['attempts']) and sum(a['costUSD'] for a in rej['attempts'])>0.32)
write_state()
f=FakeCall(G.GatewayFailed('TIMEOUT','TIMEOUT',{'callId':'t','costUSD':None,'chargedUSD':1.0}),GOOD);rc,out=run(f,'AUTOLOOP_007')
rej=json.loads(Path(str(out)+'.rejected.json').read_bytes())
check('a failed call stops at once and is never re-sent',rc==1 and len(f.kw)==1 and rej['attempts'][0]['gateway']=='TIMEOUT' and rej['attempts'][0]['chargedUSD']==1.0)
f=FakeCall(G.GatewayRefused('AI_BUDGET_TODAY'));rc,out=run(f,'AUTOLOOP_008')
check('a gateway refusal stops planning',rc==1 and json.loads(Path(str(out)+'.rejected.json').read_bytes())['attempts'][0]['gateway']=='AI_BUDGET_TODAY')
seen=[]
def runner(cmd,stdin,cwd,env,timeout):
    seen.append({'schema':json.loads(cmd[cmd.index('--json-schema')+1]),'system':cmd[cmd.index('--system-prompt')+1],'stdin':stdin.decode(),'env':env})
    return 0,json.dumps({'type':'result','subtype':'success','is_error':False,'duration_ms':5,'num_turns':2,'total_cost_usd':0.1734,'usage':{'input_tokens':3,'cache_creation_input_tokens':9000,'output_tokens':5000,'output_tokens_details':{'thinking_tokens':1300}},'structured_output':GOOD}).encode(),b''
rc,out=run(partial(G.call,runner=runner),'AUTOLOOP_009',1)
plan=json.loads(out.read_bytes()) if out.exists() else {};rows=CL.read(G.ledger_path())
check('end to end through the real gateway with a fake CLI: plan accepted',rc==0 and plan['experiment']['id']=='OBJ_L1_TEST_001' and plan['attempts'][0]['costUSD']==0.1734 and plan['attempts'][0]['usage']['thinking_tokens']==1300)
check('the CLI received the v2 schema, the English system prompt and the prompt on stdin',seen[0]['schema']==V.schema(FEAT) and seen[0]['system']==V.SYSTEM and seen[0]['stdin'].startswith('Design the next experiment'))
check('the call ledger records the designer call with hashes only and verifies',[r['type'] for r in rows]==['RESERVED','OUTCOME'] and rows[0]['role']=='designer' and rows[0]['runId']=='AUTOLOOP_009' and rows[1]['costUSD']==0.1734
      and G.verify_ledger()['ok'] and KO.encode() not in G.ledger_path().read_bytes() and (G.outputs_dir()/(rows[1]['outputSha256']+'.json')).exists())
p=subprocess.run([sys.executable,'-B',str(A/'ai/planner_v2.py'),'ONLY_ONE_ARG'],capture_output=True,text=True)
q=subprocess.run([sys.executable,'-B',str(A/'ai/planner_v2.py'),'AUTOLOOP_010','/tmp/x.json','--attempts','5'],capture_output=True,text=True)
check('CLI refuses a wrong argument count or attempts outside 1..3 before reading anything',p.returncode==1 and 'usage: planner_v2.py' in p.stderr and q.returncode==1 and not Path('/tmp/x.json').exists())
check('compact rounds floats to 5 significant digits and leaves ints, strings and bools',V.compact({'a':1.23456789,'b':[27131.144714,3,True],'c':'x','n':float('nan'),'s':20261022})=={'a':1.2346,'b':[27131.0,3,True],'c':'x','n':None,'s':20261022})
row=lambda k:{'key':k,'weight':27131.144,'MAE':1.1966741,'bias':0.2003242}
(R/'diag.json').write_text(json.dumps({'champion':{'route':[row(1),row(2)]},'featureImportance':{'X':{'f':0.5123456}},'candidates':{'X':{'route':[row(1),row(2)]}},'product':{'route':[row(1)]}}))
s2=copy.deepcopy(st);s2['lastDiagnostics']=str(R/'diag.json');c2,_=V.context('AUTOLOOP_011',s2,real_policy);t2=V.prompt(c2);d2=json.loads(t2.split('\n\n')[1])['latestDiagnostics']
check('diagnostics keep champion weights, drop candidate weights and the product slices, and are rounded',d2['champion']['route'][0]=={'key':1,'weight':27131.0,'MAE':1.1967,'bias':0.20032} and d2['candidates']['X']['route'][0]=={'key':1,'MAE':1.1967,'bias':0.20032} and 'product' not in d2 and str(R) not in t2)
check('strip_paths replaces local absolute paths, keeps remote ones and recurses into keys',V.strip_paths({'a':'/Users/x/y z','/tmp/k':['/var/folders/q/r','/workspace/salmonbus-full-v1/x']})=={'a':'<local-path> z','<local-path>':['<local-path>','/workspace/salmonbus-full-v1/x']})
sc={'latestDiagnostics':{'champion':{'route':[1],'kstHour':[2],'horizonBucket':[3]},'candidates':{'X':{'route':[1],'kstHour':[2],'horizonBucket':[3],'currentSeatsBand':[4]}},'note':'n'}}
sl=V.slim(sc)['latestDiagnostics']
check('slim drops candidate route and kstHour slices only',sl['candidates']['X']=={'horizonBucket':[3],'currentSeatsBand':[4]} and sl['champion']==sc['latestDiagnostics']['champion'] and 'omitted' in sl['note'] and V.slim({'a':1})=={'a':1})
ds=copy.deepcopy(st);ds['champion']['localNote']='/Users/someone/private/credentials/x and '+str(R/'state.json');(R/'state.json').write_text(json.dumps(ds))
APPROVE={'verdict':'APPROVE','summary':'문제 없음','items':[]}
REVISE={'verdict':'REVISE','summary':'후보가 많다','items':[{'itemId':'B1','severity':'BLOCKING','citations':['D4'],'objection':'too many arms','requestedChange':'drop the control'}]}
ACC=[{'itemId':'B1','action':'ACCEPT','reason':'대조군을 뺐다','citation':'D4'}]
GOOD2=variant(candidates=[C1])
class Deb:
    def __init__(self,authors,reviews):self.a=list(authors);self.r=list(reviews);self.kw=[]
    def __call__(self,**kw):
        self.kw.append(kw);o=(self.a if kw['role']=='designer' else self.r).pop(0)
        if isinstance(o,BaseException):raise o
        return copy.deepcopy(o),dict(META)
def auth(art,rs=()):return {'artifact':art,'responses':list(rs)}
def drun(fake,name,cfg=None):out=R/'runs'/name/'plan.json';return V.design(name,out,call=fake,cfg=cfg),out
def side(out,ext):p=Path(str(out)+ext);return json.loads(p.read_bytes()) if p.exists() else None
f=Deb([auth(GOOD)],[APPROVE]);rc,out=drun(f,'AUTOLOOP_020');plan=json.loads(out.read_bytes()) if out.exists() else {};rec=json.loads((out.parent/'design-debate.json').read_bytes())
check('debate AGREED in round 1 writes plan.json with a debate summary',rc==0 and plan['debate']['status']=='AGREED' and plan['debate']['rounds']==1 and plan['debate']['costUSD']==0.22 and plan['debate']['downgraded']==[] and plan['preregistration']==PRE and plan['planner']=='planner_v2/debate')
check('plan keeps the plan.py shape plus preregistration and debate',set(plan)=={'schema','runId','model','promptSha256','experiment','rationale','expectedEffect','estimatedUSD','budgetRemainingUSD','attempts','createdAt','preregistration','planner','debate'})
check('attempts list every debate call with costs for loop accounting',[(a['role'],a['round'],a['accepted']) for a in plan['attempts']]==[('author',1,True),('reviewer',1,False)] and sum(a['costUSD'] for a in plan['attempts'])==0.22)
check('the debate record is persisted next to the plan',rec['status']=='AGREED' and rec['kind']=='design' and len(rec['transcript'])==2 and not (out.parent/'design-debate.json.next').exists())
ka,kr=f.kw
check('roles, efforts, models and per-call cap follow the debate defaults',(ka['role'],ka['effort'],ka['model'],kr['role'],kr['effort'],kr['model'])==('designer','high','claude-opus-5-5','design-reviewer','medium','claude-opus-5-5') and ka['max_usd']<=1.0 and ka['purpose']=='debate:design:author:r1')
check('author system carries the context; the user asks for the design',ka['system'].count('CONTEXT (JSON, floats rounded to 5 significant digits)')==1 and ka['user'].startswith('Design the next experiment from CONTEXT in the system prompt.'))
check('no local absolute path reaches either party even though state.json holds one',all('/Users/' not in k['system']+k['user'] and str(R) not in k['system']+k['user'] for k in f.kw) and '<local-path>' in ka['system'])
check('every debate prompt passes the gateway outbound filter',all(G.outbound(k['system'],k['user'],json.dumps(k['schema'],ensure_ascii=False,sort_keys=True,separators=(',',':'))) for k in f.kw))
f=Deb([auth(GOOD),auth(GOOD2,ACC)],[REVISE,APPROVE]);rc,out=drun(f,'AUTOLOOP_021');plan=json.loads(out.read_bytes()) if out.exists() else {}
check('REVISE then ACCEPT then APPROVE agrees in round 2 on the revised plan',rc==0 and plan['debate']['rounds']==2 and [c['candidate'] for c in plan['experiment']['candidates']]==['ABS_D8_R512'] and len(plan['attempts'])==4 and abs(plan['debate']['costUSD']-0.44)<1e-9)
check('round-2 author request carries the blocking item; the re-review sees the responses',"B1" in f.kw[2]['user'] and 'REVISION REQUEST' in f.kw[2]['user'] and 'RESPONSES (JSON)' in f.kw[3]['user'])
f=Deb([auth(GOOD),auth(GOOD2,ACC)],[REVISE,REVISE]);rc,out=drun(f,'AUTOLOOP_022');dl=side(out,'.deadlock.json')
check('repeated blocking ends DEADLOCK with exit 4 and a deadlock file, no plan',rc==4 and not out.exists() and dl['status']=='DEADLOCK' and dl['reason']=='REPEATED_BLOCKING' and dl['openBlocking'][0]['itemId']=='B1' and len(dl['attempts'])==4)
f=Deb([auth(bad),auth(bad)],[]);rc,out=drun(f,'AUTOLOOP_023');dl=side(out,'.deadlock.json')
check('an artifact failing validation twice ends AUTHOR_INVALID (exit 4) without any review',rc==4 and dl['status']=='AUTHOR_INVALID' and len(f.kw)==2 and all(k['role']=='designer' for k in f.kw) and 'PREREG_CANDIDATE:P1' in f.kw[1]['user'])
f=Deb([auth(variant(candidates=[C1,{**DUP,'note':'반복'}])),auth(GOOD)],[APPROVE]);rc,out=drun(f,'AUTOLOOP_024')
check('the full validator (novelty) runs inside the debate and the fixed artifact is reviewed',rc==0 and 'REPEATED_CANDIDATES:SQ_D6_R256' in f.kw[1]['user'] and len(f.kw)==3)
f=Deb([],[]);rc,out=drun(f,'AUTOLOOP_025',cfg={'maxTotalUSD':0.005});rj=side(out,'.rejected.json')
check('debate BUDGET exits 5 before any call',rc==5 and f.kw==[] and rj['status']=='BUDGET')
f=Deb([G.GatewayRefused('AI_BUDGET_TODAY','x')],[]);rc,out=drun(f,'AUTOLOOP_026');rj=side(out,'.rejected.json')
check('a gateway AI-budget refusal exits 5',rc==5 and rj['status']=='REFUSED' and rj['refusals']==['AI_BUDGET_TODAY'])
f=Deb([G.GatewayRefused('OUTBOUND_FILTER','SECRET_PATTERN:user')],[]);rc,out=drun(f,'AUTOLOOP_027')
check('any other gateway refusal exits 1',rc==1 and side(out,'.rejected.json')['refusals']==['OUTBOUND_FILTER'])
f=Deb([auth(GOOD)],[G.GatewayFailed('TIMEOUT','TIMEOUT',{'callId':'t','costUSD':None,'chargedUSD':1.0})]);rc,out=drun(f,'AUTOLOOP_028');rj=side(out,'.rejected.json')
check('a gateway failure exits 1 and charges the failed call',rc==1 and rj['status']=='GATEWAY_TIMEOUT' and [a['chargedUSD'] for a in rj['attempts']]==[0.11,1.0] and json.loads((out.parent/'design-debate.json').read_bytes())['status']=='ERROR')
f=Deb([G.GatewayFailed('BUDGET_STOP','MAX_BUDGET_USD',{'callId':'b','costUSD':0.4,'chargedUSD':0.4})],[]);rc,out=drun(f,'AUTOLOOP_029')
check('a CLI max-budget stop exits 5',rc==5 and side(out,'.rejected.json')['status']=='GATEWAY_BUDGET_STOP')
try:V.design('AUTOLOOP_030',R/'runs/AUTOLOOP_030/plan.json',call=Deb([],[]),cfg={'maxTotalUSD':9.0});bc=None
except ValueError as e:bc=str(e)
check('a debate cap above the per-round AI budget is refused',bc=='DEBATE_CONFIG')
G.AI=R/'ai2';seen2=[]
def drunner(cmd,stdin,cwd,env,timeout):
    sc_=json.loads(cmd[cmd.index('--json-schema')+1]);syst=cmd[cmd.index('--system-prompt')+1];seen2.append((syst,stdin.decode()))
    so=auth(GOOD) if 'artifact' in sc_['properties'] else APPROVE
    return 0,json.dumps({'type':'result','subtype':'success','is_error':False,'duration_ms':5,'num_turns':2,'total_cost_usd':0.05,'usage':{'input_tokens':3,'cache_creation_input_tokens':100,'output_tokens':50},'structured_output':so}).encode(),b''
rc,out=drun(partial(G.call,runner=drunner),'AUTOLOOP_031');rows=CL.read(G.ledger_path())
check('end to end through the real gateway: debate agreed, ledger has designer and design-reviewer calls',rc==0 and [(r['type'],r.get('role')) for r in rows]==[('RESERVED','designer'),('OUTCOME',None),('RESERVED','design-reviewer'),('OUTCOME',None)] and G.verify_ledger()['ok'] and abs(G.verify_ledger()['totalUSD']-0.1)<1e-9)
check('the reviewer CLI call got the review system prompt and no local path',seen2[1][0].startswith('You review an experiment plan') and all('/Users/' not in a+b for a,b in seen2))
check('parse_cli handles --debate and --max-total-usd',V.parse_cli(['A','b'])==('A','b',3,False,None) and V.parse_cli(['A','b','--debate','--max-total-usd','1.2'])==('A','b',3,True,1.2))
for bad_args in (['A','b','--max-total-usd','1'],['A','b','--debate','--max-total-usd','x'],['A','b','--attempts'],['A','b','--debate','--max-total-usd','-1'],['A']):
    try:V.parse_cli(bad_args);ok=False
    except SystemExit:ok=True
    check('parse_cli refuses '+' '.join(bad_args),ok)
shutil.rmtree(R)
print('ALL_PASS %d'%N[0])
