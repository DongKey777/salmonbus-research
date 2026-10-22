"""Logic tests for loop.py stop, daily-wait and H-final branches with the provider, planner and launcher stubbed out."""
import datetime,importlib.util,json,sys,tempfile,threading
from pathlib import Path
A=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('loop',A/'loop.py');L=importlib.util.module_from_spec(spec);spec.loader.exec_module(L)
policy=json.loads((A/'policy.json').read_bytes())
def state(**kw):
    s={'consecutiveNoImprovement':0,'consecutiveInfraFailures':0,'budget':{'spentTotal':0.0,'spentByDay':{}},'nextRun':1}
    for k,v in kw.items():
        if k=='spentTotal':s['budget']['spentTotal']=v
        elif k=='spentToday':s['budget']['spentByDay'][L.now_kst().strftime('%Y-%m-%d')]=v
        else:s[k]=v
    return s
def check(name,ok):print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
tmp=Path(tempfile.mkdtemp());L.A=tmp;L.notify=lambda *a:None
check('no stop on a fresh state',L.stop_reason(state(),policy) is None)
D=policy['budget']['perDayUSD']
check('daily cap alone is not a stop',L.stop_reason(state(spentToday=D-0.1,spentTotal=D-0.1),policy) is None)
check('total cap stops as BUDGET_EXHAUSTED',L.stop_reason(state(spentTotal=19.9),policy)=='BUDGET_EXHAUSTED')
NI=policy['stop']['noImprovementRounds']
check('no-improvement stops at the policy ceiling',L.stop_reason(state(consecutiveNoImprovement=NI),policy)=='NO_IMPROVEMENT_ROUNDS' and L.stop_reason(state(consecutiveNoImprovement=NI-1),policy) is None)
check('infra stops',L.stop_reason(state(consecutiveInfraFailures=2),policy)=='INFRASTRUCTURE_FAILURES')
check('opened H refuses before anything else',L.stop_reason(state(consecutiveNoImprovement=NI,hFinal={'HOpened':True}),policy)=='H_ALREADY_OPENED')
(tmp/'STOP').write_text('');check('STOP file wins',L.stop_reason(state(hFinal={'HOpened':True}),policy)=='STOP_FILE');(tmp/'STOP').unlink()
day=[0];base=datetime.datetime(2026,10,22,23,59,tzinfo=L.KST)
L.now_kst=lambda:base+datetime.timedelta(days=day[0]);real_sleep=L.time.sleep
def fake_sleep(s):day[0]=1
L.time.sleep=fake_sleep
check('daily wait resumes on the next KST day',L.wait_next_day() is True)
day[0]=0;(tmp/'STOP').write_text('');check('daily wait ends on STOP',L.wait_next_day() is False);(tmp/'STOP').unlink()
L.time.sleep=real_sleep
def run_main(st,outcomes):
    calls={'h':[],'rounds':0,'waits':0}
    (tmp/'policy.json').write_text(json.dumps(policy));(tmp/'state.json').write_text(json.dumps(st))
    L.h_final=lambda r:calls['h'].append(r)
    L.publisher=lambda ev:ev.wait()
    def rr(s,p,a):
        calls['rounds']+=1;o=outcomes.pop(0) if outcomes else 'STOP'
        if o=='STOP':(tmp/'STOP').write_text('')
        if o=='NOIMP':s['consecutiveNoImprovement']+=1;L.save_state(s);return 'COMPLETED'
        return o
    L.run_round=rr
    def w():calls['waits']+=1;b=json.loads((tmp/'state.json').read_bytes());b['budget']['spentByDay']={};(tmp/'state.json').write_text(json.dumps(b));return True
    L.wait_next_day=w
    sys.argv=['loop.py','--rounds','10'];L.main()
    if (tmp/'STOP').exists():(tmp/'STOP').unlink()
    ev=[json.loads(l) for l in (tmp/'loop-events.jsonl').read_text().splitlines()];(tmp/'loop-events.jsonl').unlink()
    return calls,[e for e in ev if e['event']=='LOOP_STOP']
c,stops=run_main(state(consecutiveNoImprovement=NI-1),['NOIMP'])
check('the ceiling-reaching no-improvement round triggers H final once',c['h']==['NO_IMPROVEMENT_ROUNDS'] and c['rounds']==1 and stops[-1]['reason']=='NO_IMPROVEMENT_ROUNDS')
c,stops=run_main(state(spentToday=D-0.05,spentTotal=D-0.05),['STOP'])
check('daily cap waits for the next day then runs a round',c['waits']==1 and c['rounds']==1 and c['h']==[] and stops[-1]['reason']=='STOP_FILE')
c,stops=run_main(state(),['OVER_BUDGET_TODAY','STOP'])
check('plan over today\'s budget waits instead of stopping',c['waits']==1 and c['rounds']==2 and c['h']==[])
c,stops=run_main(state(),['OVER_BUDGET'])
check('plan over the per-run or total budget stops without H',stops[-1]['reason']=='OVER_BUDGET' and c['h']==[])
c,stops=run_main(state(consecutiveInfraFailures=2),[])
check('infrastructure stop does not open H',c['h']==[] and c['rounds']==0)
c,stops=run_main(state(spentTotal=19.95),[])
check('total budget stop opens H',c['h']==['BUDGET_EXHAUSTED'])
st=state();L.add_ai_spend(st,0.4);L.add_ai_spend(st,0.35)
a,d,t=L.ai_left(st,policy);AB=policy['aiBudget']
check('AI spend accumulates per day and in total',abs(st['aiBudget']['spentTotal']-0.75)<1e-9 and abs(d-(AB['perDayUSD']-0.75))<1e-9 and abs(t-(AB['totalUSD']-0.75))<1e-9 and a==min(AB['perRoundUSD'],d,t))
c,stops=run_main(state(),['AI_BUDGET_TODAY','STOP'])
check('AI daily cap waits for the next day',c['waits']==1 and c['rounds']==2 and c['h']==[])
c,stops=run_main(state(),['AI_BUDGET_EXHAUSTED'])
check('AI total cap stops without opening H',stops[-1]['reason']=='AI_BUDGET_EXHAUSTED' and c['h']==[])
L.gateway_spend=lambda:{'totalUSD':1.5,'byDay':{L.now_kst().strftime('%Y-%m-%d'):1.5}}
st=state();L.add_ai_spend(st,0.5);a,d,t=L.ai_left(st,policy)
check('AI budget counts gateway ledger plus legacy spend',abs(t-(AB['totalUSD']-2.0))<1e-9 and abs(d-(AB['perDayUSD']-2.0))<1e-9)
c,stops=run_main(state(),['DESIGN_DEADLOCK','STOP'])
check('one design deadlock retries the round',c['rounds']==2 and stops[-1]['reason']=='STOP_FILE')
c,stops=run_main(state(consecutiveDesignDeadlocks=2),['DESIGN_DEADLOCK'])
check('second consecutive design deadlock stops without H',stops[-1]['reason']=='DESIGN_DEADLOCKS' and c['h']==[])
c,stops=run_main(state(),['JUDGE_STOP'])
check('judge stop runs sealed H',stops[-1]['reason']=='JUDGE_STOP' and c['h']==['JUDGE_STOP'])
c,stops=run_main(state(),['ANOMALY_SUSPECTED'])
check('anomaly stops without H',stops[-1]['reason']=='ANOMALY_SUSPECTED' and c['h']==[])
c,stops=run_main(state(),['JUDGE_FAILED'])
check('judge failure stops without H',stops[-1]['reason']=='JUDGE_FAILED' and c['h']==[])
L.LOCK=None
check('single instance lock is exclusive',L.single_instance() is True)
import subprocess as sp
r=sp.run([sys.executable,'-c',"import importlib.util,sys;sp=importlib.util.spec_from_file_location('l',sys.argv[1]);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);m.A=__import__('pathlib').Path(sys.argv[2]);print(m.single_instance())",str(A/'loop.py'),str(tmp)],capture_output=True,text=True)
check('a second process cannot take the lock',r.stdout.strip()=='False')
print('ALL_PASS')
