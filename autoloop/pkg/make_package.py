"""Write PACKAGE.json and the request template for the autonomous loop package. The experiment is filled per run by the loop. Refuses to overwrite."""
import hashlib,json,types
from pathlib import Path
R=Path(__file__).resolve().parent
C=types.ModuleType('c');C.__file__=str(R/'common.py');exec(compile((R/'common.py').read_bytes(),'common.py','exec'),C.__dict__)
q={'schema':'AUTOLOOP_REQUEST/1','approved':False,'authorizationRef':None,'runId':None,'outputRoot':None,'pythonExecutable':'/opt/salmonbus-full-venv/bin/python','parentDeadlineUnix':None,
   'runtimeEvidence':None,'resourceAuthority':None,'pins':{k:{'path':str(C.BASE/C.PIN_PATH[k]),'sha256':C.PIN_SHA[k]} for k in C.PIN_SHA},'champion':None,'experiment':None,'gate':C.GATE,'limits':C.LIMITS,
   'purpose':'AUTOLOOP_FRESH_FIT_AND_DEV_S_SCORE','HRead':False,'DEV_REUSED':True,'cpuTrainingAuthorized':False,'modelAdoption':False}
with open(R/'REQUEST.template.json','x') as f:f.write(json.dumps(q,indent=1,sort_keys=True)+'\n')
files={n:hashlib.sha256((R/n).read_bytes()).hexdigest() for n in ('common.py','worker.py','run.py')}
with open(R/'PACKAGE.json','x') as f:f.write(json.dumps({'schema':'AUTOLOOP_PACKAGE/1','files':files},indent=1,sort_keys=True)+'\n')
print(json.dumps({'package':hashlib.sha256((R/'PACKAGE.json').read_bytes()).hexdigest(),'requestTemplate':hashlib.sha256((R/'REQUEST.template.json').read_bytes()).hexdigest(),'files':files}))
