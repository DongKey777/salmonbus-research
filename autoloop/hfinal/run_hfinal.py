"""Host side of the sealed-H final evaluation. Resolves the champion and the V2_D8 reference with their receipt pins, fetches
missing champion artifacts read-only from the volume, runs evaluate.py offline in the pinned CPU container and records the result.
usage: run_hfinal.py rehearse   (DEV_S reproduction only, H stays sealed)
       run_hfinal.py final <stop-reason>   (opens H once for the current champion)"""
import datetime,json,os,subprocess,sys,time
from pathlib import Path
A=Path(__file__).resolve().parents[1];T=A.parent;MIRROR=T.parent/'volume-mirror-20261021';MR=MIRROR/'R';OUTS='salmonbus-full-v1/outputs'
RB=T/'ml-research/route-balance-impl-v1';CTRL=T/'full-pipeline-v1/control'
sys.path.insert(0,str(MIRROR))
REFERENCE={'modelId':'SEAT.V2_D8','spec':{'kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','params':{'max_depth':8,'eta':0.1},'rounds':1024},
           'files':{'pooled':'SEAT_FEATURES_V2_002/worker/V2_D8.model.json'},'podDevPred':'SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy',
           'pins':{'SEAT_FEATURES_V2_002/worker/V2_D8.model.json':'f61fbb9b7d391eaa97a74f4d1249cdeb3c300600aa6f9946a625274fb906f9ca','SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy':'60db73fd847089de7dc0863464a0753684290b26e0c069a2217f019795cd6c74'}}
H_DAYS=['2026-10-13','2026-10-15','2026-10-18','2026-10-19'];ALLOWED_FINAL={'NO_IMPROVEMENT_ROUNDS','BUDGET_EXHAUSTED','JUDGE_STOP'}
TOL={'maxAbsDiff':0.01,'MAE':1e-4}
def load(p):return json.loads(Path(p).read_bytes())
def save_state(st):
    tmp=A/'.state.hfinal.json';tmp.write_text(json.dumps(st,ensure_ascii=False,indent=1));os.replace(tmp,A/'state.json')
def ledger():return [json.loads(l) for l in (A/'ledger.jsonl').read_text().splitlines() if l.strip()] if (A/'ledger.jsonl').exists() else []
def run_receipt(run_id):
    e=next(x for x in ledger() if x['runId']==run_id and x['status']=='COMPLETED')
    return load(CTRL/('learning-batch-parent-v%d/run-outputs/worker/receipt.json'%e['version'])),e
def latest_metrics():
    done=[x for x in ledger() if x['status']=='COMPLETED']
    return load(CTRL/('learning-batch-parent-v%d/run-outputs/worker/metrics.json'%done[-1]['version'])) if done else None
def resolve():
    import mirror_fetch
    st=load(A/'state.json');ch=st['champion']
    if ch['modelId']==REFERENCE['modelId']:
        champ={'modelId':ch['modelId'],'spec':REFERENCE['spec'],'files':dict(REFERENCE['files']),'podDevSPred':REFERENCE['podDevPred']};pins=dict(REFERENCE['pins'])
        champ['ledgerDevSMAE']=(ch.get('devSMetrics') or {}).get('MAE')
    else:
        r,_=run_receipt(ch['runId']);inv=r['artifactInventory'];cand=ch['candidate'];res=next(x for x in r['results'] if x['candidate']==cand);base=ch['runId']+'/worker/'
        names={'pooled':cand+'.model.json','linear':cand+'.linear.json'};files={k:base+names.get(k,cand+'.'+k+'.model.json') for k in res['artifactSha256']}
        pins={f:inv[f[len(base):]]['sha256'] for f in files.values()};pins[base+cand+'.dev-s-pred.npy']=inv[cand+'.dev-s-pred.npy']['sha256']
        for f,h in pins.items():assert inv[f[len(base):]]['sha256']==h
        champ={'modelId':ch['modelId'],'spec':ch['spec'],'files':files,'podDevSPred':base+cand+'.dev-s-pred.npy','ledgerDevSMAE':ch['devSMetrics']['MAE']}
        pins.update(REFERENCE['pins'])
    fetched=[mirror_fetch.fetch(OUTS+'/'+f,None,h) for f,h in sorted(pins.items())]
    m=latest_metrics();support=m['routeTrainSupportRows'] if m else None
    return st,champ,support,fetched
def docker(job,host_out):
    cmd=['docker','run','--rm','--network','none','--cpus','10','-v',f'{MR}:/m:ro','-v',f'{A/"hfinal"}:/h:ro','-v',f'{A/"pkg"}:/pkg:ro','-v',f'{RB}:/rb:ro','-v',f'{host_out}:/o','python:3.12-slim','sh','-c',
         'set -e;dpkg -i /rb/.debs-linux-aarch64/libgomp1_14.2.0-19_arm64.deb >/dev/null 2>&1;python -m venv /tmp/v >/dev/null;'
         '/tmp/v/bin/pip install --quiet --no-index --find-links /rb/.wheels-linux-aarch64 numpy==2.4.4 pyarrow==24.0.0 scipy==1.18.1;'
         '/tmp/v/bin/pip install --quiet --no-index --no-deps --find-links /rb/.wheels-linux-aarch64 xgboost==3.4.1;/tmp/v/bin/python -B /h/evaluate.py /o/job.json']
    (Path(host_out)/'job.json').write_text(json.dumps(job,indent=1))
    t=time.time();p=subprocess.run(cmd,capture_output=True,text=True);return p,time.time()-t
def main():
    mode=sys.argv[1];st,champ,support,fetched=resolve()
    if mode=='final':
        why=sys.argv[2];assert why in ALLOWED_FINAL,'STOP_REASON_NOT_FINAL:'+why
        prior=st.get('hFinal')
        if prior and prior.get('status')=='COMPLETED':raise SystemExit('H_ALREADY_OPENED')
        if prior and prior.get('HOpened') and prior.get('champion')!=champ['modelId']:raise SystemExit('H_OPENED_FOR_ANOTHER_CHAMPION')
    tag=('rehearse-' if mode=='rehearse' else 'final-')+champ['modelId'].replace('.','_')+'-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    host_out=A/'hfinal/runs'/tag;host_out.mkdir(parents=True)
    job={'mode':'REPRODUCE_ONLY' if mode=='rehearse' else 'FINAL','mirror':'/m/salmonbus-full-v1','artifacts':'/m/'+OUTS,'out':'/o/result','common':'/pkg/common.py','champion':champ,'reference':{k:REFERENCE[k] for k in ('modelId','spec','files','podDevPred')},
         'podRouteTrainSupportRows':support,'tolerance':TOL,'hDays':H_DAYS}
    if mode=='final':
        st['hFinal']={'status':'RUNNING','champion':champ['modelId'],'reason':sys.argv[2],'dir':str(host_out),'HOpened':False};save_state(st)
    p,secs=docker(job,host_out);res=host_out/'result'
    out={'mode':mode,'returncode':p.returncode,'seconds':round(secs),'stdoutTail':p.stdout[-1500:],'stderrTail':p.stderr[-1500:],'fetched':fetched}
    (host_out/'host-run.json').write_text(json.dumps(out,ensure_ascii=False,indent=1))
    if mode=='final':
        st=load(A/'state.json');opened=(res/'h-opening.json').exists()
        st['hFinal'].update(HOpened=opened,status='COMPLETED' if (res/'h-final.json').exists() else ('FAILED_AFTER_OPENING' if opened else 'REPRODUCTION_FAILED_SEALED'))
        if (res/'h-final.json').exists():st['hFinal']['resultPath']=str(res/'h-final.json')
        save_state(st)
    print(json.dumps({k:out[k] for k in ('mode','returncode','seconds','stdoutTail')},ensure_ascii=False))
    return p.returncode
if __name__=='__main__':raise SystemExit(main())
