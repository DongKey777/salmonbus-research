"""Research journal with pre-registration.
PREREG is the planner's pre-registration schema fragment; validate_prereg checks it against the experiment; mechanical_verdicts judges each prediction from the worker's paired bootstrap interval deltaVsChampionCI95[metric] = (candidate - champion).
Direction lower with minEffect m: SUPPORTED if hi < -m, REFUTED if lo > -m, else INCONCLUSIVE; higher mirrors it (SUPPORTED if lo > m, REFUTED if hi < m). Missing run, candidate, SEAT head or interval is INVALID. INCONCLUSIVE is never REFUTED.
ai/journal.jsonl is append-only and hash-chained (chainlog). An entry carries the plan's experiment (candidate specs), championSpec (the spec of the champion the run was compared against,
from state.champion.spec) and measured = champion, product and per-candidate metrics with intervals, point deltas, guard flags and curves. Every number in an entry is copied from a metrics file; model text fills only hypothesis, rationale, expectedEffect, the pre-registration and, later, judge and lessons.
digest() is a deterministic summary for the planner context, without any model rewriting."""
import json,math,re,sys,time
from pathlib import Path
H=Path(__file__).resolve().parent
if str(H) not in sys.path:sys.path.insert(0,str(H))
import chainlog as CL
JOURNAL=H/'journal.jsonl'
METRICS=('MAE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')
MAX_EFFECT={'MAE':1.0,'routeMacroMAE':1.0,'unseenRouteMAE':1.0,'over10Share':0.5,'fullBusUnder2Share':0.5}
MAX_PREDICTIONS=24
METRICS_SCHEMA='AUTOLOOP_DEV_S_METRICS/1'
CANDIDATE_EXTRA=('kind','pointDeltaVsChampion','guardWorsened','primaryImproved','curveMAE','quantileCoverage')
PREREG={'type':'object','additionalProperties':False,'required':['predictions','refutedIf'],'properties':{
 'predictions':{'type':'array','minItems':1,'maxItems':MAX_PREDICTIONS,'items':{'type':'object','additionalProperties':False,'required':['id','candidate','metric','comparator','direction','minEffect','why'],'properties':{
  'id':{'type':'string','pattern':'^P[0-9]{1,2}$'},'candidate':{'type':'string','pattern':'^[A-Z][A-Z0-9_]{0,31}$'},'metric':{'enum':list(METRICS)},'comparator':{'enum':['CHAMPION']},
  'direction':{'enum':['lower','higher']},'minEffect':{'type':'number','minimum':0},'why':{'type':'string'}}}},
 'refutedIf':{'type':'string'}}}
class PreregInvalid(ValueError):pass
def need(ok,code):
    if not ok:raise PreregInvalid(code)
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def validate_prereg(prereg,experiment):
    need(type(prereg) is dict and set(prereg)=={'predictions','refutedIf'},'PREREG_FIELDS')
    need(type(prereg['refutedIf']) is str and 10<=len(prereg['refutedIf'])<=1000,'PREREG_REFUTED_IF')
    ps=prereg['predictions'];need(type(ps) is list and 1<=len(ps)<=MAX_PREDICTIONS,'PREREG_PREDICTIONS')
    heads={c.get('candidate'):c.get('head') for c in experiment.get('candidates') or [] if type(c) is dict};ids=set();pairs=set()
    for p in ps:
        need(type(p) is dict and set(p)=={'id','candidate','metric','comparator','direction','minEffect','why'},'PREREG_PREDICTION_FIELDS')
        need(type(p['id']) is str and re.fullmatch('P[0-9]{1,2}',p['id']) and p['id'] not in ids,'PREREG_ID');ids.add(p['id'])
        need(type(p['candidate']) is str and p['candidate'] in heads,'PREREG_CANDIDATE:'+p['id']);need(heads[p['candidate']]=='SEAT','PREREG_NOT_SEAT:'+p['id'])
        need(p['metric'] in METRICS,'PREREG_METRIC:'+p['id']);need(p['comparator']=='CHAMPION','PREREG_COMPARATOR:'+p['id']);need(p['direction'] in ('lower','higher'),'PREREG_DIRECTION:'+p['id'])
        need(finite(p['minEffect']) and 0<=p['minEffect']<=MAX_EFFECT[p['metric']],'PREREG_MIN_EFFECT:'+p['id'])
        need(type(p['why']) is str and 5<=len(p['why'])<=600,'PREREG_WHY:'+p['id'])
        need((p['candidate'],p['metric']) not in pairs,'PREREG_DUPLICATE:'+p['id']);pairs.add((p['candidate'],p['metric']))
    return prereg
def verdict(direction,m,lo,hi):
    if direction=='lower':return 'SUPPORTED' if hi<-m else 'REFUTED' if lo>-m else 'INCONCLUSIVE'
    return 'SUPPORTED' if lo>m else 'REFUTED' if hi<m else 'INCONCLUSIVE'
def _metrics_ok(m):return type(m) is dict and m.get('schema')==METRICS_SCHEMA and type(m.get('candidates')) is dict
def mechanical_verdicts(prereg,metrics_json,failure=None):
    ok=failure is None and _metrics_ok(metrics_json);out=[]
    for p in (prereg or {}).get('predictions') or []:
        if type(p) is not dict:out.append({'id':None,'candidate':None,'metric':None,'direction':None,'minEffect':None,'interval':None,'verdict':'INVALID','cause':'BAD_PREDICTION'});continue
        v={'id':p.get('id'),'candidate':p.get('candidate'),'metric':p.get('metric'),'direction':p.get('direction'),'minEffect':p.get('minEffect'),'interval':None,'verdict':'INVALID','cause':None}
        if not ok:v['cause']='RUN_FAILED' if failure is not None else 'NO_METRICS';out.append(v);continue
        c=metrics_json['candidates'].get(p.get('candidate'))
        ci=(c.get('deltaVsChampionCI95') or {}).get(p.get('metric')) if type(c) is dict and type(c.get('deltaVsChampionCI95')) is dict else None
        if type(c) is not dict:v['cause']='MISSING_CANDIDATE'
        elif c.get('head')!='SEAT':v['cause']='NOT_SEAT'
        elif not (type(ci) in (list,tuple) and len(ci)==2 and all(finite(x) for x in ci) and ci[0]<=ci[1]):v['cause']='MISSING_INTERVAL'
        elif p.get('direction') not in ('lower','higher') or not finite(p.get('minEffect')) or p['minEffect']<0:v['cause']='BAD_PREDICTION'
        else:v.update(interval=[float(ci[0]),float(ci[1])],verdict=verdict(p['direction'],float(p['minEffect']),float(ci[0]),float(ci[1])),cause=None)
        out.append(v)
    return out
def measured(metrics_json,metrics_sha,run_id,candidate_order):
    m=metrics_json;cands={}
    for name in sorted(m['candidates']):
        c=m['candidates'][name];cands[name]={k:c.get(k) for k in ('head','final','deltaVsChampionCI95','gatePassed')}
        cands[name].update({k:c[k] for k in CANDIDATE_EXTRA if k in c})
    champ={k:m['champion'].get(k) for k in ('modelId','MAE','RMSE')+METRICS} if type(m.get('champion')) is dict else None
    product=dict(m['product']) if type(m.get('product')) is dict else None
    passing=[n for n in candidate_order if n in cands and cands[n]['head']=='SEAT' and cands[n]['gatePassed'] is True and finite((cands[n]['final'] or {}).get('MAE'))]
    best=min(passing,key=lambda n:cands[n]['final']['MAE']) if passing else None
    change={'from':(champ or {}).get('modelId'),'to':'SEAT.'+run_id+'_'+best,'candidate':best,'devSMAE':cands[best]['final']['MAE'],'previousDevSMAE':(champ or {}).get('MAE')} if best else None
    return {'metricsSha256':metrics_sha,'champion':champ,'product':product,'candidates':cands},change
def _load_plan(plan):
    if isinstance(plan,(str,Path)):plan=json.loads(Path(plan).read_bytes())
    if type(plan) is not dict or type(plan.get('experiment')) is not dict:raise ValueError('PLAN_FIELDS')
    return plan
def append_entry(*,run_id,plan,metrics_path=None,status=None,failure=None,judge=None,lessons=None,champion_spec=None,path=None):
    plan=_load_plan(plan);exp=plan['experiment'];path=Path(path or JOURNAL);order=[c['candidate'] for c in exp.get('candidates') or []]
    if not re.fullmatch(r'AUTOLOOP_[0-9]{3}',str(run_id)):raise ValueError('RUN_ID')
    if champion_spec is not None and type(champion_spec) is not dict:raise ValueError('CHAMPION_SPEC')
    m=None;meas=None;change=None
    if metrics_path is not None:
        p=Path(metrics_path)
        if p.stat().st_size>(64<<20):raise ValueError('METRICS_TOO_LARGE')
        raw=p.read_bytes();m=json.loads(raw)
        if not _metrics_ok(m):raise ValueError('METRICS_SCHEMA')
        if m.get('experiment')!=exp.get('id'):raise ValueError('METRICS_EXPERIMENT_MISMATCH')
        meas,change=measured(m,CL.sha(raw),run_id,order)
    status=status or ('COMPLETED' if m is not None else 'FAILED')
    if status=='COMPLETED' and m is None:raise ValueError('COMPLETED_WITHOUT_METRICS')
    fail=None if failure is None else str(failure)[:500]
    prereg=plan.get('preregistration')
    entry={'type':'RUN','runId':run_id,'experimentId':exp.get('id'),'status':status,'failure':fail,'hypothesis':exp.get('hypothesis'),'rationale':plan.get('rationale'),'expectedEffect':plan.get('expectedEffect'),
           'experiment':json.loads(json.dumps(exp)),'championSpec':json.loads(json.dumps(champion_spec)) if champion_spec is not None else None,'preregistration':prereg,'measured':meas,'championChange':change,'mechanicalVerdicts':mechanical_verdicts(prereg,m,None if status=='COMPLETED' else (fail or status)),
           'judge':judge,'lessons':list(lessons or []),'createdAt':time.time()}
    with CL.locked(path):
        rows=CL.read(path)
        if any(r.get('type')=='RUN' and r.get('runId')==run_id for r in rows):raise ValueError('JOURNAL_DUPLICATE_RUN')
        return CL.append(path,rows,entry)
def annotate(*,run_id,judge=None,lessons=None,path=None):
    path=Path(path or JOURNAL)
    with CL.locked(path):
        rows=CL.read(path)
        if not any(r.get('type')=='RUN' and r.get('runId')==run_id for r in rows):raise ValueError('JOURNAL_UNKNOWN_RUN')
        return CL.append(path,rows,{'type':'ANNOTATION','runId':run_id,'judge':judge,'lessons':list(lessons or []),'createdAt':time.time()})
def entries(path=None):
    path=Path(path or JOURNAL)
    if not path.exists():return []
    with CL.locked(path):return CL.read(path)
def _cut(s,n):s='' if s is None else str(s);return s if len(s)<=n else s[:n-1]+'…'
def _r(x):return round(x,4) if finite(x) else x
def digest(max_entries=8,path=None):
    rows=entries(path);ann={}
    for r in rows:
        if r.get('type')=='ANNOTATION':ann[r['runId']]=r
    out=[]
    for e in [r for r in rows if r.get('type')=='RUN'][-max_entries:] if max_entries>0 else []:
        a=ann.get(e['runId']);lessons=(a['lessons'] if a else None) or e.get('lessons') or []
        d={'runId':e['runId'],'experimentId':e.get('experimentId'),'status':e.get('status'),'hypothesis':_cut(e.get('hypothesis'),280)}
        if e.get('status')!='COMPLETED' or e.get('measured') is None:d['cause']=_cut(e.get('failure') or e.get('status'),240)
        d['predictions']=[{k:v for k,v in (('id',p['id']),('candidate',p['candidate']),('metric',p['metric']),('direction',p['direction']),('minEffect',_r(p['minEffect'])),
                          ('interval',[_r(x) for x in p['interval']] if p['interval'] else None),('verdict',p['verdict']),('cause',p['cause'])) if v is not None or k=='interval'} for p in e.get('mechanicalVerdicts') or []]
        ch=e.get('championChange');d['championChange']={'from':ch['from'],'to':ch['to'],'devSMAE':_r(ch['devSMAE']),'previousDevSMAE':_r(ch['previousDevSMAE'])} if ch else None
        meas=e.get('measured') or {}
        d['gatePassed']=sorted(n for n,c in (meas.get('candidates') or {}).items() if c.get('gatePassed') is True)
        d['lessons']=[_cut(x,200) for x in lessons[:5]]
        out.append(d)
    return out
