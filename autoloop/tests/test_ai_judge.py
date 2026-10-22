"""Judge tests with a fake gateway: floor, citations, prose numbers, verdict consistency, deterministic anomalies, declines, refusal fallback and schema violations. No network."""
import copy,importlib.util,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
A=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ai_judge',A/'ai/judge.py');J=importlib.util.module_from_spec(spec);spec.loader.exec_module(J)
BASE=json.loads((A/'tests/fixtures_judge/entry.json').read_bytes());POLICY=json.loads((A/'policy.json').read_bytes())
def check(name,ok):print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
def E():return copy.deepcopy(BASE)
def p8(v):return float('%.8g'%v)
def cite(e,who,metric,kind='final'):
    v,why=J.cited_value(e,{'candidate':who,'metric':metric,'kind':kind});assert why is None,why
    return {'candidate':who,'metric':metric,'value':p8(v),'kind':kind}
def good(e,pick='ABS_D8_R2048',**over):
    mech=J.mechanical_map(e)
    o={'hypothesisVerdict':'SUPPORTED','hypothesisReasonsKo':['ABS_D8_R1024의 MAE 차 구간 상한이 -0.01보다 낮다.'],'hypothesisCitations':[cite(e,'ABS_D8_R1024','MAE','ciHi')],
       'perPrediction':[{'id':p['id'],'verdict':mech[p['id']],'agreesWithMechanical':True,'reasonKo':'기계 판정과 같다.','citations':[cite(e,p['candidate'],p['metric'],'ciLo'),cite(e,p['candidate'],p['metric'],'ciHi')]} for p in e['preregistration']['predictions']],
       'champion':{'candidate':pick,'reasonKo':'바닥을 넘은 후보 중 MAE가 가장 낮다.','citations':[cite(e,pick,'MAE')] if pick else [],'declined':[]},
       'anomaly':{'suspected':False,'reasonsKo':[],'citations':[]},'continueLoop':True,'stopReason':None,'stopReasonKo':'',
       'lessonsKo':['L1 목적함수 다음에는 라운드보다 특징 쪽을 바꾼다.'],'summaryKo':'ABS_D8_R2048을 챔피언으로 올린다. MAE는 2.2052석이다.'}
    o.update(over);return o
class GatewayError(Exception):
    def __init__(self,code,detail=None,meta=None):super().__init__(code+(':'+str(detail) if detail else ''));self.code=code;self.detail=detail;self.meta=meta or {}
class GatewayRefused(GatewayError):pass
class GatewayFailed(GatewayError):pass
class BudgetRefused(GatewayRefused):pass
def fake(*outs):
    calls=[]
    def call(**kw):
        calls.append(kw);o=outs[len(calls)-1]
        if isinstance(o,BaseException):raise o
        return copy.deepcopy(o),{'costUSD':0.12,'model':kw['model'],'purpose':kw['purpose']}
    call.calls=calls;return call
def run(e,call,**kw):
    args=dict(call=call,max_usd=1.0,history_digest='',policy=POLICY,consecutive_no_improvement=2,run_id=e['runId']);args.update(kw);return J.decide(e,**args)
def errs(o,e=None):return J.validate(o,e or E())
def has(es,frag):return any(frag in x for x in es)

def walk(s):
    yield s
    for v in list((s.get('properties') or {}).values())+([s['items']] if 'items' in s else [])+list(s.get('anyOf') or []):yield from walk(v)
nodes=list(walk(J.OUTPUT_SCHEMA));objs=[n for n in nodes if n.get('type')=='object']
check('schema: every object is closed and requires all of its properties',all(n.get('additionalProperties') is False and set(n['required'])==set(n['properties']) for n in objs))
check('schema: no keywords outside the structured-output subset',not {k for n in nodes for k in n}-{'type','properties','required','additionalProperties','items','enum','anyOf'} and json.loads(json.dumps(J.OUTPUT_SCHEMA))==J.OUTPUT_SCHEMA)
check('clean fixture has no code anomalies and two floor-passers ordered by MAE',J.code_anomalies(E())==[] and J.floor_passers(E())==['ABS_D8_R2048','ABS_D8_R1024'])
check('baseline answer validates',errs(good(E()))==[])

e=E();c=fake(good(e));d=run(e,c);k=c.calls[0]
check('valid promotion: champion, promote, continue, one attempt',d['promote'] is True and d['champion']=='ABS_D8_R2048' and d['continue'] is True and d['stopReason'] is None and d['fallback'] is False and len(d['attempts'])==1 and d['attempts'][0]['accepted'])
check('valid promotion: citations counted and verdicts copied',d['citationsChecked']==len(J.all_citations(good(e)))==10 and d['perPrediction']==e['mechanicalVerdicts'] and d['disagreements']==[] and d['hypothesisVerdict']=='SUPPORTED')
check('gateway gets the judge role, schema, system prompt, no tools, per-call budget',k['role']=='judge' and k['schema'] is J.OUTPUT_SCHEMA and k['system']==J.SYSTEM and k['tools'] is None and k['model']=='claude-opus-5-5' and k['effort']=='high' and k['max_usd']==1.0 and k['run_id']=='AUTOLOOP_002' and k['purpose']=='judge')
check('AI cost is summed from attempt meta',d['aiCostUSD']==0.12 and len(d['contextSha256'])==64)

for name,frag in (('HUB6_MDS10_D8_R1024','not a floor-passing'),('Q50_D8_R1024','not a floor-passing'),('FULL_D8','not a floor-passing'),('NOPE','unknown candidate')):
    o=good(E(),champion={'candidate':name,'reasonKo':'임의 선택이다.','citations':[cite(E(),'FULL_D8','Brier')] if name=='FULL_D8' else [],'declined':[]}) if name in ('NOPE','FULL_D8') else good(E(),pick=name)
    check('floor: promoting %s is rejected'%name,has(errs(o),frag))
e=E();e['measured']['candidates']['ABS_D8_R2048']['gatePassed']=1
check('floor: gatePassed must be exactly True (1 is not)',has(errs(good(e),e),'not a floor-passing') and J.floor_passers(e)==['ABS_D8_R1024'])
e=E();bad=good(e,pick='HUB6_MDS10_D8_R1024');c=fake(bad,bad);d=run(e,c)
check('floor: non-floor promotion twice falls back to no promotion and continues',d['fallback'] and d['fallbackReason']=='VALIDATION_FAILED_TWICE' and d['promote'] is False and d['champion'] is None and d['continue'] is True and d['stopReason'] is None and len(c.calls)==2)
check('floor: the re-ask carries the rejection reason and the previous answer',c.calls[1]['purpose']=='judge-retry' and 'REJECTED' in c.calls[1]['user'] and 'not a floor-passing' in c.calls[1]['user'] and 'HUB6_MDS10_D8_R1024' in c.calls[1]['user'] and [a['accepted'] for a in d['attempts']]==[False,False])
check('fallback keeps mechanical verdicts, INCONCLUSIVE hypothesis, no lessons, Korean summary',d['perPrediction']==e['mechanicalVerdicts'] and d['hypothesisVerdict']=='INCONCLUSIVE' and d['lessons']==[] and d['citationsChecked']==0 and '챔피언은 바꾸지 않았' in d['summaryKo'])
c=fake(bad,good(e));d=run(e,c)
check('a corrected second answer is accepted',d['fallback'] is False and d['promote'] and d['champion']=='ABS_D8_R2048' and [a['accepted'] for a in d['attempts']]==[False,True])

e=E();o=good(e);o['champion']['citations'][0]['value']+=1e-3
check('fabricated citation value is rejected',has(errs(o),'cited as'))
c=fake(o,o);d=run(e,c);check('fabricated citation twice falls back',d['fallback'] and not d['promote'])
o=good(e);o['champion']['citations'][0]['value']*=1+5e-7;check('citation within relative 1e-6 is accepted',errs(o)==[])
o=good(e);o['champion']['citations'][0]['value']*=1+5e-6;check('citation outside relative 1e-6 is rejected',has(errs(o),'cited as'))
o=good(e);o['anomaly']['citations']=[{'candidate':'CHAMPION','metric':'MAE','value':p8(e['measured']['champion']['MAE']),'kind':'ciLo'}];check('CHAMPION takes kind final only',has(errs(o),'takes kind final only'))
o=good(e);o['anomaly']['citations']=[{'candidate':'ABS_D8_R2048','metric':'MAPE','value':1.0,'kind':'final'}];check('citing a metric that was not measured is rejected',has(errs(o),'not available'))
o=good(e);o['anomaly']['citations']=[{'candidate':'GHOST','metric':'MAE','value':2.0,'kind':'final'}];check('citing an unknown candidate is rejected',has(errs(o),'unknown candidate GHOST'))
o=good(e);o['anomaly']['citations']=[cite(e,'PRODUCT','MAE')];check('PRODUCT final citation is accepted',errs(o)==[])
o=good(e,summaryKo='ABS_D8_R2048의 MAE가 2.1000석으로 내려갔다.');check('fabricated number in prose is rejected',has(errs(o),'numbers in prose'))
o=good(e,summaryKo='두 ABS 후보의 MAE 차이는 0.0049석이고 over10Share는 2.72%다.');o['champion']['citations'].append(cite(e,'ABS_D8_R1024','MAE'))
check('prose numbers from cited differences and printed shares as percent are accepted',errs(o)==[])

e=E();d=run(e,fake(good(e)));check('INCONCLUSIVE stays INCONCLUSIVE',d['perPrediction']['P2']=='INCONCLUSIVE' and all(x['id']!='P2' for x in d['disagreements']))
def flip(e,verdict,agrees,cites):
    o=good(e);p=o['perPrediction'][1];assert p['id']=='P2';p.update(verdict=verdict,agreesWithMechanical=agrees,reasonKo='구간이 0을 걸친다.',citations=cites);return o
check('INCONCLUSIVE -> REFUTED without evidence on the predicted metric is rejected',has(errs(flip(E(),'REFUTED',False,[cite(E(),'Q50_D8_R1024','RMSE')])),'requires citing Q50_D8_R1024 MAE'))
check('INCONCLUSIVE -> REFUTED with no citations at all is rejected',has(errs(flip(E(),'REFUTED',False,[])),'requires citing'))
check('disagreement must be declared (agreesWithMechanical false)',has(errs(flip(E(),'REFUTED',True,[cite(E(),'Q50_D8_R1024','MAE','ciLo')])),'agreesWithMechanical'))
e=E();o=flip(e,'REFUTED',False,[cite(e,'Q50_D8_R1024','MAE','ciLo'),cite(e,'Q50_D8_R1024','MAE','ciHi')]);d=run(e,fake(o))
check('cited disagreement is accepted and both verdicts are recorded',d['fallback'] is False and d['perPrediction']['P2']=='REFUTED' and d['mechanicalVerdicts']['P2']=='INCONCLUSIVE' and d['disagreements'][0]['mechanical']=='INCONCLUSIVE' and d['disagreements'][0]['judge']=='REFUTED')
e=E();e['preregistration']['predictions']=e['preregistration']['predictions'][1:2];e['mechanicalVerdicts']={'P2':'INCONCLUSIVE'}
check('hypothesis SUPPORTED needs a SUPPORTED prediction',has(errs(good(e),e),'needs at least one prediction judged SUPPORTED'))
check('hypothesis REFUTED needs a REFUTED prediction',has(errs(good(e,hypothesisVerdict='REFUTED'),e),'needs at least one prediction judged REFUTED'))
d=run(e,fake(good(e,hypothesisVerdict='INCONCLUSIVE')));check('all-INCONCLUSIVE round stays INCONCLUSIVE',d['hypothesisVerdict']=='INCONCLUSIVE' and d['perPrediction']=={'P2':'INCONCLUSIVE'} and d['promote'])
check('hypothesis INVALID needs an INVALID prediction or an anomaly',has(errs(good(E(),hypothesisVerdict='INVALID')),'INVALID needs'))

def blowup():
    e=E();ch=e['measured']['champion']['MAE']
    e['measured']['candidates']['HUB_D6']={'head':'SEAT','kind':'XGB','final':{'MAE':476.5909570501743,'RMSE':476.73715235759573,'routeMacroMAE':476.9615980846361,'unseenRouteMAE':478.43398030598917,'over10Share':0.9627906976744186,'fullBusUnder2Share':0.0},
        'deltaVsChampionCI95':{'MAE':[473.6088866326253,475.172969218572]},'pointDeltaVsChampion':{'MAE':476.5909570501743-ch},'gatePassed':False};return e
e=blowup();check('MAE > 3x champion is flagged',[x for x in J.code_anomalies(e) if x.startswith('MAE_BLOWUP:HUB_D6')]!=[])
c=fake(good(e));d=run(e,c)
check('deterministic anomaly forces anomaly, no promotion and a stop even when the model sees none',d['anomaly'] is True and d['promote'] is False and d['champion'] is None and d['judgeChampionChoice']=='ABS_D8_R2048' and d['continue'] is False and d['stopReason']=='ANOMALY_SUSPECTED' and has(d['anomalyReasons'],'MAE_BLOWUP'))
check('the judge prompt is told about the code anomaly',"Code-level anomaly checks fired" in c.calls[0]['user'] and 'MAE_BLOWUP' in c.calls[0]['user'])
d=run(e,fake(GatewayRefused('budget')));check('fallback after a code anomaly stops the loop',d['fallback'] and d['anomaly'] and d['continue'] is False and d['stopReason']=='ANOMALY_SUSPECTED')
check('hypothesis INVALID is allowed when code found an anomaly',errs(good(e,hypothesisVerdict='INVALID'),e)==[])
def mutate(f):
    e=E();f(e['measured']);return J.code_anomalies(e)
check('non-finite metric is flagged',has(mutate(lambda m:m['candidates']['ABS_D8_R1024']['final'].update(over10Share=float('nan'))),'NON_FINITE:ABS_D8_R1024.final.over10Share'))
check('non-finite string metric is flagged',has(mutate(lambda m:m['product'].update(RMSE='Infinity')),'NON_FINITE:PRODUCT.RMSE'))
check('RMSE < MAE is flagged',has(mutate(lambda m:m['candidates']['Q50_D8_R1024']['final'].update(RMSE=2.0)),'RMSE_BELOW_MAE:Q50_D8_R1024'))
check('CI lo > hi is flagged',has(mutate(lambda m:m['candidates']['Q50_D8_R1024']['deltaVsChampionCI95'].update(MAE=[0.01,-0.02])),'CI_INVERTED:Q50_D8_R1024 MAE'))
check('point delta inconsistent with final minus champion is flagged',has(mutate(lambda m:m['candidates']['ABS_D8_R1024']['pointDeltaVsChampion'].update(MAE=-0.5)),'DELTA_INCONSISTENT:ABS_D8_R1024'))
check('gatePassed true with a non-negative MAE interval is flagged',has(mutate(lambda m:m['candidates']['ABS_D8_R1024']['deltaVsChampionCI95'].update(MAE=[-0.02,0.001])),'GATE_INCONSISTENT:ABS_D8_R1024'))
check('share outside [0,1] is flagged',has(mutate(lambda m:m['champion'].update(over10Share=1.5)),'SHARE_OUT_OF_RANGE:CHAMPION'))
check('missing champion MAE is flagged',has(mutate(lambda m:m['champion'].pop('MAE')),'CHAMPION_MAE_MISSING'))
e=E();prev=dict(e['measured']['product'])
check('same product metrics as the previous run are not flagged',J.code_anomalies(e,prev)==[])
prev['MAE']+=1e-6;d=run(e,fake(good(e)),previous_product=prev)
check('product metrics changed vs the previous run force an anomaly stop',has(d['codeAnomalies'],'PRODUCT_CHANGED:MAE') and d['anomaly'] and not d['promote'] and d['stopReason']=='ANOMALY_SUSPECTED')
e=E();o=good(e,anomaly={'suspected':True,'reasonsKo':['ABS 두 후보가 라운드 수와 무관하게 거의 같다.'],'citations':[]},continueLoop=False,stopReason='ANOMALY_SUSPECTED',stopReasonKo='버그 의심으로 멈춘다.')
d=run(e,fake(o));check('model-flagged anomaly blocks promotion and stops',d['anomaly'] and d['promote'] is False and d['champion'] is None and d['continue'] is False and d['stopReason']=='ANOMALY_SUSPECTED' and d['codeAnomalies']==[])
check('model anomaly with continueLoop true is rejected',has(errs(good(E(),anomaly={'suspected':True,'reasonsKo':['이상하다.'],'citations':[]})),'must stop the loop'))

def decline(e,pick,names,basis):
    o=good(e,pick=pick)
    o['champion']['declined']=[{'candidate':n,'basis':basis,'reasonKo':'MAE 이득이 0.01석보다 작은데 라운드가 두 배다.','citations':[cite(e,n,'MAE')]} for n in names]
    if pick:o['champion']['citations'].append(cite(e,pick,'MAE'))
    return o
e=E();o=decline(e,'ABS_D8_R1024',['ABS_D8_R2048'],'TINY_GAIN_COSTLIER');d=run(e,fake(o))
check('declining a tiny, 2x-rounds gain is accepted and recorded',errs(o,e)==[] and d['promote'] and d['champion']=='ABS_D8_R1024' and d['declined'][0]['candidate']=='ABS_D8_R2048' and d['declined'][0]['costVerified'] is True)
check('passing over a lower-MAE floor-passer without declaring it is rejected',has(errs(good(E(),pick='ABS_D8_R1024')),'floor-passer ABS_D8_R2048 has a lower MAE'))
check('TINY_GAIN_COSTLIER is rejected when the gain is not below 0.01',has(errs(decline(E(),None,['ABS_D8_R2048','ABS_D8_R1024'],'TINY_GAIN_COSTLIER')),'needs an MAE gain below 0.01'))
e=E();d=run(e,fake(decline(e,None,['ABS_D8_R2048','ABS_D8_R1024'],'OTHER')))
check('declining every floor-passer with stated reasons is allowed (no promotion, continue)',d['fallback'] is False and d['promote'] is False and d['champion'] is None and d['continue'] is True)
e=E();e['experiment']['candidates'][1]['rounds']=1024
check('TINY_GAIN_COSTLIER is rejected when the candidate is not materially more expensive',has(errs(decline(e,'ABS_D8_R1024',['ABS_D8_R2048'],'TINY_GAIN_COSTLIER'),e),'materially more expensive'))
e=E();e['experiment']['candidates'][1].update(rounds=1024,blocks='ROUTE_HORIZON')
check('blocks count as materially more expensive',errs(decline(e,'ABS_D8_R1024',['ABS_D8_R2048'],'TINY_GAIN_COSTLIER'),e)==[])
e=E();e.pop('experiment');o=decline(e,'ABS_D8_R1024',['ABS_D8_R2048'],'TINY_GAIN_COSTLIER');d=run(e,fake(o))
check('without specs a tiny-gain decline is allowed but marked unverified',errs(o,e)==[] and d['declined'][0]['costVerified'] is None)
check('declining a non-floor candidate is rejected',has(errs(decline(E(),'ABS_D8_R2048',['HUB6_MDS10_D8_R1024'],'OTHER')),'not a floor-passing candidate'))

e=E();c=fake(GatewayRefused('AI budget exhausted'));d=run(e,c)
check('GatewayRefused falls back without a retry',d['fallback'] and d['fallbackReason']=='GATEWAY_REFUSED' and len(c.calls)==1 and d['attempts'][0]['gateway']=='GATEWAY_REFUSED' and d['promote'] is False and d['continue'] is True and d['perPrediction']==e['mechanicalVerdicts'])
c=fake(BudgetRefused('x'));check('a GatewayRefused subclass is recognised',run(E(),c)['fallbackReason']=='GATEWAY_REFUSED')
bad=good(E(),pick='HUB6_MDS10_D8_R1024');c=fake(bad,GatewayRefused('day cap'));d=run(E(),c)
check('GatewayRefused on the retry falls back',d['fallback'] and len(c.calls)==2 and d['attempts'][1]['gateway']=='GATEWAY_REFUSED')
e=E();c=fake(GatewayFailed('INVALID_OUTPUT','SCHEMA',{'schemaError':'$.champion.candidate:anyOf','chargedUSD':0.3}),good(e));d=run(e,c)
check('gateway INVALID_OUTPUT is a rejected answer: re-asked with the reason, then accepted',d['fallback'] is False and d['promote'] and len(c.calls)==2 and '$.champion.candidate:anyOf' in c.calls[1]['user'] and d['attempts'][0]['gateway']=='INVALID_OUTPUT' and abs(d['aiCostUSD']-0.42)<1e-9)
bad=GatewayFailed('INVALID_OUTPUT','SCHEMA');c=fake(bad,bad);d=run(E(),c)
check('gateway INVALID_OUTPUT twice falls back',d['fallback'] and d['fallbackReason']=='VALIDATION_FAILED_TWICE' and len(c.calls)==2)
c=fake(GatewayFailed('BUDGET_STOP','MAX_BUDGET_USD',{'chargedUSD':1.0}));d=run(E(),c)
check('gateway BUDGET_STOP falls back without a retry',d['fallback'] and d['fallbackReason']=='GATEWAY_BUDGET_STOP' and len(c.calls)==1 and d['aiCostUSD']==1.0 and '비용 상한' in d['summaryKo'])
try:run(E(),fake(GatewayFailed('TIMEOUT','TIMEOUT')));raised=False
except GatewayFailed:raised=True
check('gateway TIMEOUT propagates',raised)
try:run(E(),fake(RuntimeError('cli crashed')));raised=False
except RuntimeError:raised=True
check('other gateway exceptions propagate',raised)

def mod(f):o=good(E());f(o);return errs(o)
check('enum: unknown verdict',has(mod(lambda o:o['perPrediction'][0].update(verdict='MAYBE')),'is not one of'))
check('enum: unknown hypothesis verdict',has(mod(lambda o:o.update(hypothesisVerdict='LIKELY')),'$.hypothesisVerdict'))
check('enum: unknown stop reason',has(mod(lambda o:o.update(continueLoop=False,stopReason='BORED',stopReasonKo='지루하다.')),'$.stopReason'))
check('enum: unknown citation kind',has(mod(lambda o:o['champion']['citations'][0].update(kind='mean')),'is not one of'))
check('enum: unknown decline basis',has(mod(lambda o:o['champion']['declined'].append({'candidate':'ABS_D8_R1024','basis':'VIBES','reasonKo':'그냥.','citations':[]})),'is not one of'))
check('schema: missing key',has(mod(lambda o:o.pop('summaryKo')),'missing key summaryKo'))
check('schema: unexpected key',has(mod(lambda o:o.update(confidence=0.9)),'unexpected key confidence'))
check('schema: boolean expected',has(mod(lambda o:o.update(continueLoop='yes')),'$.continueLoop: expected boolean'))
check('schema: number expected (string or bool is not a number)',has(mod(lambda o:o['champion']['citations'][0].update(value='2.2')),'expected a number') and has(mod(lambda o:o['champion']['citations'][0].update(value=True)),'expected a number'))
check('schema: output must be an object',J.validate([],E())==['$: expected object'])
check('stop: continueLoop true with a stopReason is rejected',has(mod(lambda o:o.update(stopReason='NO_IMPROVEMENT_ROOM')),'requires stopReason null'))
check('stop: continueLoop false without a stopReason is rejected',has(mod(lambda o:o.update(continueLoop=False)),'requires a stopReason'))
check('stop: stopping needs a Korean reason',has(mod(lambda o:o.update(continueLoop=False,stopReason='NO_IMPROVEMENT_ROOM')),'stopReasonKo is empty'))
check('stop: ANOMALY_SUSPECTED without anomaly is rejected',has(mod(lambda o:o.update(continueLoop=False,stopReason='ANOMALY_SUSPECTED',stopReasonKo='멈춘다.')),'requires anomaly.suspected true'))
e=E();d=run(e,fake(good(e,continueLoop=False,stopReason='NO_IMPROVEMENT_ROOM',stopReasonKo='남은 탐색 범위에서 의미 있는 개선 여지가 작다.')))
check('stop: an early judge stop is reported as JUDGE_STOP and may still promote',d['continue'] is False and d['stopReason']=='JUDGE_STOP' and d['judgeStopReason']=='NO_IMPROVEMENT_ROOM' and d['promote'] and d['anomaly'] is False)
check('language: English summary is rejected',has(mod(lambda o:o.update(summaryKo='Promote ABS_D8_R2048.')),'must be written in Korean'))
check('predictions: missing one is rejected',has(mod(lambda o:o['perPrediction'].pop()),'P4 must appear exactly once'))
check('predictions: duplicate is rejected',has(mod(lambda o:o['perPrediction'].append(copy.deepcopy(o['perPrediction'][0]))),'P1 must appear exactly once'))
check('predictions: unknown id is rejected',has(mod(lambda o:o['perPrediction'][0].update(id='P9')),'unknown prediction id P9'))
bad=good(E(),hypothesisVerdict='MAYBE');d=run(E(),fake(bad,bad));check('schema violations twice fall back',d['fallback'] and d['fallbackReason']=='VALIDATION_FAILED_TWICE')

e=E();e['measured']['champion']['predictions']={'path':'/workspace/salmonbus-full-v1/outputs/X/worker/V2_D8.dev-pred.npy'}
t=J.build_context(e,'AUTOLOOP_001: SWEEP_EXIT_1, log at /Users/someone/private/run.log and ~/notes.txt',POLICY,3)
check('context: no local paths survive',all(s not in t for s in ('/Users/','/workspace/','~/','dev-pred.npy')) and '<path>' in t)
pl=json.loads(t.split('PAYLOAD:\n',1)[1])
check('context: payload is JSON with whitelisted, rounded measured data',pl['measured']['champion']['MAE']==p8(e['measured']['champion']['MAE']) and 'predictions' not in pl['measured']['champion'] and 'metricsSha256' not in json.dumps(pl) and pl['floorPassersByMAE'][0]['candidate']=='ABS_D8_R2048')
check('context: loop state and safety ceiling are stated',pl['loopState']=={'consecutiveNoImprovementBeforeThisRound':3,'safetyCeiling':8,'countIfNoPromotionThisRound':4} and 'stops by itself at 8' in t and 'ABS_D8_R2048, ABS_D8_R1024' in t)
check('context: cost hints carry rounds for the tiny-gain rule',pl['costHints']['candidates']['ABS_D8_R2048']['rounds']==2048 and pl['costHints']['champion']['rounds']==1024)
check('context: policy objective and gate only',set(pl['policy'])=={'objective','gate'})
def journal_shape(e):
    e=copy.deepcopy(e);m=e['measured'];mech=e['mechanicalVerdicts'];m.pop('product')
    for c in m['candidates'].values():
        for k in ('pointDeltaVsChampion','guardWorsened','kind'):c.pop(k,None)
    m['champion']={k:m['champion'].get(k) for k in ('modelId','MAE','RMSE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')}
    e['mechanicalVerdicts']=[{'id':p['id'],'candidate':p['candidate'],'metric':p['metric'],'direction':p['direction'],'minEffect':p['minEffect'],'interval':m['candidates'][p['candidate']]['deltaVsChampionCI95'][p['metric']],'verdict':mech[p['id']],'cause':None} for p in e['preregistration']['predictions']]
    for k in ('experiment','championSpec'):e.pop(k)
    e.update(type='RUN',status='COMPLETED');return e
j=journal_shape(BASE);c=fake(good(j));d=run(j,c,history_digest=[{'runId':'AUTOLOOP_001','status':'INFRASTRUCTURE_FAILURE','predictions':[],'lessons':[]}])
check('journal shape: list-form mechanical verdicts are normalised and promotion works',J.code_anomalies(j)==[] and d['promote'] and d['champion']=='ABS_D8_R2048' and d['mechanicalVerdicts']==BASE['mechanicalVerdicts'] and d['perPrediction']==BASE['mechanicalVerdicts'])
check('journal shape: a list history digest is serialised into the context',"AUTOLOOP_001" in c.calls[0]['user'] and 'INFRASTRUCTURE_FAILURE' in c.calls[0]['user'])
dp=cite(j,'ABS_D8_R2048','MAE','deltaPoint');pl=json.loads(c.calls[0]['user'].split('PAYLOAD:\n',1)[1])
check('journal shape: deltaPoint is derived as final minus champion and shown in the payload',abs(dp['value']-(j['measured']['candidates']['ABS_D8_R2048']['final']['MAE']-j['measured']['champion']['MAE']))<1e-8 and pl['measured']['candidates']['ABS_D8_R2048']['pointDeltaVsChampion']['MAE']==dp['value'])
o=good(j);o['anomaly']['citations']=[{'candidate':'PRODUCT','metric':'MAE','value':3.1445112,'kind':'final'}]
check('journal shape: PRODUCT citations are unavailable when the entry has no product',has(J.validate(o,j),'PRODUCT final MAE is not available'))
check('journal shape: previous product without a current one is an anomaly',has(J.code_anomalies(j,{'MAE':3.1445,'RMSE':5.03}),'PRODUCT_MISSING'))
check('journal shape: no cost hints means a tiny-gain decline is allowed but unverified',run(j,fake(decline(j,'ABS_D8_R1024',['ABS_D8_R2048'],'TINY_GAIN_COSTLIER')))['declined'][0]['costVerified'] is None)
import shutil,tempfile
JN=J._ai_module('journal');TMP=Path(tempfile.mkdtemp(prefix='judge-round-test-'))
def round_inputs(mutate=None):
    e=E();m={'schema':'AUTOLOOP_DEV_S_METRICS/1','experiment':e['experimentId'],'champion':e['measured']['champion'],'product':e['measured']['product'],'candidates':e['measured']['candidates']}
    if mutate:mutate(m)
    d=Path(tempfile.mkdtemp(dir=TMP));(d/'metrics.json').write_text(json.dumps(m))
    plan={'experiment':{**e['experiment'],'hypothesis':e['hypothesis']},'rationale':e['rationale'],'expectedEffect':e['expectedEffect'],'preregistration':e['preregistration']}
    return d,plan
STATE={'consecutiveNoImprovement':2,'champion':{'modelId':'SEAT.V2_D8','spec':E()['championSpec']}}
RPOL={**POLICY,'stop':{**POLICY['stop'],'noImprovementRounds':8}}
def dfake(script):
    calls=[]
    def call(**kw):
        calls.append(kw);o=script.get(kw['purpose'],script.get('*'))
        if callable(o):o=o(kw)
        if isinstance(o,BaseException):raise o
        return copy.deepcopy(o),{'costUSD':0.05,'chargedUSD':0.05,'model':kw['model']}
    call.calls=calls;return call
APPROVE={'verdict':'APPROVE','summary':'No blocking issue.','items':[]}
def AUTH(o):return {'artifact':o,'responses':[]}
def jr(d,plan,call,**kw):
    args=dict(run_id='AUTOLOOP_002',plan=plan,metrics_path=d/'metrics.json',state=STATE,policy=RPOL,call=call,persist_dir=d/'persist',journal_path=d/'journal.jsonl');args.update(kw);return J.judge_round(**args)
d,plan=round_inputs();c=dfake({'debate:judge:author:r1':AUTH(good(E())),'debate:judge:reviewer:r1':APPROVE});r=jr(d,plan,c)
rows=JN.entries(d/'journal.jsonl');rec=json.loads((d/'persist/judge-debate.json').read_bytes())
check('judge_round: AGREED promotes the floor-passer and returns debate fields',r['debateStatus']=='AGREED' and r['debateRounds']==1 and r['promote'] and r['champion']=='ABS_D8_R2048' and r['fallback'] is False and abs(r['aiCostUSD']-0.10)<1e-9 and r['proseNumberRejections']==0)
check('judge_round: journal gets the RUN entry then an ANNOTATION with the decision summary and lessons',[x['type'] for x in rows]==['RUN','ANNOTATION'] and rows[1]['judge']['champion']=='ABS_D8_R2048' and rows[1]['judge']['debateStatus']=='AGREED' and rows[1]['lessons']==good(E())['lessonsKo'] and r['journalEntrySha256']==rows[0]['sha256'])
check('judge_round: the debate record is persisted and the roles/purposes reach the gateway',rec['status']=='AGREED' and [k['purpose'] for k in c.calls]==['debate:judge:author:r1','debate:judge:reviewer:r1'] and [k['role'] for k in c.calls]==['judge','judge-review'] and c.calls[1]['effort']=='medium')
check('judge_round: list verdicts from the real journal are normalised and the ceiling comes from policy',r['mechanicalVerdicts']==BASE['mechanicalVerdicts'] and 'stops by itself at 8' in c.calls[0]['user'] and all('/Users/' not in k['user'] and '/private/' not in k['user'] for k in c.calls))
r2=jr(d,plan,dfake({'debate:judge:author:r1':AUTH(good(E())),'debate:judge:reviewer:r1':APPROVE}))
check('judge_round: a second call reuses the journaled RUN entry and annotates again',r2['debateStatus']=='AGREED' and [x['type'] for x in JN.entries(d/'journal.jsonl')]==['RUN','ANNOTATION','ANNOTATION'])
d,plan=round_inputs();bad=AUTH(good(E(),pick='HUB6_MDS10_D8_R1024'));c=dfake({'*':bad});r=jr(d,plan,c)
check('judge_round: promoting a non-floor candidate twice is AUTHOR_INVALID and falls back',r['debateStatus']=='AUTHOR_INVALID' and r['fallback'] and r['fallbackReason']=='AUTHOR_INVALID' and not r['promote'] and r['continue'] and len(c.calls)==2 and 'not a floor-passing' in c.calls[1]['user'])
blk={'verdict':'REVISE','summary':'J1 violated.','items':[{'itemId':'B1','severity':'BLOCKING','citations':['J1'],'objection':'x','requestedChange':'y'}]}
reb={'artifact':good(E()),'responses':[{'itemId':'B1','action':'REBUT','reason':'gatePassed is true','citation':'J1'}]}
d,plan=round_inputs();r=jr(d,plan,dfake({'debate:judge:author:r1':AUTH(good(E())),'debate:judge:reviewer:r1':blk,'debate:judge:author:r2':reb,'debate:judge:reviewer:r2':blk}))
check('judge_round: a reviewer deadlock falls back to no promotion',r['debateStatus']=='DEADLOCK' and r['fallbackReason']=='DEBATE_DEADLOCK' and not r['promote'] and r['debateRounds']==2 and r['attempts'][1]['blocking']==['B1'])
d,plan=round_inputs();r=jr(d,plan,dfake({'*':GatewayRefused('AI_BUDGET_TODAY')}))
check('judge_round: GatewayRefused is REFUSED and falls back',r['debateStatus']=='REFUSED' and r['fallbackReason']=='GATEWAY_REFUSED' and r['continue'] and not r['promote'])
d,plan=round_inputs();c=dfake({'debate:judge:author:r1':GatewayFailed('INVALID_OUTPUT','SCHEMA',{'schemaError':'$.artifact.champion:required','chargedUSD':0.2}),'debate:judge:author:r2':AUTH(good(E())),'debate:judge:reviewer:r2':APPROVE});r=jr(d,plan,c)
check('judge_round: a gateway INVALID_OUTPUT is re-asked with the schema error and can still agree',r['debateStatus']=='AGREED' and r['promote'] and r['attempts'][0]['status']=='INVALID_OUTPUT' and 'gateway schema check rejected' in c.calls[1]['user'] and abs(r['aiCostUSD']-0.30)<1e-9)
d,plan=round_inputs();r=jr(d,plan,dfake({'*':GatewayFailed('BUDGET_STOP','MAX_BUDGET_USD',{'chargedUSD':0.7})}))
check('judge_round: a gateway BUDGET_STOP stops the debate and falls back, charging the call',r['debateStatus']=='REFUSED' and r['fallbackReason']=='GATEWAY_BUDGET_STOP' and abs(r['aiCostUSD']-0.7)<1e-9)
d,plan=round_inputs()
try:jr(d,plan,dfake({'*':GatewayFailed('TIMEOUT','TIMEOUT',{'chargedUSD':1.0})}));raised=False
except GatewayFailed:raised=True
check('judge_round: other gateway failures propagate and the record is persisted as ERROR',raised and json.loads((d/'persist/judge-debate.json').read_bytes())['status']=='ERROR')
def blow(m):m['candidates']['HUB_D6']={'head':'SEAT','final':{'MAE':476.59,'RMSE':476.74},'deltaVsChampionCI95':{'MAE':[473.6,475.2]},'gatePassed':False}
d,plan=round_inputs(blow);c=dfake({'*':AUTH(good(E()))});r=jr(d,plan,c)
check('judge_round: with a code anomaly the artifact must flag it, otherwise fallback stops the loop',r['debateStatus']=='AUTHOR_INVALID' and 'code-level anomaly checks fired' in c.calls[1]['user'] and r['anomaly'] and not r['continue'] and r['stopReason']=='ANOMALY_SUSPECTED')
flag=good(E(),pick=None,anomaly={'suspected':True,'reasonsKo':['HUB_D6 MAE가 챔피언의 세 배를 넘는다.'],'citations':[]},continueLoop=False,stopReason='ANOMALY_SUSPECTED',stopReasonKo='버그 의심으로 멈춘다.',summaryKo='이상 징후로 승격하지 않는다.')
flag['champion']['declined']=[{'candidate':n,'basis':'OTHER','reasonKo':'이상 징후가 풀릴 때까지 보류한다.','citations':[cite(E(),n,'MAE')]} for n in ('ABS_D8_R2048','ABS_D8_R1024')]
d,plan=round_inputs(blow);r=jr(d,plan,dfake({'debate:judge:author:r1':AUTH(flag),'debate:judge:reviewer:r1':APPROVE}))
check('judge_round: an agreed anomaly decision stops with ANOMALY_SUSPECTED and no promotion',r['debateStatus']=='AGREED' and r['anomaly'] and not r['promote'] and r['stopReason']=='ANOMALY_SUSPECTED' and has(r['anomalyReasons'],'MAE_BLOWUP'))
stop=good(E(),continueLoop=False,stopReason='NO_IMPROVEMENT_ROOM',stopReasonKo='남은 탐색 범위에서 개선 여지가 작다.')
d,plan=round_inputs();r=jr(d,plan,dfake({'debate:judge:author:r1':AUTH(stop),'debate:judge:reviewer:r1':APPROVE}))
check('judge_round: a non-anomaly judge stop is JUDGE_STOP',r['stopReason']=='JUDGE_STOP' and r['judgeStopReason']=='NO_IMPROVEMENT_ROOM' and r['continue'] is False and JN.entries(d/'journal.jsonl')[-1]['judge']['stopReason']=='JUDGE_STOP')
d,plan=round_inputs();c=dfake({'*':AUTH(good(E()))});r=jr(d,plan,c,policy={**RPOL,'debate':{'maxTotalUSD':0.005}})
check('judge_round: a debate budget below the minimum call is BUDGET with no call',r['debateStatus']=='BUDGET' and r['fallbackReason']=='DEBATE_BUDGET' and c.calls==[])
d,plan=round_inputs();CLm=JN.CL;prev={'type':'RUN','runId':'AUTOLOOP_001','status':'COMPLETED','measured':{'product':{'MAE':9.9,'RMSE':9.99}},'mechanicalVerdicts':[]}
CLm.append(d/'journal.jsonl',CLm.read(d/'journal.jsonl'),prev);c=dfake({'*':AUTH(good(E()))});r=jr(d,plan,c)
check('judge_round: previous product comes from the journal and a change forces an anomaly',has(r['codeAnomalies'],'PRODUCT_CHANGED:MAE') and r['anomaly'] and not r['promote'] and 'AUTOLOOP_001' in c.calls[0]['user'])
d,plan=round_inputs();r=jr(d,plan,dfake({'*':AUTH(good(E()))}),metrics_path=None)
check('judge_round: a run without metrics skips the debate and falls back',r['debateStatus']=='SKIPPED' and r['fallbackReason']=='NO_MEASUREMENT' and r['attempts']==[] and not r['promote'])
d,plan=round_inputs();jr(d,plan,dfake({'debate:judge:author:r1':AUTH(good(E())),'debate:judge:reviewer:r1':APPROVE}));m=json.loads((d/'metrics.json').read_bytes());m['product']['MAE']+=0.5;(d/'metrics.json').write_text(json.dumps(m))
try:jr(d,plan,dfake({'*':AUTH(good(E()))}));raised=None
except ValueError as x:raised=str(x)
check('judge_round: metrics changed after journaling are refused',raised=='METRICS_CHANGED_SINCE_JOURNAL')
import types
real_db=sys.modules['autoloop_ai_debate'];stub=types.ModuleType('stub_debate')
stub.run=lambda **kw:{'status':'AGREED','reason':'APPROVED','artifact':good(E(),pick='HUB6_MDS10_D8_R1024'),'rounds':1,'transcript':[],'costUSD':0.0}
sys.modules['autoloop_ai_debate']=stub
try:d,plan=round_inputs();r=jr(d,plan,dfake({}))
finally:sys.modules['autoloop_ai_debate']=real_db
check('judge_round: an AGREED artifact is re-validated by code (non-floor promotion is refused)',r['fallback'] and r['fallbackReason']=='AGREED_ARTIFACT_INVALID' and not r['promote'] and r['champion'] is None)
shutil.rmtree(TMP,ignore_errors=True)
print('ALL_PASS')
