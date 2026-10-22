"""Unit tests for features/dsl.py: structural rules and limits, forbidden names, canonical form and hash stability, NaN semantics, golden
parity vectors and the reference interpreter vs numpy compiler round trip on random ASTs and edge-case rows."""
import json,math,random,types
from pathlib import Path
A=Path(__file__).resolve().parents[1]
D=types.ModuleType('features_dsl');D.__file__=str(A/'features/dsl.py');exec(compile((A/'features/dsl.py').read_bytes(),D.__file__,'exec'),D.__dict__)
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
col=lambda n:{'op':'col','name':n};k=lambda v:{'op':'const','value':v};op=lambda o,*a,**kw:{'op':o,'args':list(a),**kw}
F='f_remaining_seats';H='f_horizon_stops';G='x_prev_gap_seconds';S='s_fill_rate_score'
D1=op('sub',col(F),op('mul',op('clip',col('s_net_boarding_segment_score'),lo=-5,hi=5),k(2)))
D2=op('bucketize',op('log1p',op('fillna',col(G),value=0)),edges=[3,4,5,6,7])
EXAMPLES={'add':op('add',col(F),k(1)),'sub':op('sub',col(F),col(H)),'mul':op('mul',col(F),col(S)),'safe_div':op('safe_div',col(F),col(H)),'neg':op('neg',col(S)),'abs':op('abs',col(S)),
 'min':op('min',col(F),col(H)),'max':op('max',col(F),k(3)),'clip':op('clip',col(S),lo=-1,hi=1),'log1p':op('log1p',col(G)),'sqrt':op('sqrt',col(H)),'square':op('square',col(S)),
 'gt':op('gt',col(F),k(5)),'ge':op('ge',col(F),col(H)),'lt':op('lt',col(S),k(0)),'le':op('le',col(F),k(0)),'eq':op('eq',col(F),k(0)),'where':op('where',col('p_is_full'),col(H),col(S)),
 'isnan':op('isnan',col(G)),'fillna':op('fillna',col(G),value=-1),'bucketize':op('bucketize',col(F),edges=[0,1,5,10,20])}
def balanced(n):
    if n==1:return col(F)
    return op('add',balanced(n//2),balanced(n-n//2))
def chain(d):
    x=col(F)
    for _ in range(d-1):x=op('neg',x)
    return x
def codes(errs):return [e.split()[0] for e in errs]
INNER=[o for o in D.SIG if o not in ('col','const')]
def rand_ast(rng,names,d=1):
    if d>=5 or (d>1 and rng.random()<0.3):
        return col(rng.choice(names)) if rng.random()<0.7 else k(rng.choice([0,1,-1,0.5,2,3,1e-9,2e-9,10,1e6,-1e6,-3.5,round(rng.uniform(-100,100),3)]))
    o=rng.choice(INNER);ar=D.SIG[o][0];n={'op':o,'args':[rand_ast(rng,names,d+1) for _ in range(ar)]}
    if o=='clip':lo=round(rng.uniform(-20,20),2);n.update(lo=lo,hi=lo+rng.choice([0,0.5,1,10]))
    if o=='fillna':n['value']=rng.choice([0,-1,1e6,7.25])
    if o=='bucketize':n['edges']=sorted(set(round(rng.uniform(-50,50),1) for _ in range(rng.randint(1,16))))
    return n
def rand_asts(seed,count,names):
    rng=random.Random(seed);out=[]
    while len(out)<count:
        a=rand_ast(rng,names)
        if not D.validate(a):out.append(a)
    return out
NAMES=[F,H,'p_seat_slope',G,S,'x_capacity']
SPECIALS=[math.nan,0.0,-0.0,1e-9,-1e-9,5e-10,2e-9,1.0,-1.0,0.5,3.0,10.0,1e6,-1e6,3e38,-3e38,100.0,-3.5]
def rand_rows(seed,count,names):
    rng=random.Random(seed)
    return [{n:D._r32(rng.choice(SPECIALS) if rng.random()<0.4 else rng.choice([rng.uniform(-100,100),float(rng.randint(0,70))])) for n in names} for _ in range(count)]
def main():
    import numpy as np
    for o,a in EXAMPLES.items():check('valid op '+o,D.validate(a)==[])
    check('every op has an example',set(EXAMPLES)==set(INNER))
    for nm,a,code in [('unknown op',{'op':'pow','args':[col(F),k(2)]},'DSL_UNKNOWN_OP'),('missing op',{'args':[col(F)]},'DSL_UNKNOWN_OP'),('non-string op',{'op':3},'DSL_UNKNOWN_OP'),
                      ('extra field',{**op('neg',col(F)),'note':'x'},'DSL_FIELDS'),('missing args',{'op':'neg'},'DSL_FIELDS'),('col with args',{'op':'col','name':F,'args':[]},'DSL_FIELDS'),
                      ('arity 1 for add',op('add',col(F)),'DSL_ARITY'),('arity 2 for where',op('where',col(F),col(H)),'DSL_ARITY'),('args not a list',{'op':'neg','args':col(F)},'DSL_ARITY'),
                      ('bare number arg',op('add',col(F),5),'DSL_NODE_TYPE'),('bool constant',k(True),'DSL_CONST'),('string constant',op('add',col(F),k('1')),'DSL_CONST'),
                      ('nan constant',op('add',col(F),k(math.nan)),'DSL_CONST'),('inf constant',op('add',col(F),k(math.inf)),'DSL_CONST'),('constant over 1e6',op('add',col(F),k(1e6+1)),'DSL_CONST_RANGE'),
                      ('negative constant over 1e6',op('mul',col(F),k(-2e6)),'DSL_CONST_RANGE'),('clip lo>hi',op('clip',col(F),lo=2,hi=1),'DSL_CLIP_BOUNDS'),('clip bound range',op('clip',col(F),lo=0,hi=1e7),'DSL_CONST_RANGE'),
                      ('fillna bad value',op('fillna',col(G),value=None),'DSL_CONST'),('edges empty',op('bucketize',col(F),edges=[]),'DSL_EDGES'),('edges unsorted',op('bucketize',col(F),edges=[2,1]),'DSL_EDGES'),
                      ('edges duplicate',op('bucketize',col(F),edges=[1,1.0]),'DSL_EDGES'),('17 edges',op('bucketize',col(F),edges=list(range(17))),'DSL_EDGES'),('edge out of range',op('bucketize',col(F),edges=[0,2e6]),'DSL_EDGES'),
                      ('edges not numbers',op('bucketize',col(F),edges=['a']),'DSL_EDGES'),('depth 6',chain(6),'DSL_DEPTH'),('26+ nodes',balanced(14),'DSL_NODES'),('no column',op('add',k(1),k(2)),'DSL_NO_COLUMN'),
                      ('unknown name',col('foo'),'DSL_UNKNOWN_NAME'),('case-changed name',col('F_REMAINING_SEATS'),'DSL_UNKNOWN_NAME'),('derived reference',col('d_0123456789'),'DSL_DERIVED_REFERENCE'),
                      ('name not a string',{'op':'col','name':3},'DSL_NAME_TYPE'),('node not an object',[col(F)],'DSL_NODE_TYPE')]:
        check('invalid: %s -> %s'%(nm,code),code in codes(D.validate(a)))
    check('depth 5 is allowed',D.validate(chain(5))==[] and D.depth(chain(5))==5)
    check('25 nodes within depth 5 is allowed',D.nodes(balanced(13))==25 and D.depth(balanced(13))==5 and D.validate(balanced(13))==[])
    check('constant 1e6 is allowed',D.validate(op('add',col(F),k(-1e6)))==[] and D.validate(op('bucketize',col(F),edges=list(range(16))))==[])
    deep=col(F)
    for _ in range(3000):deep=op('neg',deep)
    check('3000-deep input is refused without recursion error',codes(D.validate(deep))==['DSL_DEPTH'])
    for nm in ['observed_seats','weight_numerator','weight_denominator','sample_id','arrival_group_id','split','service_day','kst_hour','prod_expected_seats','prod_full_chance','prod_full_chance_raw','prod_present','s_stats_revision','s_stats_cells','label','weight']:
        check('forbidden name '+nm,codes(D.validate(op('add',col(nm),k(1))))==['DSL_FORBIDDEN_NAME'])
    check('all 32 base features are allowed',all(D.validate(op('neg',col(n)))==[] for n in D.BASE_FEATURES) and len(D.BASE_FEATURES)==32==len(set(D.BASE_FEATURES)))
    check('names outside the selected set are refused',codes(D.validate(op('add',col('x_route_code'),k(1)),[n for n in D.BASE_FEATURES if n!='x_route_code']))==['DSL_NAME_NOT_SELECTED'])
    check('allowed set cannot widen the whitelist',codes(D.validate(col('observed_seats'),D.BASE_FEATURES+['observed_seats']))==['DSL_FORBIDDEN_NAME'])
    check('list: empty and over 6 refused',D.validate_list([])==['DSL_COUNT $'] and D.validate_list([EXAMPLES[o] for o in INNER[:7]])==['DSL_COUNT $'] and D.validate_list({'op':'neg'})==['DSL_COUNT $'])
    check('list: 6 distinct allowed',D.validate_list([EXAMPLES[o] for o in INNER[:6]])==[])
    check('list: commutative duplicate refused',codes(D.validate_list([op('add',col(F),col(H)),op('add',col(H),col(F))]))==['DSL_DUPLICATE'])
    check('list: errors carry the index',D.validate_list([EXAMPLES['add'],col('observed_seats')])[0].startswith('DSL_FORBIDDEN_NAME d1'))
    check('hash pinned for D1',D.name(D1)=='d_de0abc8760')
    check('hash pinned for D2',D.name(D2)=='d_9369d873c7')
    check('canonical JSON pinned for D1',D.dump(D.canon(D1))=='{"args":[{"name":"f_remaining_seats","op":"col"},{"args":[{"args":[{"name":"s_net_boarding_segment_score","op":"col"}],"hi":5.0,"lo":-5.0,"op":"clip"},{"op":"const","value":2.0}],"op":"mul"}],"op":"sub"}')
    check('hash ignores commutative order, int vs float, key order and -0.0',D.name(op('mul',k(2.0),op('clip',col('s_net_boarding_segment_score'),hi=5.0,lo=-5.0)))==D.name(op('mul',op('clip',col('s_net_boarding_segment_score'),lo=-5,hi=5),k(2)))
          and D.name(op('add',col(F),k(-0.0)))==D.name(op('add',k(0),col(F))))
    check('hash keeps non-commutative order',D.name(op('sub',col(F),col(H)))!=D.name(op('sub',col(H),col(F))) and D.name(op('safe_div',col(F),col(H)))!=D.name(op('safe_div',col(H),col(F))))
    check('canonical form is idempotent',all(D.canon(D.canon(a))==D.canon(a) for a in list(EXAMPLES.values())+[D1,D2]))
    check('complexity, inputs, depth',D.complexity(D1)==D.nodes(D1)+D.depth(D1)+2 and D.inputs(D1)==['f_remaining_seats','s_net_boarding_segment_score'] and D.depth(D1)==4)
    nan=math.nan;inf32=3e38
    def ev(a,**row):
        r=D.ref_eval(a,row);X=np.array([[row.get(n,nan) for n in D.inputs(a)]],np.float32);g=float(D.compile_numpy(a,D.inputs(a))(X)[0])
        assert (r!=r and g!=g) or r==g,(a,row,r,g);return r
    isn=lambda v:v!=v
    T=[('safe_div by 0 is NaN',isn(ev(op('safe_div',col(F),col(H)),**{F:1,H:0}))),('safe_div by float32(1e-9) < eps is NaN',isn(ev(op('safe_div',col(F),col(H)),**{F:1,H:1e-9}))),
       ('safe_div by 2e-9 is defined',ev(op('safe_div',col(F),col(H)),**{F:1,H:2e-9})==D._r32(1/D._r32(2e-9))),('safe_div by const 1e-9 is defined (strict <)',ev(op('safe_div',col(F),k(1e-9)),**{F:1})==D._r32(1e9)),
       ('safe_div by NaN is NaN',isn(ev(op('safe_div',col(F),col(G)),**{F:1}))),('safe_div of NaN is NaN',isn(ev(op('safe_div',col(G),col(F)),**{F:1}))),
       ('log1p of negative is NaN',isn(ev(op('log1p',col(S)),**{S:-1}))),('log1p of -0 is +0',math.copysign(1,ev(op('log1p',col(S)),**{S:-0.0}))==1),('log1p of NaN is NaN',isn(ev(op('log1p',col(G))))),
       ('sqrt of negative is NaN',isn(ev(op('sqrt',col(S)),**{S:-4}))),('sqrt of 4',ev(op('sqrt',col(S)),**{S:4})==2),
       ('gt with NaN is 0',ev(op('gt',col(G),k(1)))==0),('lt with NaN is 0',ev(op('lt',col(G),k(1)))==0),('eq NaN NaN is 0',ev(op('eq',col(G),col('x_capacity')),x_capacity=nan)==0),
       ('ge equal is 1',ev(op('ge',col(F),k(1)),**{F:1})==1),('le false is 0',ev(op('le',col(F),k(1)),**{F:2})==0),
       ('where NaN takes else',ev(op('where',col(G),k(1),k(2)))==2),('where 0 takes else',ev(op('where',col(F),k(1),k(2)),**{F:0})==2),('where -0 takes else',ev(op('where',col(F),k(1),k(2)),**{F:-0.0})==2),
       ('where nonzero takes then',ev(op('where',col(F),k(1),k(2)),**{F:3})==1),('isnan',ev(op('isnan',col(G)))==1 and ev(op('isnan',col(G)),**{G:0})==0),
       ('fillna replaces NaN only',ev(op('fillna',col(G),value=7))==7 and ev(op('fillna',col(G),value=7),**{G:3})==3),
       ('bucketize NaN is NaN',isn(ev(op('bucketize',col(G),edges=[1,2])))),('bucketize edge goes up',ev(op('bucketize',col(F),edges=[1,2]),**{F:1})==1 and ev(op('bucketize',col(F),edges=[1,2]),**{F:2})==2),
       ('bucketize below first edge',ev(op('bucketize',col(F),edges=[1,2]),**{F:0.99})==0),('bucketize float32 vs double edge',ev(op('bucketize',col(F),edges=[0.1]),**{F:0.1})==1),
       ('bucketize of overflowed value',ev(op('bucketize',op('mul',col(F),col(F)),edges=[1,2]),**{F:inf32})==2),
       ('min/max/clip/abs propagate NaN',all(isn(ev(a)) for a in (op('min',col(G),k(1)),op('max',k(1),col(G)),op('clip',col(G),lo=0,hi=1),op('abs',col(G)),op('neg',col(G)),op('square',col(G)),op('add',col(G),k(1))))),
       ('clip bounds',ev(op('clip',col(F),lo=0,hi=1),**{F:5})==1 and ev(op('clip',col(F),lo=0,hi=1),**{F:-5})==0),
       ('float32 overflow becomes NaN',isn(ev(op('mul',col(F),col(F)),**{F:inf32})) and isn(ev(op('add',col(F),col(F)),**{F:inf32})) and isn(ev(op('square',col(F)),**{F:inf32}))),
       ('double overflow becomes NaN',isn(ev(op('square',op('square',op('square',op('square',col(F))))),**{F:inf32}))),
       ('zero is +0',all(math.copysign(1,ev(a,**{F:0.0,H:1}))==1 for a in (op('neg',col(F)),op('mul',k(-1),col(F)),op('min',col(F),op('neg',col(F))),op('safe_div',col(F),op('neg',col(H)))))),
       ('result is float32 of the float64 value',ev(op('add',col(F),col(H)),**{F:D._r32(0.1),H:D._r32(0.2)})==D._r32(D._r32(0.1)+D._r32(0.2)))]
    for nm,ok in T:check('semantics: '+nm,ok)
    asts=rand_asts(20261022,400,NAMES);rows=rand_rows(7,600,NAMES);X=np.array([[r[n] for n in NAMES] for r in rows],np.float32);worst=0;nanrows=0;bad=0
    for a in asts:
        got=D.compile_numpy(a,NAMES)(X);tol=1 if D.ops(a)&D.ULP_OPS else 0
        for g,r in zip(got.tolist(),rows):
            e=D.ref_eval(a,r)
            if (g!=g)!=(e!=e):bad+=1;continue
            if e!=e:nanrows+=1;continue
            u=D.ulp(D._r32(g),e);worst=max(worst,u);bad+=u>tol
    print('INFO reference vs numpy: %d ASTs x %d rows, NaN outputs %d, max ulp %d'%(len(asts),len(rows),nanrows,worst))
    check('reference interpreter == numpy compiler on 400 random ASTs x 600 rows incl NaN',bad==0)
    check('numpy output is float32 1-D and chunking does not change it',all(D.compile_numpy(a,NAMES)(X).dtype==np.float32 and np.array_equal(D.compile_numpy(a,NAMES)(X,chunk=7),D.compile_numpy(a,NAMES)(X),equal_nan=True) for a in asts[:20]))
    v1=D.parity_vector(D1);v2=D.parity_vector(D2)
    check('parity vector deterministic',D.parity_bytes(D.parity_vector(D1))==D.parity_bytes(v1))
    check('parity vector sha pinned for D1',D.parity_sha(v1)==PINNED_D1_PARITY)
    check('parity vector >= 64 rows with NaN inputs and NaN outputs',all(len(v['rows'])>=64 and any(None in r for r in v['rows']) for v in (v1,v2)) and None in D.parity_vector(EXAMPLES['safe_div'])['expected'])
    vs=D.parity_vector(EXAMPLES['safe_div']);hi=vs['inputs'].index(H)
    check('parity vector has zero denominators',any(r[hi]==0 for r in vs['rows']) and all(e is None for r,e in zip(vs['rows'],vs['expected']) if r[hi]==0))
    vc=D.parity_vector(EXAMPLES['clip']);vals={r[0] for r in vc['rows'] if r[0] is not None}
    check('parity vector covers clip bounds and their float32 neighbours',{-1.0,1.0,D._unord(D._ord(1.0)+1),D._unord(D._ord(1.0)-1),D._unord(D._ord(-1.0)-1)}<=vals)
    vb=D.parity_vector(EXAMPLES['bucketize']);vals={r[0]:e for r,e in zip(vb['rows'],vb['expected']) if r[0] is not None}
    check('parity vector covers bucket edges with upper-bucket rule',all(vals.get(float(e))==i+1 for i,e in enumerate([0,1,5,10,20])) and vals.get(D._unord(D._ord(5.0)-1))==2)
    check('parity vector covers extreme values',all(any(r[0] is not None and abs(r[0])>=1e38 for r in v['rows']) for v in (v1,vb)))
    check('parity vector tolerance: 0 exact, 1 ulp only for log1p/sqrt',v1['maxUlpFloat32']==0 and v2['maxUlpFloat32']==1 and D.parity_vector(EXAMPLES['sqrt'])['maxUlpFloat32']==1)
    pv=[D.parity_numpy(a,D.parity_vector(a)) for a in asts[:150]+list(EXAMPLES.values())+[D1,D2]]
    check('numpy compiler matches golden vectors (150 random + per-op + D1, D2)',all(p['ok'] for p in pv))
    print('INFO numpy vs golden: %d vectors, rows %d, ulp rows %d, max ulp %d'%(len(pv),sum(p['rows'] for p in pv),sum(p['ulpRows'] for p in pv),max(p['maxUlp'] for p in pv)))
    t=json.loads(D.parity_bytes(v1));i=next(j for j,e in enumerate(t['expected']) if e not in (None,0.0));t['expected'][i]=D._unord(D._ord(t['expected'][i])+1)
    check('tampered golden vector is detected',not D.parity_numpy(D1,t)['ok'] and D.parity_numpy(D2,v1)['reason']=='PARITY_IDENTITY')
    print('ALL_PASS %d checks'%N[0])
PINNED_D1_PARITY='516c9b416d0448e42689ff699e6e5e3eaac29f1c40821c36323fc9480c09a828'
if __name__=='__main__':main()
