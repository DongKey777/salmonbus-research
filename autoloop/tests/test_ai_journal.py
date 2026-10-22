"""Tests for ai/journal.py: pre-registration validation, mechanical verdicts (boundaries and INCONCLUSIVE never REFUTED), append-only hash-chained entries with numbers only from the metrics file, and digest determinism."""
import json,random,shutil,sys,tempfile
from pathlib import Path
A=Path(__file__).resolve().parents[1];sys.path.insert(0,str(A/'ai'))
import journal as J,chainlog as CL
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
def err(fn):
    try:fn();return None
    except Exception as e:return str(e)
TMP=Path(tempfile.mkdtemp(prefix='ai-journal-test-'))
EXP={'id':'EXP_TEST_001','hypothesis':'중앙값 목적함수가 MAE를 낮춘다는 가설이다.','candidates':[{'candidate':'ABS','kind':'XGB','head':'SEAT'},{'candidate':'HUB','kind':'XGB','head':'SEAT'},{'candidate':'FULLP','kind':'XGB','head':'FULL'}]}
def pred(i='P1',cand='ABS',metric='MAE',direction='lower',m=0.02,**kw):return {'id':i,'candidate':cand,'metric':metric,'comparator':'CHAMPION','direction':direction,'minEffect':m,'why':'중앙값을 맞춘다',**kw}
def prereg(*ps):return {'predictions':list(ps),'refutedIf':'ABS의 MAE 차 구간이 -0.02보다 위에 있으면 반박된다.'}
check('valid pre-registration passes',J.validate_prereg(prereg(pred(),pred('P2','HUB','fullBusUnder2Share','higher',0.05)),EXP) is not None)
for name,pr,codep in (('unknown candidate',prereg(pred(cand='NOPE')),'PREREG_CANDIDATE'),('FULL head',prereg(pred(cand='FULLP')),'PREREG_NOT_SEAT'),('negative minEffect',prereg(pred(m=-0.01)),'PREREG_MIN_EFFECT'),
                      ('share minEffect in percent units',prereg(pred(metric='over10Share',m=5)),'PREREG_MIN_EFFECT'),('MAE minEffect too large',prereg(pred(m=1.5)),'PREREG_MIN_EFFECT'),('boolean minEffect',prereg(pred(m=True)),'PREREG_MIN_EFFECT'),
                      ('NaN minEffect',prereg(pred(m=float('nan'))),'PREREG_MIN_EFFECT'),('comparator other than CHAMPION',prereg({**pred(),'comparator':'HUB'}),'PREREG_COMPARATOR'),('metric outside the list',prereg(pred(metric='RMSE')),'PREREG_METRIC'),
                      ('direction',prereg(pred(direction='down')),'PREREG_DIRECTION'),('duplicate id',prereg(pred(),pred(metric='over10Share')),'PREREG_ID'),('duplicate candidate-metric pair',prereg(pred(),pred('P2')),'PREREG_DUPLICATE'),
                      ('extra field',prereg({**pred(),'extra':1}),'PREREG_PREDICTION_FIELDS'),('no predictions',prereg(),'PREREG_PREDICTIONS'),('missing refutedIf',{'predictions':[pred()]},'PREREG_FIELDS'),('unhashable candidate',prereg(pred(cand=['ABS'])),'PREREG_CANDIDATE')):
    e=err(lambda:J.validate_prereg(pr,EXP));check('pre-registration refused: '+name,e is not None and e.startswith(codep))
V=J.verdict
for name,args,want in (('lower: whole interval below -m',('lower',0.02,-0.05,-0.03),'SUPPORTED'),('lower: hi exactly -m is not SUPPORTED',('lower',0.02,-0.05,-0.02),'INCONCLUSIVE'),
                       ('lower: significant but smaller than m is INCONCLUSIVE',('lower',0.02,-0.03,-0.01),'INCONCLUSIVE'),('lower: interval across zero and -m is INCONCLUSIVE',('lower',0.02,-0.03,0.01),'INCONCLUSIVE'),
                       ('lower: whole interval above -m is REFUTED',('lower',0.02,-0.01,0.01),'REFUTED'),('lower: lo exactly -m is not REFUTED',('lower',0.02,-0.02,0.01),'INCONCLUSIVE'),
                       ('lower m=0: wide interval across zero is INCONCLUSIVE, not REFUTED',('lower',0.0,-0.01,0.01),'INCONCLUSIVE'),('lower m=0: significantly worse is REFUTED',('lower',0.0,0.001,0.02),'REFUTED'),
                       ('lower m=0: zero-width interval at 0 is INCONCLUSIVE',('lower',0.0,0.0,0.0),'INCONCLUSIVE'),
                       ('higher: whole interval above m',('higher',0.05,0.06,0.1),'SUPPORTED'),('higher: lo exactly m is not SUPPORTED',('higher',0.05,0.05,0.1),'INCONCLUSIVE'),
                       ('higher: whole interval below m is REFUTED',('higher',0.05,0.0,0.04),'REFUTED'),('higher: interval across m is INCONCLUSIVE',('higher',0.05,0.03,0.08),'INCONCLUSIVE'),
                       ('higher: hi exactly m is not REFUTED',('higher',0.05,0.0,0.05),'INCONCLUSIVE')):
    check('verdict '+name,V(*args)==want)
rng=random.Random(20261022);bad=0
for _ in range(20000):
    m=rng.choice([0.0,rng.uniform(0,0.2)]);a,b=sorted(rng.uniform(-0.3,0.3) for _ in range(2));d=rng.choice(['lower','higher']);t=-m if d=='lower' else m;v=V(d,m,a,b)
    bad+=(a<=t<=b and v!='INCONCLUSIVE') or (v=='REFUTED' and not ((d=='lower' and a>t) or (d=='higher' and b<t))) or (v=='SUPPORTED' and not ((d=='lower' and b<t) or (d=='higher' and a>t)))
check('20000 random intervals: any interval containing the threshold is INCONCLUSIVE; REFUTED and SUPPORTED only when wholly on one side',bad==0)
def cand(head='SEAT',mae=2.05,ci=None,gate=False):
    if head=='FULL':return {'head':'FULL','final':{'Brier':0.1,'meanProbability':0.2}}
    return {'head':'SEAT','kind':'XGB','final':{'MAE':mae,'RMSE':3.0,'routeMacroMAE':2.2,'unseenRouteMAE':2.4,'over10Share':0.02,'fullBusUnder2Share':0.5},'deltaVsChampionCI95':ci,'pointDeltaVsChampion':{'MAE':mae-2.1},'guardWorsened':{'over10Share':False},'gatePassed':gate,'curveMAE':{'1024':mae}}
CI_A={'MAE':[-0.061,-0.042],'routeMacroMAE':[-0.05,0.01],'unseenRouteMAE':None,'over10Share':[0.001,0.004],'fullBusUnder2Share':[0.06,0.09]}
CI_H={'MAE':[-0.012,0.004],'routeMacroMAE':[-0.02,0.02],'unseenRouteMAE':[-0.01,0.02],'over10Share':[-0.002,0.001],'fullBusUnder2Share':[0.0,0.03]}
PRODUCT={'MAE':2.9,'RMSE':4.1,'routeMacroMAE':3.0,'unseenRouteMAE':3.3,'over10Share':0.05,'fullBusUnder2Share':0.2,'fullChance':0.12}
METRICS={'schema':'AUTOLOOP_DEV_S_METRICS/1','experiment':'EXP_TEST_001','champion':{'modelId':'SEAT.V2_D8','MAE':2.1,'RMSE':3.1,'routeMacroMAE':2.25,'unseenRouteMAE':2.5,'over10Share':0.021,'fullBusUnder2Share':0.43},'product':PRODUCT,
         'candidates':{'ABS':cand(mae=2.049,ci=CI_A,gate=True),'HUB':cand(mae=2.096,ci=CI_H),'FULLP':cand('FULL')}}
PR=prereg(pred('P1','ABS','MAE','lower',0.02),pred('P2','ABS','unseenRouteMAE','lower',0.0),pred('P3','HUB','MAE','lower',0.01),pred('P4','ABS','fullBusUnder2Share','higher',0.1),pred('P5','HUB','over10Share','lower',0.0),pred('P6','GONE','MAE','lower',0.0))
vs={v['id']:v for v in J.mechanical_verdicts(PR,METRICS)}
check('mechanical verdicts from deltaVsChampionCI95',vs['P1']['verdict']=='SUPPORTED' and vs['P1']['interval']==[-0.061,-0.042] and vs['P3']['verdict']=='INCONCLUSIVE' and vs['P4']['verdict']=='REFUTED' and vs['P5']['verdict']=='INCONCLUSIVE')
check('missing interval and missing candidate are INVALID',vs['P2']['verdict']=='INVALID' and vs['P2']['cause']=='MISSING_INTERVAL' and vs['P6']['verdict']=='INVALID' and vs['P6']['cause']=='MISSING_CANDIDATE')
m2=json.loads(json.dumps(METRICS));m2['candidates']['ABS']['head']='FULL'
check('a non-SEAT candidate in metrics is INVALID',J.mechanical_verdicts(prereg(pred()),m2)[0]['cause']=='NOT_SEAT')
m3=json.loads(json.dumps(METRICS));m3['candidates']['ABS']['deltaVsChampionCI95']['MAE']=[0.1,-0.1]
check('an inverted interval is INVALID',J.mechanical_verdicts(prereg(pred()),m3)[0]['verdict']=='INVALID')
check('failed run makes every prediction INVALID with RUN_FAILED',all(v['verdict']=='INVALID' and v['cause']=='RUN_FAILED' for v in J.mechanical_verdicts(PR,METRICS,failure='SWEEP_EXIT_1')))
check('no metrics makes every prediction INVALID',all(v['verdict']=='INVALID' and v['cause']=='NO_METRICS' for v in J.mechanical_verdicts(PR,None)))
check('wrong metrics schema is INVALID',all(v['verdict']=='INVALID' for v in J.mechanical_verdicts(PR,{**METRICS,'schema':'OTHER'})))
mp=TMP/'metrics.json';mp.write_bytes(CL.canonical(METRICS)+b'\n')
PLAN={'schema':'AUTOLOOP_PLAN/1','experiment':EXP,'rationale':'근거: 챔피언 MAE 9.99라고 모델이 잘못 썼다.','expectedEffect':'MAE가 0.5 낮아질 것으로 본다.','preregistration':PR}
jp=TMP/'journal.jsonl'
CHSPEC={'kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','params':{'max_depth':8,'eta':0.1},'rounds':1024}
check('a non-dict championSpec is refused',err(lambda:J.append_entry(run_id='AUTOLOOP_003',plan=PLAN,metrics_path=mp,champion_spec='SEAT.V2_D8',path=jp))=='CHAMPION_SPEC' and not jp.exists())
e=J.append_entry(run_id='AUTOLOOP_003',plan=PLAN,metrics_path=mp,champion_spec=CHSPEC,path=jp)
check('entry carries measured.product, the experiment with candidate specs and championSpec',e['measured']['product']==PRODUCT and e['experiment']==EXP and e['championSpec']==CHSPEC)
check('entry keeps point deltas, guard flags, curves and kind per candidate from the metrics file',{k:e['measured']['candidates']['ABS'][k] for k in ('pointDeltaVsChampion','guardWorsened','curveMAE','kind')}=={k:METRICS['candidates']['ABS'][k] for k in ('pointDeltaVsChampion','guardWorsened','curveMAE','kind')} and e['measured']['candidates']['FULLP']=={'head':'FULL','final':{'Brier':0.1,'meanProbability':0.2},'deltaVsChampionCI95':None,'gatePassed':None})
check('entry copies numbers from the metrics file and pins its sha256',e['measured']['metricsSha256']==CL.sha(mp.read_bytes()) and e['measured']['candidates']['ABS']['final']['MAE']==2.049 and e['measured']['champion']['MAE']==2.1
      and e['measured']['candidates']['ABS']['deltaVsChampionCI95']==CI_A and e['measured']['candidates']['ABS']['gatePassed'] is True)
check('entry carries plan text, pre-registration, verdicts and empty judge/lessons',e['hypothesis']==EXP['hypothesis'] and e['rationale']==PLAN['rationale'] and e['preregistration']==PR and len(e['mechanicalVerdicts'])==6 and e['judge'] is None and e['lessons']==[] and e['status']=='COMPLETED')
check('champion change derived from gatePassed and MAE like the loop',e['championChange']=={'from':'SEAT.V2_D8','to':'SEAT.AUTOLOOP_003_ABS','candidate':'ABS','devSMAE':2.049,'previousDevSMAE':2.1})
check('duplicate run is refused',err(lambda:J.append_entry(run_id='AUTOLOOP_003',plan=PLAN,metrics_path=mp,path=jp))=='JOURNAL_DUPLICATE_RUN')
check('metrics of another experiment are refused',err(lambda:J.append_entry(run_id='AUTOLOOP_009',plan={**PLAN,'experiment':{**EXP,'id':'OTHER_EXP'}},metrics_path=mp,path=jp))=='METRICS_EXPERIMENT_MISMATCH')
check('COMPLETED without metrics is refused',err(lambda:J.append_entry(run_id='AUTOLOOP_009',plan=PLAN,status='COMPLETED',path=jp))=='COMPLETED_WITHOUT_METRICS')
f=J.append_entry(run_id='AUTOLOOP_004',plan={**PLAN,'experiment':{**EXP,'id':'EXP_TEST_002'}},status='INFRASTRUCTURE_FAILURE',failure='SWEEP_EXIT_1: worker IndexError on 1-D quantile predictions',path=jp)
check('failed run is journaled with every prediction INVALID',f['measured'] is None and f['status']=='INFRASTRUCTURE_FAILURE' and all(v['verdict']=='INVALID' and v['cause']=='RUN_FAILED' for v in f['mechanicalVerdicts']))
old={'schema':'AUTOLOOP_PLAN/1','experiment':{**EXP,'id':'EXP_OLD','hypothesis':'가'*400},'rationale':'r','expectedEffect':'e'}
g=J.append_entry(run_id='AUTOLOOP_005',plan=old,status='PLANNER_FAILED',failure='x'*900,path=jp)
check('plan without pre-registration gets no verdicts and the failure is capped',g['mechanicalVerdicts']==[] and len(g['failure'])==500)
J.annotate(run_id='AUTOLOOP_003',judge={'score':0.8},lessons=['L1 중앙값 목적함수가 유효했다'],path=jp)
check('annotation for an unknown run is refused',err(lambda:J.annotate(run_id='AUTOLOOP_099',lessons=['x'],path=jp))=='JOURNAL_UNKNOWN_RUN')
d1=J.digest(path=jp);d2=J.digest(path=jp)
check('digest is deterministic across calls',d1==d2 and json.dumps(d1,sort_keys=True)==json.dumps(d2,sort_keys=True))
jp2=TMP/'journal2.jsonl'
J.append_entry(run_id='AUTOLOOP_003',plan=PLAN,metrics_path=mp,path=jp2);J.append_entry(run_id='AUTOLOOP_004',plan={**PLAN,'experiment':{**EXP,'id':'EXP_TEST_002'}},status='INFRASTRUCTURE_FAILURE',failure='SWEEP_EXIT_1: worker IndexError on 1-D quantile predictions',path=jp2)
J.append_entry(run_id='AUTOLOOP_005',plan=old,status='PLANNER_FAILED',failure='x'*900,path=jp2);J.annotate(run_id='AUTOLOOP_003',judge={'score':0.8},lessons=['L1 중앙값 목적함수가 유효했다'],path=jp2)
check('digest ignores timestamps: an identical journal written later gives the same digest',J.digest(path=jp2)==d1 and jp2.read_bytes()!=jp.read_bytes())
r3=d1[0];pp={p['id']:p for p in r3['predictions']}
check('digest shows predictions with verdicts and measured intervals',pp['P1']['verdict']=='SUPPORTED' and pp['P1']['interval']==[-0.061,-0.042] and pp['P2']['cause']=='MISSING_INTERVAL' and pp['P2']['interval'] is None)
check('digest shows champion change, gate passes and annotated lessons',r3['championChange']['to']=='SEAT.AUTOLOOP_003_ABS' and r3['gatePassed']==['ABS'] and r3['lessons']==['L1 중앙값 목적함수가 유효했다'])
check('digest includes failed runs with their cause',d1[1]['status']=='INFRASTRUCTURE_FAILURE' and d1[1]['cause'].startswith('SWEEP_EXIT_1') and all(p['verdict']=='INVALID' for p in d1[1]['predictions']))
check('digest truncates long text',len(d1[2]['hypothesis'])==280 and len(d1[2]['cause'])==240)
check('digest keeps only the last max_entries runs',[x['runId'] for x in J.digest(max_entries=2,path=jp)]==['AUTOLOOP_004','AUTOLOOP_005'] and J.digest(max_entries=0,path=jp)==[])
check('digest of a missing journal is empty and creates nothing',J.digest(path=TMP/'none.jsonl')==[] and not (TMP/'none.jsonl.lock').exists())
raw=jp.read_bytes();lines=raw.split(b'\n')[:-1];r=json.loads(lines[0]);r['measured']['candidates']['ABS']['final']['MAE']=1.0;lines[0]=CL.canonical(r);jp.write_bytes(b'\n'.join(lines)+b'\n')
try:J.digest(path=jp);t=None
except CL.ChainError as x:t=str(x)
check('a tampered journal number is detected by the chain',t=='CHAIN_HASH:0')
jo=TMP/'old.jsonl';old_entry={'type':'RUN','runId':'AUTOLOOP_002','experimentId':'OLD','status':'COMPLETED','failure':None,'hypothesis':'옛 형식','rationale':'r','expectedEffect':'e','preregistration':PR,
 'measured':{'metricsSha256':'0'*64,'champion':METRICS['champion'],'candidates':{'ABS':{'head':'SEAT','final':{'MAE':2.049},'deltaVsChampionCI95':CI_A,'gatePassed':True}}},'championChange':None,
 'mechanicalVerdicts':J.mechanical_verdicts(PR,METRICS),'judge':None,'lessons':[],'createdAt':1.0}
with CL.locked(jo):CL.append(jo,CL.read(jo),old_entry)
od=J.digest(path=jo)
check('digest still reads an entry written before product, experiment and championSpec existed',len(od)==1 and od[0]['gatePassed']==['ABS'] and od[0]['predictions'][0]['verdict']=='SUPPORTED')
check('appending to a tampered journal is refused',err(lambda:J.annotate(run_id='AUTOLOOP_004',lessons=['x'],path=jp)) is not None)
check('PREREG fragment requires predictions and refutedIf with the five metrics',J.PREREG['required']==['predictions','refutedIf'] and J.PREREG['properties']['predictions']['items']['properties']['metric']['enum']==list(J.METRICS))
shutil.rmtree(TMP)
print('ALL_PASS %d'%N[0])
