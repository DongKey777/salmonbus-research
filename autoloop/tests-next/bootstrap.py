"""Inside the Linux container: write fresh parent evidence and an approved test request for one experiment, then run run.py like the parent would (pkg-next; also reports derived-feature artifacts)."""
import hashlib,json,os,platform,subprocess,sys,time,types
from pathlib import Path
PK=Path('/pkg');T=Path('/t');case=sys.argv[1];spec=json.load(open('/h/'+sys.argv[2]))
C=types.ModuleType('c');C.__file__=str(PK/'common.py');exec(compile((PK/'common.py').read_bytes(),'common.py','exec'),C.__dict__)
import numpy,pyarrow,scipy,xgboost
versions={'python':platform.python_version(),'numpy':numpy.__version__,'scipy':scipy.__version__,'pyarrow':pyarrow.__version__,'xgboost':xgboost.__version__,'nccl':'2.32.3'}
enc=lambda d:json.dumps(d,sort_keys=True,separators=(',',':')).encode()+b'\n';sha=lambda b:hashlib.sha256(b).hexdigest()
inp=T/'control/test-inputs'/case;inp.mkdir(parents=True)
ev={'schema':'SEAT_DEPTH_SWEEP_RUNTIME_EVIDENCE/1','observedAtEpoch':time.time(),'pythonExecutable':sys.executable,'imageDigest':C.IMAGE,'versions':versions,'providerMemoryBytes':125000000000,'cgroupMemoryMaxBytes':124999999488,'effectiveCpuQuotaCores':27.2,'gpuMemoryBytes':48305799168,'gpuCount':1}
eb=enc(ev);(inp/'runtime-evidence.json').write_bytes(eb)
run='AUTOLOOP_900';deadline=time.time()+3000;ref='ab'*32;out=str(T/'outputs'/run)
au={'schema':'SEAT_DEPTH_SWEEP_RESOURCE_AUTHORITY/1','approved':True,'authorizationRef':ref,'runId':run,'outputRoot':out,'parentDeadlineUnix':deadline,'limitsSha256':C.digest(C.LIMITS),'resourcePlanRef':'cd'*32,'watchdogRef':'ef'*32}
ab=enc(au);(inp/'resource-authority.json').write_bytes(ab)
q=json.loads((PK/'REQUEST.template.json').read_bytes())
q.update(approved=True,authorizationRef=ref,runId=run,outputRoot=out,pythonExecutable=sys.executable,parentDeadlineUnix=deadline,experiment=spec,runtimeEvidence={'path':str(inp/'runtime-evidence.json'),'sha256':sha(eb)},resourceAuthority={'path':str(inp/'resource-authority.json'),'sha256':sha(ab)})
q['pins']={k:{'path':v['path'].replace(str(C.BASE),str(T)),'sha256':v['sha256']} for k,v in q['pins'].items()}
cp=T/'outputs/SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy';q['champion']={'modelId':'SEAT.V2_D8','scope':'DEV','predictions':{'path':str(cp),'sha256':sha(cp.read_bytes())}}
if case=='tampered-split':
    p=sorted((T/'outputs/FULL_TRAIN_PREPARATION_014/dataset/dev').iterdir())[0];b=bytearray(p.read_bytes());b[-20]^=1;p.write_bytes(bytes(b))
qb=enc(q);(inp/'request.json').write_bytes(qb)
env=dict(os.environ)
if case!='real-mode-refusal':env['AUTOLOOP_TEST']=json.dumps({'base':str(T),'device':'cpu','limit':int(os.environ.get('LIMIT','2')),'expectVersions':versions,'minBlockRows':2000})
pkg=sha((PK/'PACKAGE.json').read_bytes())
p=subprocess.run([sys.executable,'-B',str(PK/'run.py'),'--request',str(inp/'request.json'),'--request-sha',sha(qb),'--package-sha',pkg],env=env,capture_output=True,text=True,timeout=3000)
res={'case':case,'exit':p.returncode,'stdout':p.stdout[-2000:],'stderr':p.stderr[-2000:]}
o=Path(out)
for n in ('receipt.json','complete.json','failure.json'):
    if (o/n).exists():res[n]=json.loads((o/n).read_bytes())
for n in ('stdout.log','stderr.log'):
    if (o/'worker'/n).exists():res['worker-'+n]=(o/'worker'/n).read_text()[-3000:]
if (o/'worker/metrics.json').exists():
    m=json.loads((o/'worker/metrics.json').read_bytes());res['summary']={'rows':m['rows'],'blocks':m['blocks'],'champion':round(m['champion']['MAE'],4),'product':round(m['product']['MAE'],4),'candidates':{k:{'MAE':round(v['final'].get('MAE',float('nan')),4) if v['head']=='SEAT' else None,'Brier':v['final'].get('Brier'),'gate':v.get('gatePassed'),'dMAE_CI':v.get('deltaVsChampionCI95',{}).get('MAE'),'worse':v.get('guardWorsened'),'quantileCoverage':v.get('quantileCoverage')} for k,v in m['candidates'].items()}}
wd=o/'worker'
if wd.exists():
    res['workerFiles']=sorted(p_.name for p_ in wd.iterdir())
    if (wd/'progress.json').exists():res['lastPhase']=json.loads((wd/'progress.json').read_bytes())['phase']
    if (wd/'receipt.json').exists():
        wr=json.loads((wd/'receipt.json').read_bytes());res['workerDerived']=wr.get('derivedFeatures')
        res['recipes']={x['candidate']:{k:v for k,v in json.loads((wd/(x['candidate']+'.recipe.json')).read_bytes()).items() if k in ('featureNames','derivedFeatures','derivedJava')} for x in wr['results']}
        res['derivedFiles']={p_.name:hashlib.sha256(p_.read_bytes()).hexdigest() for p_ in sorted(wd.iterdir()) if p_.name.startswith('derived-') or p_.name.endswith('.derived.java')}
    if (wd/'diagnostics.json').exists():res['derivedFeatureImportance']=json.loads((wd/'diagnostics.json').read_bytes()).get('derivedFeatureImportance')
print('RESULT_JSON '+json.dumps(res,default=str))
