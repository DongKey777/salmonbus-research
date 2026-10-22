"""Local Java 21 parity tests for the DSL emitter: emitted source shape and determinism, then compile-and-run with the local JDK against
golden vectors (per-op, the docker spec features and random ASTs) and against random edge-case rows; exact float32 equality except at most
1 ulp for log1p/sqrt. Also checks pod-produced Java and golden vectors when tests-next/derived-artifacts exists. Not run in the pod."""
import hashlib,importlib.util,json,math,types
from pathlib import Path
A=Path(__file__).resolve().parents[1]
def mod(n,p):m=types.ModuleType(n);m.__file__=str(p);exec(compile(Path(p).read_bytes(),str(p),'exec'),m.__dict__);return m
J=mod('java_parity',A/'features/java_parity.py');D=J.D
spec=importlib.util.spec_from_file_location('tfd',A/'tests/test_features_dsl.py');T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T)
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
def info(tag,r):
    f=r['features'].values();print('INFO %s: %d features, %d rows, ulp rows %d, max ulp %d, %s'%(tag,len(f),sum(x['rows'] for x in f),sum(x['ulpRows'] for x in f),max([x['maxUlp'] for x in f],default=0),r.get('jdk')))
def main():
    j=J.jdk();check('local JDK 21 available',j is not None and j['major']>=21)
    src=D.java_class([T.D1,T.D2])
    check('emitted class is deterministic and named by hashes',src==D.java_class([T.D1,T.D2]) and 'public static float d_de0abc8760(' in src and 'public static float d_9369d873c7(' in src and 'FEATURE_NAMES = List.of("d_de0abc8760", "d_9369d873c7")' in src)
    check('emitted expression pinned for D1',D.java_expr(D.canon(T.D1))=='sub(fRemainingSeats, mul(clip(sNetBoardingSegmentScore, -5.0, 5.0), 2.0))' and 'return toFeature(sub(fRemainingSeats, mul(clip(sNetBoardingSegmentScore, -5.0, 5.0), 2.0)));' in src)
    check('emitted Javadoc carries the canonical AST',('{@code %s}'%D.dump(D.canon(T.D1))) in src)
    check('parameters are unique camelCase names for all 32 base features',len({D.java_param(f) for f in D.BASE_FEATURES})==32 and D.java_param('p_crowd_1')=='pCrowd1' and D.java_param('x_prev_gap_seconds')=='xPrevGapSeconds')
    check('duplicates collapse and order follows the candidate',D.java_class([T.D2,T.D1,T.D2]).index('d_9369d873c7(')<D.java_class([T.D2,T.D1]).index('d_de0abc8760(') and D.java_class([T.D2,T.D1,T.D2])==D.java_class([T.D2,T.D1]))
    check('java_sha is sha256 of the source',D.java_sha([T.D1,T.D2])==hashlib.sha256(src.encode()).hexdigest())
    r=J.prove(list(T.EXAMPLES.values()));info('per-op',r)
    check('javac -Xlint:all is clean',r.get('javacWarnings')=='')
    check('Java == golden vectors for every op',r['ok'] and len(r['features'])==len(T.EXAMPLES))
    r=J.prove([T.D1,T.D2]);info('docker spec features',r)
    check('Java == golden vectors for D1, D2',r['ok'] and r['javaSourceSha256']==D.java_sha([T.D1,T.D2]))
    asts=T.rand_asts(4242,240,T.NAMES);res=[J.prove(asts[i:i+60]) for i in range(0,len(asts),60)]
    for x in res:info('random ASTs',x)
    check('Java == golden vectors for 240 random ASTs',all(x['ok'] for x in res))
    rows=T.rand_rows(99,400,T.NAMES);vecs={}
    for a in asts[:120]:
        c=D.canon(a);ins=D.inputs(c);v={'name':D.name(c),'canonical':c,'inputs':ins,'maxUlpFloat32':1 if D.ops(c)&D.ULP_OPS else 0,'rows':[],'expected':[]}
        for rw in rows:v['rows'].append([None if rw[n]!=rw[n] else rw[n] for n in ins]);e=D.ref_eval(c,rw);v['expected'].append(None if e!=e else e)
        vecs[v['name']]=v
    res=[J.prove(asts[i:i+60],vecs) for i in (0,60)]
    for x in res:info('random rows',x)
    check('Java == reference on 120 random ASTs x 400 random edge-case rows',all(x['ok'] for x in res))
    bad=json.loads(D.parity_bytes(D.parity_vector(T.D1)));i=next(k for k,e in enumerate(bad['expected']) if e not in (None,0.0));bad['expected'][i]=D._unord(D._ord(bad['expected'][i])+1)
    check('Java parity detects a 1-ulp tampered expectation on an exact feature',not J.prove([T.D1],{D.name(T.D1):bad})['ok'])
    art=A/'tests-next/derived-artifacts'
    if art.is_dir():
        for p in sorted(art.glob('*.derived.java')):
            spec_=json.loads((art/'spec-derived.json').read_bytes());cand=next(c for c in spec_['candidates'] if c['candidate']==p.name.split('.')[0])
            check('pod Java source %s == local emission'%p.name,p.read_text()==D.java_class(cand['derivedFeatures']))
        vecs={}
        for p in sorted(art.glob('derived-*.parity.json')):
            v=json.loads(p.read_bytes());check('pod golden vector %s == local generation'%p.name,p.read_bytes()==D.parity_bytes(D.parity_vector(v['canonical'])));vecs[v['name']]=v
        r=J.prove([v['canonical'] for v in vecs.values()],vecs);info('pod artifacts',r)
        check('Java == pod golden vectors',r['ok'] and len(vecs)==2)
    else:print('INFO tests-next/derived-artifacts absent; pod artifact checks skipped')
    print('ALL_PASS %d checks'%N[0])
if __name__=='__main__':main()
