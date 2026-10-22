"""Autonomous loop package contract: fixed data pins, the planner's search space (including DSL v1 derived features from dsl.py), request validation and file helpers. No provider access."""
import hashlib,json,os,re,time,types
from pathlib import Path
R=Path(__file__).resolve().parent
D=types.ModuleType('autoloop_dsl');D.__file__=str(R/'dsl.py');exec(compile((R/'dsl.py').read_bytes(),D.__file__,'exec'),D.__dict__)
BASE=Path('/workspace/salmonbus-full-v1')
RUN_PATTERN='AUTOLOOP_[0-9]{3}'
PIN_SHA={
 'dataset':'a2e42ab6ab45c1f33c8963b13456fe957a500f1752c9d027f4125a0cb0cc7a62',
 'features':'3a529d633061cf5d3e8a50d42c5832ff7c71b1e0d2a7475c39a8b1cd33229ab9',
 'stopDemand':'29d829be913521a177750aae230800755b2ff49620f075b26a16773b541a3cfd',
 'devSplit':'53551deb1fe4ed806eda8d491addd3bffdcecceece43971cd7c1c49e41fa0e12'}
PIN_PATH={
 'dataset':'outputs/FULL_TRAIN_PREPARATION_007/dataset/dataset.json',
 'features':'outputs/FULL_TRAIN_PREPARATION_013/dataset/dataset.json',
 'stopDemand':'outputs/FULL_TRAIN_PREPARATION_012/dataset/dataset.json',
 'devSplit':'outputs/FULL_TRAIN_PREPARATION_014/dataset/dataset.json'}
CHAMPION_PATH=r'outputs/(SEAT_FEATURES_V2_002/worker/[A-Z0-9_]+\.dev-pred\.npy|AUTOLOOP_[0-9]{3}/worker/[A-Z0-9_]+\.dev-s-pred\.npy)'
DEV_ROWS=20989927
TRAIN_ROWS=38651044;DEV_S_ROWS=10701742;DEV_S_GROUPS=170833;DEV_SPLIT_CODE=1
ROUTE_FEATURE='x_route_code';HORIZON_FEATURE='f_horizon_stops';STOP_FEATURES=['s_fill_rate_score','s_net_boarding_segment_score','s_filled_by_neighbours']
HORIZON_EDGES=[1,2,4,8,16,32]
SEARCH={
 'maxCandidates':12,'maxTotalRounds':24576,'maxBlocksPerCandidate':80,'minBlockRows':50000,
 'kinds':{'XGB':{'heads':['SEAT','FULL'],
                 'objectives':{'SEAT':['reg:squarederror','reg:absoluteerror','reg:pseudohubererror','reg:quantileerror'],'FULL':['binary:logistic']},
                 'params':{'max_depth':[2,12],'eta':[0.005,0.5],'min_child_weight':[0,10000],'subsample':[0.3,1.0],'colsample_bytree':[0.2,1.0],'lambda':[0,1000],'alpha':[0,1000],'max_bin':[32,1024],'huber_slope':[0.1,20],'gamma':[0,100],'max_delta_step':[0,20]},
                 'rounds':[16,4096],'grow_policy':['depthwise','lossguide'],'max_leaves':[0,4096]},
           'LINEAR':{'heads':['SEAT'],'params':{'ridge':[0,1e6]}}},
 'featureSets':['ALL','NO_ROUTE','NO_STOP','BASE6'],'blocks':['NONE','ROUTE_HORIZON'],
 'quantileAlphas':[0.05,0.95],
 'derived':{'dslVersion':D.VERSION,'maxPerExperiment':16,**D.LIMITS}}
BASE_PARAMS={'device':'cuda:0','tree_method':'hist','max_bin':256,'seed':20261022,'subsample':1.0,'colsample_bytree':1.0,'grow_policy':'depthwise','nthread':27,'verbosity':0}
GATE={'schema':'AUTOLOOP_GATE/1','primary':'DEV_S MAE paired delta vs champion, 95% block bootstrap interval entirely below 0','guards':['unseenRouteMAE','routeMacroMAE','fullBusUnder2Share','over10Share'],'guardRule':'fail when the 95% interval shows a worsening','blocks':'service day x KST hour','resamples':2000,'seed':20261022}
LIMITS={'overallWallSeconds':3300,'perCandidateWallSeconds':1500,'cpuSeconds':97200,'hostRssBytes':103079215104,'gpuMemoryBytes':47244640256,'newBytes':12884901888,'minimumFreeDiskBytes':8589934592,'cpuThreads':27,'predictRows':4194304,'monitorIntervalSeconds':2}
class Stop(Exception):pass
def need(ok,code):
    if not ok:raise Stop(code)
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(v):return hashlib.sha256(canonical(v)).hexdigest()
def sha_bytes(b):return hashlib.sha256(b).hexdigest()
def file_sha(p,cap):
    h=hashlib.sha256();n=0
    with open(p,'rb') as f:
        while True:
            b=f.read(8<<20)
            if not b:break
            n+=len(b);need(n<=cap,'FILE_CAP');h.update(b)
    return h.hexdigest()
def safe(p,base=None):
    base=Path(base or BASE);p=Path(p);need(p.is_absolute() and '..' not in p.parts and (p==base or base in p.parents),'PATH_SCOPE')
    for x in [p,*p.parents]:need(not x.is_symlink(),'PATH_SYMLINK')
    return p
def capture(pin,cap=64<<20,base=None):
    need(type(pin) is dict and set(pin)=={'path','sha256'},'PIN_FIELDS');p=safe(pin['path'],base);need(p.is_file() and p.stat().st_size<=cap,'PIN_FILE')
    b=p.read_bytes();need(sha_bytes(b)==pin['sha256'],'PIN_BYTES:'+p.name);return b
def publish_new(path,obj):return publish_bytes(path,canonical(obj)+b'\n')
def publish_bytes(path,b):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    return sha_bytes(b)
def replace_json(path,obj):
    tmp=Path(str(path)+'.next');b=canonical(obj)+b'\n'
    with open(tmp,'wb') as f:f.write(b);f.flush()
    os.replace(tmp,path)
def verify_package(package_sha):
    raw=(R/'PACKAGE.json').read_bytes();need(sha_bytes(raw)==package_sha,'PACKAGE_PIN');pkg=json.loads(raw)
    need(pkg['schema']=='AUTOLOOP_PACKAGE/1','PACKAGE_SCHEMA')
    for n,h in pkg['files'].items():need(sha_bytes((R/n).read_bytes())==h,'PACKAGE_FILE:'+n)
    return pkg
def safe_reason(e):
    s=str(e);return s if re.fullmatch('[A-Z][A-Z0-9_:./-]{0,200}',s) else type(e).__name__
def in_range(v,bounds,code):
    need(isinstance(v,(int,float)) and not isinstance(v,bool) and bounds[0]<=v<=bounds[1],code)
def selected_names(f,feature_names):
    if isinstance(f,list):return list(f)
    return {'ALL':list(feature_names),'NO_ROUTE':[x for x in feature_names if x!=ROUTE_FEATURE],'NO_STOP':[x for x in feature_names if x not in STOP_FEATURES],'BASE6':list(feature_names[:6])}[f]
def derived_union(cs):
    out={}
    for c in cs:
        for a in c.get('derivedFeatures',()):out.setdefault(D.name(a),D.canon(a))
    return list(out.items())
def validate_candidate(c,feature_names):
    need(type(c) is dict and re.fullmatch('[A-Z][A-Z0-9_]{0,31}',str(c.get('candidate',''))),'CANDIDATE_NAME')
    name=c['candidate'];kind=c.get('kind');need(kind in SEARCH['kinds'],'CANDIDATE_KIND:'+name);spec=SEARCH['kinds'][kind]
    allowed={'candidate','kind','head','features','blocks','params','rounds','curve','objective','quantileAlphas','note','derivedFeatures'}
    need(set(c)<=allowed and {'candidate','kind','head','features','blocks','params'}<=set(c),'CANDIDATE_FIELDS:'+name)
    need(c['head'] in spec['heads'],'CANDIDATE_HEAD:'+name);need(c['blocks'] in SEARCH['blocks'],'CANDIDATE_BLOCKS:'+name)
    f=c['features']
    if isinstance(f,list):need(3<=len(f)<=len(feature_names) and len(set(f))==len(f) and set(f)<=set(feature_names),'CANDIDATE_FEATURE_LIST:'+name)
    else:need(f in SEARCH['featureSets'],'CANDIDATE_FEATURE_SET:'+name)
    if 'derivedFeatures' in c:
        errs=D.validate_list(c['derivedFeatures'],selected_names(f,feature_names));e=(errs[0].split() if errs else [])+['','']
        need(not errs,'CANDIDATE_DERIVED:'+name+':'+e[0]+':'+e[1].upper().replace('$','ROOT'))
    need(type(c['params']) is dict,'CANDIDATE_PARAMS:'+name)
    if kind=='XGB':
        need(c.get('objective') in spec['objectives'][c['head']],'CANDIDATE_OBJECTIVE:'+name)
        in_range(c.get('rounds'),spec['rounds'],'CANDIDATE_ROUNDS:'+name);need(isinstance(c['rounds'],int),'CANDIDATE_ROUNDS_INT:'+name)
        for k,v in c['params'].items():
            if k=='grow_policy':need(v in spec['grow_policy'],'CANDIDATE_GROW:'+name)
            elif k=='max_leaves':in_range(v,spec['max_leaves'],'CANDIDATE_LEAVES:'+name)
            else:need(k in spec['params'],'CANDIDATE_PARAM_KEY:'+name+':'+k);in_range(v,spec['params'][k],'CANDIDATE_PARAM:'+name+':'+k)
        need('max_depth' in c['params'] and 'eta' in c['params'],'CANDIDATE_DEPTH_ETA:'+name)
        if c['objective']=='reg:quantileerror':
            a=c.get('quantileAlphas');need(isinstance(a,list) and 0.5 in a and 1<=len(a)<=5 and all(isinstance(x,float) and 0<x<1 for x in a) and a==sorted(set(a)),'CANDIDATE_QUANTILES:'+name)
        else:need('quantileAlphas' not in c,'CANDIDATE_QUANTILES_UNUSED:'+name)
        if c['objective']=='reg:pseudohubererror':need('huber_slope' in c['params'],'CANDIDATE_HUBER_SLOPE:'+name)
        curve=c.get('curve',[c['rounds']]);need(isinstance(curve,list) and 1<=len(curve)<=8 and curve==sorted(set(curve)) and curve[-1]==c['rounds'] and all(isinstance(x,int) and 1<=x for x in curve),'CANDIDATE_CURVE:'+name)
    else:
        need(set(c['params'])=={'ridge'},'LINEAR_PARAMS:'+name);in_range(c['params']['ridge'],spec['params']['ridge'],'LINEAR_RIDGE:'+name)
        need('rounds' not in c and 'objective' not in c and 'curve' not in c,'LINEAR_FIELDS:'+name)
    return c
def validate_experiment(e,feature_names):
    need(type(e) is dict and set(e)=={'id','hypothesis','candidates'} and re.fullmatch('[A-Z][A-Z0-9_]{2,40}',e['id']),'EXPERIMENT_FIELDS')
    need(isinstance(e['hypothesis'],str) and 10<=len(e['hypothesis'])<=2000,'EXPERIMENT_HYPOTHESIS')
    cs=e['candidates'];need(isinstance(cs,list) and 1<=len(cs)<=SEARCH['maxCandidates'],'EXPERIMENT_CANDIDATE_COUNT')
    for c in cs:validate_candidate(c,feature_names)
    need(len({c['candidate'] for c in cs})==len(cs) and all(c['candidate']!='CHAMPION' for c in cs),'EXPERIMENT_CANDIDATE_NAMES')
    need(len(derived_union(cs))<=SEARCH['derived']['maxPerExperiment'],'EXPERIMENT_DERIVED_COUNT')
    need(sum(c.get('rounds',0) for c in cs)<=SEARCH['maxTotalRounds'],'EXPERIMENT_TOTAL_ROUNDS')
    return e
def validate_champion(ch,base=None):
    base=Path(base or BASE)
    need(type(ch) is dict and set(ch)=={'modelId','predictions','scope'} and re.fullmatch('SEAT\\.[A-Za-z0-9_]{1,40}',ch['modelId']) and ch['scope'] in ('DEV','DEV_S'),'CHAMPION_FIELDS')
    p=ch['predictions'];need(type(p) is dict and set(p)=={'path','sha256'} and re.fullmatch('[0-9a-f]{64}',p['sha256']),'CHAMPION_PIN')
    rel=Path(p['path']).relative_to(base) if str(p['path']).startswith(str(base)+'/') else None
    need(rel is not None and re.fullmatch(CHAMPION_PATH,str(rel)) and (ch['scope']=='DEV')==str(rel).endswith('.dev-pred.npy'),'CHAMPION_PATH')
    return ch
REQUEST_KEYS={'schema','approved','authorizationRef','runId','outputRoot','pythonExecutable','parentDeadlineUnix','runtimeEvidence','resourceAuthority','pins','champion','experiment','gate','limits','purpose','HRead','DEV_REUSED','cpuTrainingAuthorized','modelAdoption'}
def validate_request(q,base=None,feature_names=None):
    base=Path(base or BASE)
    need(type(q) is dict and set(q)==REQUEST_KEYS and q['schema']=='AUTOLOOP_REQUEST/1','REQUEST_FIELDS')
    need(q['approved'] is True and re.fullmatch('[0-9a-f]{64}',q['authorizationRef'] or ''),'REQUEST_APPROVAL')
    need(re.fullmatch(RUN_PATTERN,q['runId']) and q['outputRoot']==str(base/'outputs'/q['runId']),'RUN_BINDING')
    need(q['gate']==GATE and q['limits']==LIMITS,'FIXED_GATE_LIMITS')
    need(q['purpose']=='AUTOLOOP_FRESH_FIT_AND_DEV_S_SCORE' and q['HRead'] is False and q['DEV_REUSED'] is True and q['cpuTrainingAuthorized'] is False and q['modelAdoption'] is False,'SCOPE_FLAGS')
    need(set(q['pins'])==set(PIN_SHA),'PIN_SET')
    for k,pin in q['pins'].items():need(pin=={'path':str(base/PIN_PATH[k]),'sha256':PIN_SHA[k]},'FIXED_PIN:'+k)
    validate_champion(q['champion'],base)
    for k in ('runtimeEvidence','resourceAuthority'):
        need(type(q[k]) is dict and set(q[k])=={'path','sha256'} and re.fullmatch('[0-9a-f]{64}',q[k]['sha256']),'EVIDENCE_PIN')
        need(base/'control' in safe(q[k]['path'],base).parents,'EVIDENCE_PATH')
    need(isinstance(q['parentDeadlineUnix'],(int,float)) and q['parentDeadlineUnix']>time.time(),'PARENT_DEADLINE')
    if feature_names is not None:validate_experiment(q['experiment'],feature_names)
    return q
EVIDENCE_KEYS={'schema','observedAtEpoch','pythonExecutable','imageDigest','versions','providerMemoryBytes','cgroupMemoryMaxBytes','effectiveCpuQuotaCores','gpuMemoryBytes','gpuCount'}
EXPECT_VERSIONS={'python':'3.12.3','numpy':'2.4.4','scipy':'1.18.1','pyarrow':'24.0.0','xgboost':'3.4.1','nccl':'2.32.3'}
IMAGE='sha256:b635f96e8e24b75a4a3ff2132b8043dd4c4651f75775a4f1a670d8e4b19b55fc'
AUTH_KEYS={'schema','approved','authorizationRef','runId','outputRoot','parentDeadlineUnix','limitsSha256','resourcePlanRef','watchdogRef'}
def validate_parent_evidence(q,base=None,expect=None):
    env=json.loads(capture(q['runtimeEvidence'],base=base));auth=json.loads(capture(q['resourceAuthority'],base=base))
    need(set(env)==EVIDENCE_KEYS and env['schema']=='SEAT_DEPTH_SWEEP_RUNTIME_EVIDENCE/1' and 0<=time.time()-env['observedAtEpoch']<=900,'FRESH_RUNTIME_EVIDENCE')
    need(env['pythonExecutable']==q['pythonExecutable'] and env['imageDigest']==IMAGE and env['versions']==(expect or EXPECT_VERSIONS) and env['gpuCount']==1,'RUNTIME_IDENTITY')
    l=q['limits'];need(l['hostRssBytes']<=min(env['providerMemoryBytes'],env['cgroupMemoryMaxBytes']) and l['gpuMemoryBytes']<=env['gpuMemoryBytes'] and l['cpuThreads']<=env['effectiveCpuQuotaCores'],'CAPACITY_GATE')
    need(set(auth)==AUTH_KEYS and auth['schema']=='SEAT_DEPTH_SWEEP_RESOURCE_AUTHORITY/1' and auth['approved'] is True,'RESOURCE_AUTHORITY')
    for k in ('authorizationRef','runId','outputRoot','parentDeadlineUnix'):need(auth[k]==q[k],'RESOURCE_AUTHORITY_JOIN')
    need(auth['limitsSha256']==digest(q['limits']) and re.fullmatch('[0-9a-f]{64}',auth['resourcePlanRef']) and re.fullmatch('[0-9a-f]{64}',auth['watchdogRef']),'RESOURCE_LIMIT_PIN')
    return env,auth
FIXED_SECONDS=420;SECONDS_PER_ROUND={4:0.03,6:0.048,8:0.055,10:0.08,12:0.12};MATRIX_SECONDS=36;LINEAR_SECONDS=60;HOURLY_USD=1.09;DERIVED_SECONDS=10
def estimate_seconds(e):
    keys=set();s=FIXED_SECONDS;dk=set()
    for c in e['candidates']:
        fk=json.dumps(c['features'])+c['blocks'];
        if c.get('derivedFeatures'):fk+=json.dumps(c['derivedFeatures'],sort_keys=True);dk.update(json.dumps(a,sort_keys=True) for a in c['derivedFeatures'])
        if fk not in keys:keys.add(fk);s+=MATRIX_SECONDS*(4 if c['blocks']!='NONE' else 1)
        if c['kind']=='LINEAR':s+=LINEAR_SECONDS*(2 if c['blocks']!='NONE' else 1);continue
        d=c['params']['max_depth'];per=SECONDS_PER_ROUND.get(d) or SECONDS_PER_ROUND[min(SECONDS_PER_ROUND,key=lambda k:abs(k-d))]*(1.5 if d>12 else 1)
        mult=(len(c.get('quantileAlphas',[0.5])) if c['objective']=='reg:quantileerror' else 1)*(1.6 if c['blocks']!='NONE' else 1)
        s+=c['rounds']*per*mult
    return s+DERIVED_SECONDS*len(dk)
def estimate_usd(e,margin=1.25):return round(estimate_seconds(e)/3600*HOURLY_USD*margin,3)
