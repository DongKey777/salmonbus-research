"""Autonomous improvement loop controller: plan -> generate -> launch on Runpod -> score -> champion update -> ledger -> report, until a stop condition.
Human input is only the policy file and the STOP file. GPU spend stays inside the policy budget; anything else stops the loop and reports.
usage: loop.py [--rounds N]"""
import argparse,datetime,hashlib,json,os,re,shutil,subprocess,sys,threading,time
from pathlib import Path
A=Path(__file__).resolve().parent;T=A.parent;C=T/'full-pipeline-v1/control';PY=sys.executable
KST=datetime.timezone(datetime.timedelta(hours=9))
sha=lambda b:hashlib.sha256(b).hexdigest()
def now_kst():return datetime.datetime.now(KST)
def log(event,**kw):
    rec={'event':event,'atEpoch':time.time(),'atKST':now_kst().strftime('%Y-%m-%d %H:%M:%S'),**kw}
    with (A/'loop-events.jsonl').open('a') as f:f.write(json.dumps(rec,ensure_ascii=False)+'\n')
    print(json.dumps(rec,ensure_ascii=False),flush=True)
def notify(title,text):
    try:subprocess.run(['osascript','-e','display notification %s with title %s'%(json.dumps(text[:200]),json.dumps(title))],timeout=10,capture_output=True)
    except Exception:pass
def load(p):return json.loads(Path(p).read_bytes())
def save_state(state):
    tmp=A/'.state.next.json';tmp.write_text(json.dumps(state,ensure_ascii=False,indent=1));os.replace(tmp,A/'state.json')
def on_ac_power():
    p=subprocess.run(['pmset','-g','batt'],capture_output=True,text=True);return "'AC Power'" in p.stdout
def budget_left(state,policy):
    b=state['budget'];today=now_kst().strftime('%Y-%m-%d');spent_today=b['spentByDay'].get(today,0.0)
    return min(policy['budget']['perRunUSD'],policy['budget']['perDayUSD']-spent_today,policy['budget']['totalUSD']-b['spentTotal']),spent_today
FINAL_REASONS=('NO_IMPROVEMENT_ROUNDS','BUDGET_EXHAUSTED','JUDGE_STOP')
def ai_modules():
    if str(A/'ai') not in sys.path:sys.path.insert(0,str(A/'ai'))
    import gateway,judge
    return gateway,judge
def gateway_spend():
    if not (A/'ai'/'calls.jsonl').exists():return {'totalUSD':0.0,'byDay':{}}
    g,_=ai_modules();v=g.verify_ledger()
    if not v.get('ok'):raise RuntimeError('AI_LEDGER_INVALID:'+str(v.get('error'))[:120])
    return v
def ai_left(state,policy):
    b=state.setdefault('aiBudget',{'spentTotal':0.0,'spentByDay':{}});p=policy.get('aiBudget') or {};today=now_kst().strftime('%Y-%m-%d')
    g=gateway_spend();spent_total=b['spentTotal']+float(g.get('totalUSD') or 0);spent_day=b['spentByDay'].get(today,0.0)+float((g.get('byDay') or {}).get(today,0.0))
    total=float(p.get('totalUSD',0))-spent_total;day=float(p.get('perDayUSD',0))-spent_day
    return min(float(p.get('perRoundUSD',0)),day,total),day,total
def add_ai_spend(state,usd):
    b=state.setdefault('aiBudget',{'spentTotal':0.0,'spentByDay':{}});today=now_kst().strftime('%Y-%m-%d')
    b['spentTotal']=round(b['spentTotal']+usd,6);b['spentByDay'][today]=round(b['spentByDay'].get(today,0.0)+usd,6)
def stop_reason(state,policy):
    if (A/'STOP').exists():return 'STOP_FILE'
    if (state.get('hFinal') or {}).get('HOpened'):return 'H_ALREADY_OPENED'
    if state['consecutiveNoImprovement']>=policy['stop']['noImprovementRounds']:return 'NO_IMPROVEMENT_ROUNDS'
    if state['consecutiveInfraFailures']>=policy['stop']['consecutiveInfrastructureFailures']:return 'INFRASTRUCTURE_FAILURES'
    if policy['budget']['totalUSD']-state['budget']['spentTotal']<0.15:return 'BUDGET_EXHAUSTED'
    return None
def wait_next_day():
    day=now_kst().strftime('%Y-%m-%d');log('DAILY_BUDGET_WAIT',day=day)
    while now_kst().strftime('%Y-%m-%d')==day:
        if (A/'STOP').exists():return False
        time.sleep(60)
    log('DAILY_BUDGET_RESUME');return True
def h_final(reason):
    log('H_FINAL_START',reason=reason);notify('자율 루프','봉인 H 최종 확인을 시작합니다 ('+reason+')')
    p=subprocess.run([PY,'-B',str(A/'hfinal/run_hfinal.py'),'final',reason],capture_output=True,text=True,timeout=7200)
    st=load(A/'state.json').get('hFinal') or {}
    log('H_FINAL_DONE',rc=p.returncode,status=st.get('status'),HOpened=st.get('HOpened'),tail=p.stdout[-400:]+p.stderr[-400:])
    notify('자율 루프','봉인 H 최종 확인: '+str(st.get('status')))
def publisher(stop_event):
    import importlib.util
    spec=importlib.util.spec_from_file_location('publish_site',A/'publish_site.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    while True:
        try:mod.main()
        except BaseException as e:print(json.dumps({'publishError':str(e)[-300:]}),flush=True)
        if stop_event.wait(60):
            try:mod.main()
            except BaseException as e:print(json.dumps({'publishError':str(e)[-300:]}),flush=True)
            return
def emergency_stop(pod_id):
    """Same single call the lifecycle is allowed to make: POST pods/<id>/action stop, then GET until EXITED."""
    sys.path.insert(0,str(T/'runpod-research'))
    from read_account_catalog import credential,NoRedirect
    import ssl,urllib.request,urllib.error
    def call(method,path,body=None):
        key=credential()
        try:
            req=urllib.request.Request('https://api.runpod.io/v2/'+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            op=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
            try:
                with op.open(req,timeout=25) as r:return r.status,json.loads(r.read(1<<20) or b'{}')
            except urllib.error.HTTPError as e:return e.code,None
        finally:del key
    status=None
    for i in range(20):
        try:
            s,d=call('GET','pods/'+pod_id);status=(d or {}).get('status')
            if status in ('EXITED','TERMINATED'):return status
            call('POST','pods/'+pod_id+'/action',{'action':'stop'})
        except Exception as e:log('EMERGENCY_STOP_ERROR',podId=pod_id,error=type(e).__name__)
        time.sleep(15)
    return status
def watch(L,P,stop_event):
    """Surface stop-attention and laptop sleep while the launcher runs; force the lifecycle-scoped stop when attention is unresolved."""
    last_wall=time.time();last_mono=time.monotonic();handled=set()
    while not stop_event.is_set():
        time.sleep(20);wall=time.time();mono=time.monotonic()
        if (wall-last_wall)-(mono-last_mono)>120:log('SLEEP_DETECTED',gapSeconds=round((wall-last_wall)-(mono-last_mono)))
        last_wall,last_mono=wall,mono
        att=L/'stop-attention-required.json'
        if att.exists() and 'attention' not in handled:
            a=load(att)
            if a.get('resolved') is not True and (L/'owned-pod.json').exists():
                pod=load(L/'owned-pod.json')['podId'];log('STOP_ATTENTION',podId=pod);notify('자율 루프','정지 미확인: Pod '+pod+' 정지를 시도합니다')
                st=emergency_stop(pod);handled.add('attention');log('EMERGENCY_STOP_RESULT',podId=pod,providerState=st)
                (P/'emergency-stop.json').write_text(json.dumps({'podId':pod,'providerState':st,'atEpoch':time.time()}))
def run_round(state,policy,args):
    n=state['nextRun'];run_id='AUTOLOOP_%03d'%n;rd=A/'runs'/run_id;rd.mkdir(parents=True,exist_ok=True);prev=state['lifecycleVersion'];v=prev+1
    left,spent_today=budget_left(state,policy)
    if not (rd/'plan.json').exists():
        ai,ai_today,ai_total=ai_left(state,policy);guard=float(policy.get('aiBudget',{}).get('perCallGuardUSD',1.0))
        if ai_total<guard:log('AI_BUDGET_EXHAUSTED',runId=run_id,leftUSD=round(ai_total,3));return 'AI_BUDGET_EXHAUSTED'
        if ai<guard:log('AI_BUDGET_TODAY',runId=run_id,leftUSD=round(ai,3));return 'AI_BUDGET_TODAY'
        v2=(policy.get('planner') or {}).get('version')=='v2'
        log('PLANNING',runId=run_id,budgetLeftUSD=round(left,3),aiBudgetLeftUSD=round(ai,3),planner='v2-debate' if v2 else 'v1')
        if v2:
            p=subprocess.run([PY,'-B',str(A/'ai/planner_v2.py'),run_id,str(rd/'plan.json'),'--debate'],capture_output=True,text=True,timeout=7200)
            if p.returncode==4:
                k=len(list(rd.glob('plan.deadlock-*.json')))+1;dl=Path(str(rd/'plan.json')+'.deadlock.json')
                if dl.exists():dl.rename(rd/f'plan.deadlock-{k}.json')
                state['consecutiveDesignDeadlocks']=state.get('consecutiveDesignDeadlocks',0)+1;save_state(state)
                log('DESIGN_DEADLOCK',runId=run_id,count=state['consecutiveDesignDeadlocks']);return 'DESIGN_DEADLOCK'
            if p.returncode==5:
                ai,ai_today,ai_total=ai_left(state,policy)
                log('AI_BUDGET_STOP',runId=run_id,leftUSD=round(ai,3));return 'AI_BUDGET_EXHAUSTED' if ai_total<guard else 'AI_BUDGET_TODAY'
            if p.returncode!=0:log('PLANNER_FAILED',runId=run_id,tail=p.stdout[-500:]+p.stderr[-500:]);return 'PLANNER_FAILED'
            state['consecutiveDesignDeadlocks']=0;save_state(state);pl=load(rd/'plan.json')
            log('PLANNED',runId=run_id,planner='v2-debate',debate=(pl.get('debate') or {}).get('status'),rounds=(pl.get('debate') or {}).get('rounds'),aiCostUSD=(pl.get('debate') or {}).get('costUSD'))
        cost=0.0
        if not v2:
            p=subprocess.run([PY,'-B',str(A/'planner/plan.py'),run_id,str(rd/'plan.json')],capture_output=True,text=True,timeout=3600)
            for f in (rd/'plan.json',Path(str(rd/'plan.json')+'.rejected.json')):
                if f.exists():cost+=sum(float(x.get('costUSD') or 0) for x in load(f).get('attempts',[]))
            if cost:add_ai_spend(state,cost);save_state(state)
            if p.returncode!=0:log('PLANNER_FAILED',runId=run_id,aiCostUSD=round(cost,4),tail=p.stdout[-500:]+p.stderr[-500:]);return 'PLANNER_FAILED'
            log('PLANNED',runId=run_id,aiCostUSD=round(cost,4))
    plan=load(rd/'plan.json');exp=plan['experiment']
    if plan['estimatedUSD']>left:
        today_only=plan['estimatedUSD']<=min(policy['budget']['perRunUSD'],policy['budget']['totalUSD']-state['budget']['spentTotal'])
        log('OVER_BUDGET',runId=run_id,estimatedUSD=plan['estimatedUSD'],leftUSD=left,todayOnly=today_only);return 'OVER_BUDGET_TODAY' if today_only else 'OVER_BUDGET'
    if not (rd/'experiment.json').exists():(rd/'experiment.json').write_text(json.dumps(exp,ensure_ascii=False,indent=1))
    rep=rd/'make-run-report.json'
    if not rep.exists() or not load(rep).get('ready'):
        log('GENERATING',runId=run_id,version=v)
        with open(rd/'make-run.log','w') as f:g=subprocess.run([PY,'-B',str(A/'runner/make_run.py'),str(prev),run_id,str(rd/'experiment.json')],stdout=f,stderr=subprocess.STDOUT,timeout=7200)
        if g.returncode!=0 or not rep.exists() or not load(rep).get('ready'):log('GENERATION_FAILED',runId=run_id);return 'GENERATION_FAILED'
    if not on_ac_power():
        if (policy.get('power') or {}).get('requireAC',True):log('NOT_ON_AC_POWER',runId=run_id);notify('자율 루프','AC 전원이 아니어서 GPU 실행을 미룹니다');return 'NOT_ON_AC_POWER'
        log('LAUNCH_ON_BATTERY',runId=run_id)
    L=C/f'learning-batch-lifecycle-v{v}';P=C/f'learning-batch-parent-v{v}'
    log('LAUNCHING',runId=run_id,version=v,experiment=exp['id'],candidates=len(exp['candidates']),estimatedUSD=plan['estimatedUSD'])
    notify('자율 루프','%s 실행 시작: %s (예상 $%.2f)'%(run_id,exp['id'],plan['estimatedUSD']))
    stop_event=threading.Event();th=threading.Thread(target=watch,args=(L,P,stop_event),daemon=True);th.start()
    with open(P/'launch-run.out','w') as f:lr=subprocess.run([PY,'-u','-B',str(P/'launch_run.py'),'--wait-hours',str(args.wait_hours),'--poll-seconds','120'],cwd=P,stdout=f,stderr=subprocess.STDOUT)
    stop_event.set();th.join(timeout=30)
    events=[json.loads(l) for l in (P/'launch-events.jsonl').read_text().splitlines()] if (P/'launch-events.jsonl').exists() else []
    if events and events[-1].get('event')=='CAPACITY_WAIT_EXPIRED':log('CAPACITY_WAIT_EXPIRED',runId=run_id);return 'NO_CAPACITY'
    rel=load(L/'released.json') if (L/'released.json').exists() else {}
    released=rel.get('verified') is True and rel.get('providerState')=='EXITED'
    if (L/'owned-pod.json').exists() and not released:
        pod=load(L/'owned-pod.json')['podId'];st=emergency_stop(pod);log('POST_RUN_STOP_CHECK',podId=pod,providerState=st)
        if st not in ('EXITED','TERMINATED'):(A/'STOP').write_text('pod stop unconfirmed '+pod);notify('자율 루프','Pod 정지 미확인으로 루프를 멈춥니다');return 'STOP_UNCONFIRMED'
    cost=0.0
    if (L/'owned-pod.json').exists() and (P/'parent-release.json').exists():
        created=load(L/'owned-pod.json').get('createdAtEpoch') or 0;ended=load(P/'parent-release.json')['atEpoch'];hourly=1.09
        obs=P/'new-owner-provider-observation.json'
        if obs.exists():hourly=float(load(obs)['response']['data'].get('cost') or 1.09)
        cost=round(max(0,ended-created)/3600*hourly,4)
    today=now_kst().strftime('%Y-%m-%d');b=state['budget'];b['spentTotal']=round(b['spentTotal']+cost,4);b['spentByDay'][today]=round(b['spentByDay'].get(today,0)+cost,4)
    state['lifecycleVersion']=v if (L/'start-intent.json').exists() else prev
    res=load(P/'parent-execution-result.json') if (P/'parent-execution-result.json').exists() else {}
    if res.get('status')!='SWEEP_COMPLETE_METADATA_CAPTURED':
        state['consecutiveInfraFailures']+=1;fail=load(P/'parent-stop.json') if (P/'parent-stop.json').exists() else {}
        entry={'runId':run_id,'experimentId':exp['id'],'hypothesis':exp['hypothesis'],'status':'INFRASTRUCTURE_FAILURE','estimatedUSD':plan['estimatedUSD'],'actualUSD':cost,'failure':fail.get('reason'),'championBefore':state['champion']['modelId'],'championAfter':state['champion']['modelId'],'candidates':[{'spec':c} for c in exp['candidates']]}
        with (A/'ledger.jsonl').open('a') as f:f.write(json.dumps(entry,ensure_ascii=False)+'\n')
        if state['lifecycleVersion']==v:state['nextRun']=n+1
        save_state(state);log('RUN_FAILED',runId=run_id,reason=fail.get('reason'),costUSD=cost);notify('자율 루프',run_id+' 실패: '+str(fail.get('reason'))[:80]);return 'RUN_FAILED'
    state['consecutiveInfraFailures']=0
    if not (P/'run-outputs').exists():subprocess.run([PY,'-B',str(P/'reconstruct_outputs.py')],cwd=P,check=True,capture_output=True)
    m=load(P/'run-outputs/worker/metrics.json');w=load(P/'run-outputs/worker/receipt.json')
    champ_before=state['champion']['modelId'];cands=[]
    for c in exp['candidates']:
        mc=m['candidates'][c['candidate']]
        cands.append({'spec':c,'head':mc['head'],'final':mc['final'],'deltaVsChampionCI95':mc.get('deltaVsChampionCI95'),'pointDeltaVsChampion':mc.get('pointDeltaVsChampion'),'guardWorsened':mc.get('guardWorsened'),'gatePassed':mc.get('gatePassed'),'curveMAE':mc.get('curveMAE')})
    passing=[x for x in cands if x['gatePassed'] is True and x['head']=='SEAT'];new_champ=None;dec=None;chosen=None
    if (policy.get('judge') or {}).get('enabled'):
        _,J=ai_modules()
        try:dec=J.judge_round(run_id=run_id,plan=plan,metrics_path=P/'run-outputs/worker/metrics.json',state=json.loads(json.dumps(state)),policy=policy,persist_dir=rd)
        except Exception as e:dec={'error':type(e).__name__+':'+str(e)[:200]}
        if dec.get('error'):log('JUDGE_FAILED',runId=run_id,error=dec['error'])
        else:
            pick=dec.get('champion') if dec.get('promote') else None
            chosen=next((x for x in passing if x['spec']['candidate']==pick),None)
            if pick and chosen is None:log('JUDGE_PICK_REJECTED',runId=run_id,candidate=pick)
            log('JUDGED',runId=run_id,verdict=dec.get('hypothesisVerdict'),champion=chosen and chosen['spec']['candidate'],anomaly=dec.get('anomaly'),continueLoop=dec.get('continue'),debate=dec.get('debateStatus'),aiCostUSD=dec.get('aiCostUSD'))
    elif passing:chosen=min(passing,key=lambda x:x['final']['MAE'])
    if chosen:
        best=chosen;name=best['spec']['candidate'];inv=w['artifactInventory'][name+'.dev-s-pred.npy']
        new_champ={'modelId':'SEAT.'+run_id+'_'+name,'runId':run_id,'candidate':name,'scope':'DEV_S','predictions':{'path':'/workspace/salmonbus-full-v1/outputs/%s/worker/%s.dev-s-pred.npy'%(run_id,name),'sha256':inv['sha256']},'spec':best['spec'],'devSMetrics':best['final']}
        state['history'].append({'runId':run_id,'from':champ_before,'to':new_champ['modelId'],'devSMAE':best['final']['MAE'],'previousDevSMAE':m['champion']['MAE']});state['champion']=new_champ;state['consecutiveNoImprovement']=0
    else:
        state['champion']['devSMetrics']=state['champion'].get('devSMetrics') or {k:m['champion'][k] for k in ('MAE','RMSE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')};state['consecutiveNoImprovement']+=1
    state['lastDiagnostics']=str(P/'run-outputs/worker/diagnostics.json');state['nextRun']=n+1
    entry={'runId':run_id,'experimentId':exp['id'],'hypothesis':exp['hypothesis'],'rationale':plan.get('rationale'),'status':'COMPLETED','estimatedUSD':plan['estimatedUSD'],'actualUSD':cost,'championBefore':champ_before,'championBeforeDevS':{k:m['champion'][k] for k in ('MAE','RMSE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')},
           'championAfter':state['champion']['modelId'],'product':{k:m['product'][k] for k in ('MAE','RMSE')},'candidates':cands,'receiptSha256':sha((P/'run-outputs/receipt.json').read_bytes()),'version':v,
           'judge':None if dec is None else {k:dec.get(k) for k in ('hypothesisVerdict','perPrediction','champion','promote','anomaly','anomalyReasons','continue','stopReason','summaryKo','lessons','fallback','debateStatus','debateRounds','aiCostUSD','error')}}
    with (A/'ledger.jsonl').open('a') as f:f.write(json.dumps(entry,ensure_ascii=False)+'\n')
    save_state(state);report(entry,state)
    log('RUN_COMPLETED',runId=run_id,costUSD=cost,championAfter=state['champion']['modelId'],passing=[x['spec']['candidate'] for x in passing])
    notify('자율 루프','%s 완료: %s (비용 $%.2f)'%(run_id,'챔피언 교체 '+state['champion']['modelId'] if new_champ else '챔피언 유지',cost))
    if dec is not None:
        if dec.get('error'):return 'JUDGE_FAILED'
        if dec.get('anomaly'):return 'ANOMALY_SUSPECTED'
        if dec.get('continue') is False:return 'JUDGE_STOP'
    return 'COMPLETED'
def report(e,state):
    lines=['# %s · %s'%(e['runId'],e['experimentId']),'','- 가설: '+e['hypothesis'],'- 비용: 예상 $%.2f, 실제 $%.2f'%(e['estimatedUSD'],e['actualUSD']),
           '- 챔피언(실행 전) %s DEV-S MAE %.4f, 운영 예보 %.4f'%(e['championBefore'],e['championBeforeDevS']['MAE'],e['product']['MAE']),'','| 후보 | MAE | 챔피언 대비 | 95% 구간 | 판정 |','|---|---|---|---|---|']
    for c in e['candidates']:
        if c['head']!='SEAT':lines.append('| %s | Brier %.5f | — | — | 만석 확률 |'%(c['spec']['candidate'],c['final']['Brier']));continue
        ci=c['deltaVsChampionCI95']['MAE'];worse=[k for k,v in (c['guardWorsened'] or {}).items() if v]
        lines.append('| %s | %.4f | %+.4f | [%+.4f, %+.4f] | %s |'%(c['spec']['candidate'],c['final']['MAE'],c['pointDeltaVsChampion']['MAE'],ci[0],ci[1],'통과' if c['gatePassed'] else ('보호 지표 악화: '+','.join(worse) if worse else '개선 유의하지 않음')))
    lines+=['','- 실행 후 챔피언: '+e['championAfter'],'- 연속 미개선: %d바퀴'%state['consecutiveNoImprovement']]
    j=e.get('judge')
    if j and not j.get('error'):lines+=['','## 심사','- 가설 판정: %s (상호 검증 %s, %s회)'%(j.get('hypothesisVerdict'),j.get('debateStatus'),j.get('debateRounds')),'- '+str(j.get('summaryKo') or ''),'- 다음 설계에 넘긴 교훈: '+' / '.join(j.get('lessons') or [])]
    elif j:lines+=['','## 심사','- 심사 실패: '+str(j.get('error'))]
    (A/'reports').mkdir(exist_ok=True);(A/'reports'/(e['runId']+'.md')).write_text('\n'.join(lines)+'\n')
LOCK=None
def single_instance():
    global LOCK
    import fcntl
    LOCK=open(A/'loop.lock','a+')
    try:fcntl.flock(LOCK,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return False
    LOCK.seek(0);LOCK.truncate();LOCK.write(str(os.getpid()));LOCK.flush();return True
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--rounds',type=int,default=100);ap.add_argument('--wait-hours',type=float,default=8.0);args=ap.parse_args()
    if not single_instance():print(json.dumps({'event':'LOOP_ALREADY_RUNNING'}),flush=True);return
    policy=load(A/'policy.json');log('LOOP_START',rounds=args.rounds)
    pub_stop=threading.Event();pub=threading.Thread(target=publisher,args=(pub_stop,),daemon=True);pub.start()
    for i in range(args.rounds):
        state=load(A/'state.json');policy=load(A/'policy.json');why=stop_reason(state,policy)
        if why:
            log('LOOP_STOP',reason=why);notify('자율 루프','루프 정지: '+why)
            if why in FINAL_REASONS:h_final(why)
            break
        left,_=budget_left(state,policy)
        if left<0.15:
            if wait_next_day():continue
            log('LOOP_STOP',reason='STOP_FILE');break
        outcome=run_round(state,policy,args)
        if outcome in ('OVER_BUDGET_TODAY','AI_BUDGET_TODAY'):
            if wait_next_day():continue
            log('LOOP_STOP',reason='STOP_FILE');break
        if outcome=='DESIGN_DEADLOCK':
            if load(A/'state.json').get('consecutiveDesignDeadlocks',0)>=2:log('LOOP_STOP',reason='DESIGN_DEADLOCKS');notify('자율 루프','설계 교착 2회 연속으로 루프를 멈춥니다');break
            continue
        if outcome=='JUDGE_STOP':log('LOOP_STOP',reason='JUDGE_STOP');notify('자율 루프','심사 AI가 정지를 판단했습니다');h_final('JUDGE_STOP');break
        if outcome in ('ANOMALY_SUSPECTED','JUDGE_FAILED'):log('LOOP_STOP',reason=outcome);notify('자율 루프','루프 정지: '+outcome);break
        if outcome in ('PLANNER_FAILED','GENERATION_FAILED','OVER_BUDGET','STOP_UNCONFIRMED','AI_BUDGET_EXHAUSTED'):log('LOOP_STOP',reason=outcome);notify('자율 루프','루프 정지: '+outcome);break
        if outcome in ('NOT_ON_AC_POWER','NO_CAPACITY'):time.sleep(600)
    log('LOOP_END');pub_stop.set();pub.join(timeout=120)
if __name__=='__main__':main()
