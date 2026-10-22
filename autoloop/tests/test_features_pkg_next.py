"""Contract tests for pkg-next and features/validate.py: vendored dsl.py is byte-identical, every pkg behaviour is unchanged when
derivedFeatures is absent (validation codes, budget estimate, feature columns, constants), derived-feature validation codes are safe
stop reasons, the package pins verify, and the TRAIN-only validator reads only TRAIN shards of the local mirror."""
import copy,hashlib,importlib.util,json,types
from pathlib import Path
A=Path(__file__).resolve().parents[1]
def mod(n,p):m=types.ModuleType(n);m.__file__=str(p);exec(compile(Path(p).read_bytes(),str(p),'exec'),m.__dict__);return m
OLD=mod('pkg_common',A/'pkg/common.py');NEW=mod('next_common',A/'pkg-next/common.py');V=mod('validate',A/'features/validate.py');D=NEW.D
def worker(p):
    s=importlib.util.spec_from_file_location('w_'+p.parent.name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
WO=worker(A/'pkg/worker.py');WN=worker(A/'pkg-next/worker.py')
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
def code(f,*a):
    try:f(*a);return None
    except OLD.Stop as e:return 'STOP:'+str(e)
    except NEW.Stop as e:return 'STOP:'+str(e)
    except Exception as e:return 'EXC:'+type(e).__name__
def main():
    check('pkg-next/dsl.py is byte-identical to features/dsl.py',(A/'pkg-next/dsl.py').read_bytes()==(A/'features/dsl.py').read_bytes())
    check('run.py is byte-identical to pkg',(A/'pkg-next/run.py').read_bytes()==(A/'pkg/run.py').read_bytes())
    for k in ('PIN_SHA','PIN_PATH','GATE','LIMITS','BASE_PARAMS','HORIZON_EDGES','ROUTE_FEATURE','STOP_FEATURES','IMAGE','EXPECT_VERSIONS','REQUEST_KEYS','TRAIN_ROWS','DEV_S_ROWS','DEV_S_GROUPS','FIXED_SECONDS','SECONDS_PER_ROUND','MATRIX_SECONDS','LINEAR_SECONDS','HOURLY_USD'):
        check('constant %s unchanged'%k,getattr(OLD,k)==getattr(NEW,k))
    check('SEARCH unchanged apart from the added derived block',{k:v for k,v in NEW.SEARCH.items() if k!='derived'}==OLD.SEARCH and NEW.SEARCH['derived']['maxPerCandidate']==6)
    names=D.BASE_FEATURES;specs=[json.loads((A/'tests'/f).read_bytes()) for f in ('spec-all-kinds.json','spec-huber.json','spec-quantile-single.json','happy.json')[:3]]
    for s in specs:
        check('existing spec %s validates in both'%s['id'],code(OLD.validate_experiment,s,names) is None and code(NEW.validate_experiment,s,names) is None)
        check('existing spec %s budget estimate unchanged'%s['id'],OLD.estimate_usd(s)==NEW.estimate_usd(s) and OLD.estimate_seconds(s)==NEW.estimate_seconds(s))
    base=specs[0];muts=[]
    for i,c in enumerate(base['candidates']):
        for mut in (lambda c:c.pop('params'),lambda c:c.update(foo=1),lambda c:c.update(features=['f_remaining_seats','nope','p_is_full']),lambda c:c.update(features='SOME'),lambda c:c.update(blocks='ROUTE'),
                    lambda c:c.update(head='FULL'),lambda c:c.update(rounds=10.5),lambda c:c.update(rounds=99999),lambda c:c['params'].update(max_depth=40),lambda c:c['params'].update(bogus=1),lambda c:c.update(objective='reg:gamma'),
                    lambda c:c.update(quantileAlphas=[0.1,0.9]),lambda c:c.update(curve=[64,32]),lambda c:c.update(candidate='bad name'),lambda c:c['params'].update(ridge=-1),lambda c:c.update(kind='GBM'),lambda c:c.update(note='ok')):
            e=copy.deepcopy(base);c2=e['candidates'][i]
            try:mut(c2)
            except Exception:continue
            muts.append(e)
    for extra in (lambda e:e['candidates'].append(copy.deepcopy(e['candidates'][0])),lambda e:e.update(id='x'),lambda e:e.update(hypothesis='short'),lambda e:e['candidates'][0].update(candidate='CHAMPION'),lambda e:e.update(candidates=e['candidates']*2)):
        e=copy.deepcopy(base);extra(e);muts.append(e)
    same=[(code(OLD.validate_experiment,e,names),code(NEW.validate_experiment,e,names)) for e in muts]
    check('%d mutated old-style experiments (%d refused) give identical outcomes in pkg and pkg-next'%(len(muts),sum(a is not None for a,_ in same)),all(a==b for a,b in same) and sum(a is not None for a,_ in same)>=len(muts)*0.9)
    sets=['ALL','NO_ROUTE','NO_STOP','BASE6',['f_remaining_seats','x_route_code','s_fill_rate_score'],list(reversed(names))]
    check('worker feature columns unchanged without derived features',all(WO.feature_cols({'features':f},names)==WN.feature_cols({'features':f},names) for f in sets))
    col=lambda n:{'op':'col','name':n};k=lambda v:{'op':'const','value':v}
    D1=json.loads((A/'tests-next/spec-derived.json').read_bytes())['candidates'][0]['derivedFeatures'][0];D2=json.loads((A/'tests-next/spec-derived.json').read_bytes())['candidates'][0]['derivedFeatures'][1]
    feats=names+[D.name(D1),D.name(D2)]
    check('worker feature columns append derived features after the selected base set',WN.feature_cols({'features':'ALL','derivedFeatures':[D2,D1]},feats,32)==list(range(32))+[33,32]
          and WN.feature_cols({'features':'NO_ROUTE','derivedFeatures':[D1]},feats,32)==[i for i in range(32) if names[i]!='x_route_code']+[32] and WN.feature_cols({'features':'BASE6'},feats,32)==list(range(6)))
    sq={'candidate':'X','kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','params':{'max_depth':6,'eta':0.1},'rounds':64}
    ok=dict(sq,derivedFeatures=[D1,D2]);check('valid derived candidate passes',code(NEW.validate_candidate,ok,names) is None)
    check('pkg refuses derivedFeatures (field unknown there)',code(OLD.validate_candidate,ok,names)=='STOP:CANDIDATE_FIELDS:X')
    for nm,c,want in [('label reference',dict(sq,derivedFeatures=[{'op':'add','args':[col('observed_seats'),k(1)]}]),'CANDIDATE_DERIVED:X:DSL_FORBIDDEN_NAME:D0.ARGS.0'),
                      ('product column',dict(sq,derivedFeatures=[D1,{'op':'neg','args':[col('prod_expected_seats')]}]),'CANDIDATE_DERIVED:X:DSL_FORBIDDEN_NAME:D1.ARGS.0'),
                      ('route under NO_ROUTE',dict(sq,features='NO_ROUTE',derivedFeatures=[{'op':'neg','args':[col('x_route_code')]}]),'CANDIDATE_DERIVED:X:DSL_NAME_NOT_SELECTED:D0.ARGS.0'),
                      ('stop column under BASE6',dict(sq,features='BASE6',derivedFeatures=[{'op':'neg','args':[col('s_fill_rate_score')]}]),'CANDIDATE_DERIVED:X:DSL_NAME_NOT_SELECTED:D0.ARGS.0'),
                      ('outside an explicit list',dict(sq,features=['f_remaining_seats','f_horizon_stops','p_is_full'],derivedFeatures=[D1]),'CANDIDATE_DERIVED:X:DSL_NAME_NOT_SELECTED:D0.ARGS.1.ARGS.0.ARGS.0'),
                      ('empty list',dict(sq,derivedFeatures=[]),'CANDIDATE_DERIVED:X:DSL_COUNT:ROOT'),('seven features',dict(sq,derivedFeatures=[{'op':'add','args':[col('f_remaining_seats'),k(i)]} for i in range(7)]),'CANDIDATE_DERIVED:X:DSL_COUNT:ROOT'),
                      ('duplicate',dict(sq,derivedFeatures=[D1,copy.deepcopy(D1)]),'CANDIDATE_DERIVED:X:DSL_DUPLICATE:D1'),('depth',dict(sq,derivedFeatures=[{'op':'neg','args':[{'op':'neg','args':[{'op':'neg','args':[{'op':'neg','args':[{'op':'neg','args':[col('f_remaining_seats')]}]}]}]}]}]),'CANDIDATE_DERIVED:X:DSL_DEPTH:D0.ARGS.0.ARGS.0.ARGS.0.ARGS.0.ARGS.0'),
                      ('not a list',dict(sq,derivedFeatures={'op':'neg'}),'CANDIDATE_DERIVED:X:DSL_COUNT:ROOT')]:
        got=code(NEW.validate_candidate,c,names);check('derived refusal: %s -> %s'%(nm,want),got=='STOP:'+want and NEW.safe_reason(NEW.Stop(want))==want)
    many={'id':'MANY_DERIVED','hypothesis':'seventeen distinct derived features across three candidates','candidates':[dict(sq,candidate='C%d'%j,derivedFeatures=[{'op':'add','args':[col('f_remaining_seats'),k(6*j+i)]} for i in range(6)]) for j in range(3)]}
    check('more than 16 distinct derived features per experiment refused',code(NEW.validate_experiment,many,names)=='STOP:EXPERIMENT_DERIVED_COUNT')
    many['candidates']=many['candidates'][:2]+[dict(sq,candidate='C2',derivedFeatures=many['candidates'][0]['derivedFeatures'][:4])];check('16 distinct (shared ones counted once) allowed',code(NEW.validate_experiment,many,names) is None)
    e1={'id':'EST_TEST','hypothesis':'budget estimate with derived features','candidates':[sq]};e2={**e1,'candidates':[dict(sq,derivedFeatures=[D1,D2])]}
    check('estimate adds matrix and per-feature seconds only when derived features exist',NEW.estimate_seconds(e2)-NEW.estimate_seconds(e1)==2*NEW.DERIVED_SECONDS and NEW.estimate_seconds(e1)==OLD.estimate_seconds(e1))
    check('estimate tolerates malformed derived input (run.py estimates before validation)',code(NEW.estimate_usd,{'candidates':[dict(sq,derivedFeatures=[5,'x',{'op':'??'}])]}) is None)
    pk=A/'pkg-next/PACKAGE.json'
    if pk.exists():
        p=json.loads(pk.read_bytes());h=hashlib.sha256(pk.read_bytes()).hexdigest()
        check('PACKAGE.json lists dsl.py and verifies',set(p['files'])=={'common.py','worker.py','run.py','dsl.py'} and NEW.verify_package(h)['schema']=='AUTOLOOP_PACKAGE/1')
        check('request template identical to pkg',(A/'pkg-next/REQUEST.template.json').read_bytes()==(A/'pkg/REQUEST.template.json').read_bytes())
        print('INFO pkg-next PACKAGE.json sha256 '+h)
    else:print('INFO pkg-next/PACKAGE.json absent; package checks skipped')
    opened=[];orig=V._pinned
    def spy(p,h):opened.append(str(p));return orig(p,h)
    V._pinned=spy
    X,nm,info=V.train_sample(limit=2,C=NEW);V._pinned=orig
    check('validator sample = TRAIN shard 0 of the first 2 (stride 32), 32 base columns in worker order',info=={'role':'TRAIN','shards':[0],'rows':149725} and nm==D.BASE_FEATURES and X.shape==(149725,32) and str(X.dtype)=='float32')
    check('validator opened only manifests and TRAIN shards',all(p.endswith('dataset.json') or '/dataset/train/' in p for p in opened) and not any('/dev/' in p or 'PREPARATION_014' in p for p in opened) and len(opened)==6)
    rep=V.check(V.candidates_of(json.loads((A/'tests-next/spec-derived.json').read_bytes())),X,nm,NEW)
    check('docker spec derived features pass TRAIN validation',all(r['ok'] for r in rep.values()) and set(rep)=={'DER_SQ','DER_LIN_BLK'})
    rep=V.check(V.candidates_of(json.loads((A/'tests-next/spec-derived-semantic.json').read_bytes())),X,nm,NEW)['DUP']
    check('near-duplicate of a base feature is refused on TRAIN',not rep['ok'] and rep['semantic'][1]['errors']==['SEM_DUPLICATE_BASE'] and rep['semantic'][0]['ok'])
    rep=V.check(V.candidates_of(json.loads((A/'tests-next/spec-derived-invalid.json').read_bytes())),X,nm,NEW)['BAD']
    check('label reference is refused structurally by the validator',not rep['ok'] and rep['structural'][0].startswith('DSL_FORBIDDEN_NAME') and rep['semantic']==[])
    sem=lambda asts:D.semantic_report(X,nm,asts)
    r=sem([{'op':'clip','args':[col('f_remaining_seats')],'lo':5,'hi':5},{'op':'safe_div','args':[col('f_remaining_seats'),{'op':'sub','args':[col('f_horizon_stops'),col('f_horizon_stops')]}]},
           {'op':'where','args':[{'op':'gt','args':[col('f_horizon_stops'),{'op':'const','value':3}]},{'op':'const','value':1},col('x_prev_gap_seconds')]},D1,{'op':'add','args':[D1,{'op':'const','value':1}]},
           {'op':'safe_div','args':[col('x_prev_gap_seconds'),{'op':'where','args':[{'op':'gt','args':[col('f_horizon_stops'),{'op':'const','value':2}]},{'op':'const','value':0},{'op':'const','value':1}]}]}])
    check('constant feature refused',r[0]['errors']==['SEM_CONSTANT'])
    check('all-NaN feature refused',set(r[1]['errors'])=={'SEM_FINITE_SHARE','SEM_CONSTANT'} and r[1]['finiteShare']==0.0)
    check('valid mixed feature passes',r[2]['ok'])
    check('near-duplicate of an earlier derived feature refused',r[4]['errors']==['SEM_DUPLICATE_DERIVED'] and r[3]['ok'])
    check('mostly-NaN feature refused (finite share < 0.5)',('SEM_FINITE_SHARE' in r[5]['errors'])==(r[5]['finiteShare']<0.5))
    check('semantic report is JSON-safe',NEW.canonical(r) is not None)
    print('ALL_PASS %d checks'%N[0])
if __name__=='__main__':main()
