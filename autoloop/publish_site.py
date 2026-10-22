"""Publish the autonomous loop's ledger and state as autoloop-report/1 for the research site. Values only: no local paths, no raw identifiers.
usage: publish_site.py [--watch <loop-pid> [seconds]]"""
import datetime,hashlib,json,os,subprocess,sys,tempfile,time
from pathlib import Path
A=Path(__file__).resolve().parent
SITE=Path(os.environ.get('AUTOLOOP_SITE_DIR') or A.parents[2]/'analysis-site/monitor-web')
sha=lambda b:hashlib.sha256(b).hexdigest()
def load(p):return json.loads(Path(p).read_bytes())
def num(v):return None if v is None else float(v)
def main():
    policy=load(A/'policy.json');state=load(A/'state.json');rows=[json.loads(l) for l in (A/'ledger.jsonl').read_text().splitlines() if l.strip()] if (A/'ledger.jsonl').exists() else []
    events=[json.loads(l) for l in (A/'loop-events.jsonl').read_text().splitlines() if l.strip()] if (A/'loop-events.jsonl').exists() else []
    last=events[-1] if events else None
    phase=None
    if last and last['event']=='LAUNCHING':
        le=A.parent/('full-pipeline-v1/control/learning-batch-parent-v%d/launch-events.jsonl'%last['version'])
        lev=[json.loads(l) for l in le.read_text().splitlines() if l.strip()] if le.exists() else []
        if lev:
            e=lev[-1];name='LAUNCH_'+e['event']+('_'+str(e.get('availability')) if e['event']=='CAPACITY' else '')
            phase=(name,datetime.datetime.fromtimestamp(e['atEpoch'],datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M:%S'))
    running=bool(last) and last['event'] not in ('LOOP_STOP','LOOP_END')
    stopped=next((e for e in reversed(events) if e['event']=='LOOP_STOP'),None)
    runs=[]
    for r in rows:
        cands=[]
        for c in r.get('candidates') or []:
            s=c['spec'];f=c.get('final') or {}
            entry={'candidate':s['candidate'],'kind':s['kind'],'head':s['head'],'features':s['features'] if isinstance(s['features'],str) else 'CUSTOM_%d'%len(s['features']),'blocks':s['blocks'],'objective':s.get('objective'),
                   'depth':s.get('params',{}).get('max_depth'),'eta':s.get('params',{}).get('eta'),'rounds':s.get('rounds'),'note':(s.get('note') or '')[:200]}
            if r['status']=='COMPLETED' and c.get('head')=='SEAT':
                ci=c['deltaVsChampionCI95']['MAE'];entry.update(MAE=num(f['MAE']),RMSE=num(f['RMSE']),deltaMAE=num(c['pointDeltaVsChampion']['MAE']),deltaMAECI95=[num(ci[0]),num(ci[1])],guardsWorsened=sorted(k for k,v in (c.get('guardWorsened') or {}).items() if v),gatePassed=bool(c['gatePassed']),Brier=None)
            elif r['status']=='COMPLETED':entry.update(MAE=None,RMSE=None,deltaMAE=None,deltaMAECI95=None,guardsWorsened=[],gatePassed=None,Brier=num(f.get('Brier')))
            else:entry.update(MAE=None,RMSE=None,deltaMAE=None,deltaMAECI95=None,guardsWorsened=[],gatePassed=None,Brier=None)
            cands.append(entry)
        runs.append({'runId':r['runId'],'experimentId':r['experimentId'],'status':r['status'],'hypothesis':r['hypothesis'][:1200],'rationale':(r.get('rationale') or '')[:1500],'estimatedUSD':num(r['estimatedUSD']),'actualUSD':num(r['actualUSD']),
                     'championBefore':r['championBefore'],'championAfter':r['championAfter'],'championBeforeMAE':num((r.get('championBeforeDevS') or {}).get('MAE')),'productMAE':num((r.get('product') or {}).get('MAE')),'failure':(r.get('failure') or None) and str(r['failure'])[:200],'candidates':cands})
    hf=state.get('hFinal');hfinal=None
    if hf:
        r=load(hf['resultPath']) if hf.get('resultPath') else None;rep=load(Path(hf['dir'])/'result/reproduction.json') if (Path(hf['dir'])/'result/reproduction.json').exists() else None
        keys=('MAE','RMSE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share');mx=lambda d:{k:num(d.get(k)) for k in keys} if d else None
        ci=lambda v:None if v is None else [num(v['MAE'][0]),num(v['MAE'][1])]
        hfinal={'status':hf['status'],'champion':hf['champion'],'reason':hf['reason'],'days':['2026-10-13','2026-10-15','2026-10-18','2026-10-19'],'rows':r['population']['rows'] if r else None,'blocks':r['population']['blocks'] if r else None,
                'reproductionMaxAbsDiff':max(v['maxAbsDiff'] for v in rep['results'].values()) if rep else None,'championMetrics':mx(r and r['champion']),'referenceMetrics':mx(r and r['reference']),'productMetrics':mx(r and r['product']),
                'championVsReferenceCI95':ci(r['championVsReferenceCI95']) if r else None,'championVsProductCI95':ci(r['championVsProductCI95']) if r else None,'referenceVsProductCI95':ci(r['referenceVsProductCI95']) if r else None}
    ch=state['champion'];today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')
    out={'schema':'autoloop-report/1','origin':'REAL_OBSERVATION_PIPELINE','evaluationSplit':'DEV_S','HOpened':bool(hf and hf.get('HOpened')),'hFinal':hfinal,
         'policy':{'budget':policy['budget'],'stop':{k:policy['stop'][k] for k in ('noImprovementRounds','consecutiveInfrastructureFailures')},'gate':policy['gate']['significance'],'guards':policy['gate']['guards']},
         'state':{'running':running,'stopReason':stopped['reason'] if stopped and not running else None,'lastEvent':phase[0] if phase else (last['event'] if last else None),'lastEventAt':phase[1] if phase else (last['atKST'] if last else None),'nextRun':state['nextRun'],
                  'consecutiveNoImprovement':state['consecutiveNoImprovement'],'consecutiveInfraFailures':state['consecutiveInfraFailures'],'spentTotalUSD':state['budget']['spentTotal'],'spentTodayUSD':state['budget']['spentByDay'].get(today,0.0)},
         'champion':{'modelId':ch['modelId'],'runId':ch['runId'],'candidate':ch['candidate'],'devSMAE':num((ch.get('devSMetrics') or {}).get('MAE')),'spec':{k:ch['spec'].get(k) for k in ('kind','head','features','blocks','objective','rounds')}|{'depth':ch['spec'].get('params',{}).get('max_depth'),'eta':ch['spec'].get('params',{}).get('eta')}},
         'championHistory':[{'runId':h['runId'],'from':h['from'],'to':h['to'],'devSMAE':num(h['devSMAE']),'previousDevSMAE':num(h['previousDevSMAE'])} for h in state.get('history',[])],
         'runs':runs[::-1],'servedAt':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),'DEVReused':True,'modelAdoption':False}
    body=(json.dumps(out,ensure_ascii=False,indent=1)+'\n').encode();dest=SITE/'public/autoloop-report.json';tmp=dest.with_name('.autoloop-report.candidate.json');tmp.write_bytes(body)
    check="import {verifyAutoloopReport} from '"+str(SITE/'src/autoloop/contract.ts')+"';import {readFileSync} from 'node:fs';const v=verifyAutoloopReport(JSON.parse(readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify({ok:true,runs:v.runs.length}));"
    with tempfile.NamedTemporaryFile('w',suffix='.mts',delete=False,dir=A) as f:f.write(check);cf=f.name
    p=subprocess.run(['node',cf,str(tmp)],capture_output=True,text=True,timeout=60);os.unlink(cf)
    if p.returncode!=0:tmp.unlink();raise SystemExit('SITE_CONTRACT_REJECTED: '+(p.stderr or p.stdout)[-800:])
    os.replace(tmp,dest);print(json.dumps({'published':sha(body),'runs':len(runs),'siteContract':json.loads(p.stdout.strip().splitlines()[-1])}))
def watch(pid,every):
    while True:
        alive=subprocess.run(['kill','-0',str(pid)],capture_output=True).returncode==0
        try:main()
        except BaseException as e:print(json.dumps({'publishError':str(e)[-300:],'at':time.time()}),flush=True)
        if not alive:return
        time.sleep(every)
if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='--watch':watch(int(sys.argv[2]),int(sys.argv[3]) if len(sys.argv)>3 else 60)
    else:main()
