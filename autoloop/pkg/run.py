"""One owned autonomous-loop worker under bounded local supervision; accepts only an exact worker receipt. No provider API."""
from pathlib import Path
import argparse,json,os,resource,signal,subprocess,sys,time,types
R=Path(__file__).resolve().parent
C=types.ModuleType('autoloop_common');C.__file__=str(R/'common.py');exec(compile((R/'common.py').read_bytes(),C.__file__,'exec'),C.__dict__)
need=C.need
STATUS='AUTOLOOP_TRAINED_AND_DEV_S_SCORED_NOT_ADOPTED'
def gpu(test):
    if test:return {'name':'TEST_NO_GPU','totalBytes':0,'usedBytes':0}
    x=subprocess.run(['/usr/bin/nvidia-smi','--query-gpu=name,memory.total,memory.used','--format=csv,noheader,nounits'],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=5)
    rows=[r for r in x.stdout.splitlines() if r.strip()];need(x.returncode==0 and len(rows)==1,'GPU_OBSERVATION');v=[t.strip() for t in rows[0].split(',')]
    return {'name':v[0],'totalBytes':int(v[1])*2**20,'usedBytes':int(v[2])*2**20}
def rss(pid):
    total=0
    for line in open('/proc/%d/status'%pid):
        if line.startswith('VmRSS:'):total=int(line.split()[1])*1024
    return total
def allocation(root):
    t=0
    for p in root.rglob('*'):
        need(not p.is_symlink(),'OUTPUT_SYMLINK')
        if p.is_file():t+=p.stat().st_blocks*512
    return t
def stop(child):
    if child is not None and child.poll() is None:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.wait(timeout=5)
def accept(wd,q,request_sha,package_sha,test):
    r=json.loads((wd/'receipt.json').read_bytes());rsha=C.file_sha(wd/'receipt.json',8<<20);c=json.loads((wd/'complete.json').read_bytes())
    want='TEST_ONLY_NOT_ACCEPTED' if test else 'PRODUCED_NOT_ACCEPTED'
    need(c=={'schema':'AUTOLOOP_WORKER_COMPLETE/1','receiptSha256':rsha,'requestSha256':request_sha,'status':want},'WORKER_COMPLETE')
    need(r['schema']=='AUTOLOOP_WORKER_RECEIPT/1' and r['status']==want and r['requestSha256']==request_sha and r['packageSha256']==package_sha and r['runId']==q['runId'] and r['sourcePins']==q['pins'],'RECEIPT_IDENTITY')
    names=[s['candidate'] for s in q['experiment']['candidates']];need(r['trainingCalls']==len(names) and sorted(x['candidate'] for x in r['results'])==sorted(names) and r['experiment']==q['experiment']['id'],'ALL_CANDIDATES_TRAINED')
    need(r['HRead'] is False and r['HRowsLoaded']==0 and r['DEV_REUSED'] is True and r['modelAdoption'] is False and r['generalizationClaim'] is False and (test or r['CPUTrainingCalls']==0),'SCOPE_FLAGS')
    if not test:need(r['train']['complete'] and r['train']['rows']==C.TRAIN_ROWS and r['devS']['complete'] and r['devS']['rows']==C.DEV_S_ROWS and r['devS']['groups']==C.DEV_S_GROUPS,'FULL_TRAIN_DEV_S_CLOSURE')
    inv=r['artifactInventory'];actual={p.name for p in wd.iterdir()}-{'stdout.log','stderr.log','progress.json','receipt.json','complete.json'};need(actual==set(inv),'EXACT_INVENTORY')
    for n,pin in inv.items():
        p=wd/n;need(p.is_file() and not p.is_symlink() and p.stat().st_size==pin['bytes'] and C.file_sha(p,q['limits']['newBytes'])==pin['sha256'],'ARTIFACT_PIN:'+n)
    for x in r['results']:
        art=x['artifactSha256'];files={'pooled':x['candidate']+'.model.json','linear':x['candidate']+'.linear.json'}
        for k,h in art.items():need(inv[files.get(k,x['candidate']+'.'+k+'.model.json')]['sha256']==h,'ARTIFACT_BINDING:'+x['candidate']+':'+k)
        need(inv[x['candidate']+'.recipe.json']['sha256']==x['recipeSha256'] and inv[x['candidate']+'.decision.json']['sha256']==x['decisionSha256'],'STAGE_PIN_BINDING')
    need(inv['metrics.json']['sha256']==r['metricsSha256'] and inv['diagnostics.json']['sha256']==r['diagnosticsSha256'],'METRICS_PIN')
    return r,rsha
def main(a):
    raw=os.environ.get('AUTOLOOP_TEST');test=raw is not None;base=Path(json.loads(raw)['base']) if test else C.BASE;need(base!=C.BASE or not test,'TEST_BASE_SCOPE')
    expect=json.loads(raw)['expectVersions'] if test else None
    os.umask(0o077);C.verify_package(a.package_sha);q=json.loads(C.capture({'path':a.request,'sha256':a.request_sha},base=base));C.validate_request(q,base);C.validate_parent_evidence(q,base,expect)
    need(C.estimate_usd(q['experiment'])<=1.0,'EXPERIMENT_OVER_PER_RUN_BUDGET')
    if not test:need(sys.executable==q['pythonExecutable'] and sys.platform=='linux' and not sys.flags.optimize,'EXACT_PARENT_INTERPRETER')
    out=C.safe(q['outputRoot'],base);need(not out.exists() and out.parent.is_dir(),'NEW_RUN_OUTPUT_REQUIRED');out.mkdir(mode=0o700);wd=out/'worker';wd.mkdir(mode=0o700)
    l=q['limits'];begin=time.monotonic();deadline=begin+min(l['overallWallSeconds']+120,q['parentDeadlineUnix']-time.time());prior=resource.getrusage(resource.RUSAGE_CHILDREN);child=None;published=False;obs=[];handlers={}
    def interrupt(*_):raise C.Stop('AUTOLOOP_INTERRUPTED')
    for s in (signal.SIGTERM,signal.SIGINT):handlers[s]=signal.signal(s,interrupt)
    try:
        g=gpu(test);need(test or g['totalBytes']>=l['gpuMemoryBytes'],'GPU_CAPACITY')
        C.publish_new(out/'run-start.json',{'schema':'AUTOLOOP_START/1','runId':q['runId'],'experiment':q['experiment']['id'],'requestSha256':a.request_sha,'packageSha256':a.package_sha,'GPU':g,'test':test,'candidates':[s['candidate'] for s in q['experiment']['candidates']],'estimatedUSD':C.estimate_usd(q['experiment']),'automaticRetry':False})
        argv=[sys.executable,'-B',str(R/'worker.py'),'--request',a.request,'--request-sha',a.request_sha,'--package-sha',a.package_sha]
        env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':str(l['cpuThreads']),'OPENBLAS_NUM_THREADS':'1'}
        for k in ('LD_LIBRARY_PATH','CUDA_VISIBLE_DEVICES','NVIDIA_VISIBLE_DEVICES','NVIDIA_DRIVER_CAPABILITIES','AUTOLOOP_TEST'):
            if k in os.environ:env[k]=os.environ[k]
        with (wd/'stdout.log').open('xb') as so,(wd/'stderr.log').open('xb') as se:
            child=subprocess.Popen(argv,cwd=R,env=env,stdin=subprocess.DEVNULL,stdout=so,stderr=se,start_new_session=True)
            C.publish_new(out/'owned-child.json',{'pid':child.pid,'processGroupId':child.pid,'argvSha256':C.digest(argv),'requestSha256':a.request_sha})
            while child.poll() is None:
                need(time.monotonic()<deadline and time.time()<q['parentDeadlineUnix'],'OVERALL_DEADLINE')
                try:m=rss(child.pid)
                except FileNotFoundError:time.sleep(.05);continue
                g=gpu(test);need(m<=l['hostRssBytes'] and g['usedBytes']<=l['gpuMemoryBytes'],'RSS_OR_GPU_CAP')
                fs=os.statvfs(out);need(test or fs.f_bavail*fs.f_frsize>=l['minimumFreeDiskBytes'],'FREE_DISK_FLOOR');al=allocation(out);need(al<=l['newBytes'],'NEW_BYTES_CAP')
                obs.append({'elapsedSeconds':time.monotonic()-begin,'childRssBytes':m,'gpuUsedBytes':g['usedBytes'],'allocatedBytes':al});need(len(obs)<=4000,'OBSERVATION_CAP');time.sleep(l['monitorIntervalSeconds'])
            need(child.wait(timeout=5)==0,'AUTOLOOP_WORKER_FAILED')
        r,rsha=accept(wd,q,a.request_sha,a.package_sha,test)
        u=resource.getrusage(resource.RUSAGE_CHILDREN);cpu=u.ru_utime+u.ru_stime-prior.ru_utime-prior.ru_stime;need(cpu<=l['cpuSeconds'],'AGGREGATE_CPU_CAP')
        C.capture({'path':a.request,'sha256':a.request_sha},base=base);C.verify_package(a.package_sha);osha=C.publish_new(out/'observations.json',obs)
        status='TEST_ONLY_NOT_ACCEPTED' if test else STATUS
        result={'schema':'AUTOLOOP_RECEIPT/1','status':status,'test':test,'requestSha256':a.request_sha,'packageSha256':a.package_sha,'runId':q['runId'],'experiment':q['experiment']['id'],'sourcePins':q['pins'],'workerReceiptSha256':rsha,'trainingCalls':r['trainingCalls'],'results':r['results'],
                'bestGatePassing':r['bestGatePassing'],'champion':r['champion'],'product':r['product'],'metricsSha256':r['metricsSha256'],'diagnosticsSha256':r['diagnosticsSha256'],'declaredTRAINRows':r['train']['rows'],'declaredDEVSRows':r['devS']['rows'],'HRowsLoaded':0,'childCpuSeconds':cpu,'wallSeconds':time.monotonic()-begin,'observationsSha256':osha,
                'ownedChildExitCode':0,'ownedChildReaped':True,'HRead':False,'DEV_REUSED':True,'CPUTrainingCalls':r['CPUTrainingCalls'],'modelAdoption':False,'generalizationClaim':False,'providerResourcesStopped':False,'automaticRetry':False}
        rs=C.publish_new(out/'receipt.json',result);C.publish_new(out/'complete.json',{'schema':'AUTOLOOP_COMPLETE/1','status':status,'receiptSha256':rs,'requestSha256':a.request_sha,'packageSha256':a.package_sha})
        fd=os.open(out,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);published=True
        print(json.dumps({'status':status,'receiptSha256':rs,'trainingCalls':r['trainingCalls']}))
    except BaseException as e:
        if not published:
            stop(child)
            try:C.publish_new(out/'failure.json',{'schema':'AUTOLOOP_FAILURE/1','status':'FAILED_PRESERVED_NOT_ACCEPTED','reason':C.safe_reason(e),'requestSha256':a.request_sha,'ownedChildReaped':child is None or child.poll() is not None,'automaticRetry':False})
            except Exception:pass
        raise
    finally:
        stop(child)
        for s,h in handlers.items():signal.signal(s,h)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--request-sha',required=True);p.add_argument('--package-sha',required=True);a=p.parse_args()
    try:main(a)
    except (Exception,KeyboardInterrupt) as e:print(json.dumps({'status':'STOPPED_NOT_ACCEPTED','reason':C.safe_reason(e),'automaticRetry':False}));sys.exit(1)
