"""Feature DSL v1 of the autonomous loop: a typed JSON AST over the 32 production as-of base features and numeric constants.
The canonical AST is the single source of truth. From it come the stable name d_<sha256(canonical)[:10]>, a vectorised numpy compiler
(research compute), a pure-Python reference interpreter (the semantics), golden parity vectors (reference outputs on deterministic edge-case
rows), a Java 21 emitter (one pure static method per feature, named by the hash, in one generated class) and the TRAIN-only semantic checks.
Point-in-time and serviceability: every input is one of the 32 base features of the same row, each replicating a production rule computed as
of the forecast time. An expression is a pure, row-local, stateless function of those values and literal constants: no cross-row aggregation,
no fitted statistic, and no label, weight, id, time key, split, product or other column can be named. Its value is therefore known at forecast
time from the same inputs, and the service computes it with the emitted Java, whose parity is proved against the golden vectors.
Semantics: inputs are float32 widened to float64, evaluation is float64, the result is rounded to float32, non-finite becomes NaN, zero is +0.
add/sub/mul/neg/abs/square/min/max/clip propagate NaN; safe_div is NaN when the denominator is NaN or |den| < 1e-9; log1p and sqrt are NaN for
negative input; gt/ge/lt/le/eq are 1 or 0, and 0 when either side is NaN; where(c,a,b) is a when c is neither 0 nor NaN, else b; isnan is 1 or 0;
fillna(x,c) replaces NaN by c; bucketize(x,edges) is the number of edges <= x (a value equal to an edge goes to the upper bucket), NaN for NaN."""
import hashlib,json,math,random,struct
VERSION=1
BASE_FEATURES=['f_remaining_seats','f_horizon_stops','f_time_of_day_sin','f_time_of_day_cos','f_weekday_sin','f_weekday_cos','p_is_morning','p_is_evening',
 'p_seats_left_ratio','p_is_full','p_low_seat_band','p_crowd_1','p_crowd_2','p_crowd_3','p_crowd_4','p_maximum_seats_ratio','p_seat_slope','p_seat_slope_missing',
 'p_full_seat_streak','p_prev_is_full','p_prev_seats_ratio','p_prev_missing','p_stop_position','p_direction_down','x_route_code','x_capacity','x_crowd_known',
 'x_prev_gap_seconds','x_source_position','s_fill_rate_score','s_net_boarding_segment_score','s_filled_by_neighbours']
LIMITS={'maxDepth':5,'maxNodes':25,'maxAbsConst':1e6,'maxEdges':16,'maxPerCandidate':6}
EPS=1e-9
SEMANTIC={'minFiniteShare':0.5,'maxAbsCorr':0.99,'minPairRows':100,'sampleShardStride':32}
FORBIDDEN={'observed_seats','weight_numerator','weight_denominator','sample_id','arrival_group_id','split','service_day','kst_hour','label','weight','target'}
FORBIDDEN_PREFIX=('prod_','s_stats_','weight','label','observed','sample','arrival_group','split','service_day')
BINARY=('add','sub','mul','safe_div','min','max','gt','ge','lt','le','eq')
SIG={'col':(0,('name',)),'const':(0,('value',)),'neg':(1,()),'abs':(1,()),'log1p':(1,()),'sqrt':(1,()),'square':(1,()),'isnan':(1,()),
     'clip':(1,('lo','hi')),'fillna':(1,('value',)),'bucketize':(1,('edges',)),'where':(3,()),**{k:(2,()) for k in BINARY}}
COMMUTATIVE={'add','mul','min','max','eq'}
ULP_OPS={'log1p','sqrt'}
NAN=math.nan
GRAMMAR={'dslVersion':VERSION,'node':'JSON object with "op"; leaves {"op":"col","name":<base feature>} and {"op":"const","value":<number>}; other ops take "args":[...]',
 'ops':{'add|sub|mul|min|max':'args [a,b]','safe_div':'args [a,b]; NaN when |b|<1e-9 or NaN','neg|abs|square':'args [x]','log1p|sqrt':'args [x]; NaN when x<0',
        'gt|ge|lt|le|eq':'args [a,b]; 1/0, 0 when either is NaN','where':'args [cond,a,b]; a when cond is neither 0 nor NaN','isnan':'args [x]; 1/0',
        'fillna':'args [x], "value": c','clip':'args [x], "lo": c, "hi": c with lo<=hi','bucketize':'args [x], "edges": strictly increasing constants (1..16); count of edges <= x'},
 'limits':LIMITS,'names':'only the 32 base features; derived features are appended to the candidate feature set and may use only its selected base features'}
def dump(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)
def _num(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def validate(ast,allowed=None):
    allowed=set(BASE_FEATURES) if allowed is None else set(allowed)&set(BASE_FEATURES);errs=[];st=[0,0]
    def const(v,p):
        if not _num(v):errs.append('DSL_CONST '+p)
        elif abs(v)>LIMITS['maxAbsConst']:errs.append('DSL_CONST_RANGE '+p)
    def walk(n,p,d):
        st[0]+=1
        if st[0]>LIMITS['maxNodes']:
            if st[0]==LIMITS['maxNodes']+1:errs.append('DSL_NODES '+p)
            return
        if d>LIMITS['maxDepth']:errs.append('DSL_DEPTH '+p);return
        if type(n) is not dict:errs.append('DSL_NODE_TYPE '+p);return
        op=n.get('op')
        if not isinstance(op,str) or op not in SIG:errs.append('DSL_UNKNOWN_OP '+p);return
        k,fields=SIG[op]
        if set(n)!={'op',*fields,*(('args',) if k else ())}:errs.append('DSL_FIELDS '+p);return
        if op=='col':
            v=n['name']
            if not isinstance(v,str):errs.append('DSL_NAME_TYPE '+p)
            elif v in allowed:st[1]+=1
            elif v in BASE_FEATURES:errs.append('DSL_NAME_NOT_SELECTED %s %s'%(p,v))
            elif v.startswith('d_'):errs.append('DSL_DERIVED_REFERENCE '+p)
            elif v in FORBIDDEN or v.startswith(FORBIDDEN_PREFIX):errs.append('DSL_FORBIDDEN_NAME %s %s'%(p,v[:40]))
            else:errs.append('DSL_UNKNOWN_NAME %s %r'%(p,v[:40]))
            return
        if op=='const':return const(n['value'],p)
        if op=='clip':
            const(n['lo'],p+'.lo');const(n['hi'],p+'.hi')
            if _num(n['lo']) and _num(n['hi']) and n['lo']>n['hi']:errs.append('DSL_CLIP_BOUNDS '+p)
        if op=='fillna':const(n['value'],p+'.value')
        if op=='bucketize':
            e=n['edges']
            if not (isinstance(e,list) and 1<=len(e)<=LIMITS['maxEdges'] and all(_num(x) and abs(x)<=LIMITS['maxAbsConst'] for x in e) and all(float(a)<float(b) for a,b in zip(e,e[1:]))):errs.append('DSL_EDGES '+p)
        a=n['args']
        if not isinstance(a,list) or len(a)!=k:errs.append('DSL_ARITY '+p);return
        for i,x in enumerate(a):walk(x,'%s.args.%d'%(p,i),d+1)
    walk(ast,'$',1)
    if not errs and st[1]==0:errs.append('DSL_NO_COLUMN $')
    return errs
def validate_list(asts,allowed=None):
    if not isinstance(asts,list) or not 1<=len(asts)<=LIMITS['maxPerCandidate']:return ['DSL_COUNT $']
    errs=[];seen=set()
    for i,a in enumerate(asts):
        e=validate(a,allowed);errs+=[x.replace('$','d%d'%i,1) for x in e]
        if not e:
            nm=name(a)
            if nm in seen:errs.append('DSL_DUPLICATE d%d'%i)
            seen.add(nm)
    return errs
def canon(n):
    op=n['op']
    if op=='col':return {'op':'col','name':n['name']}
    if op=='const':return {'op':'const','value':float(n['value'])+0.0}
    c={'op':op,'args':[canon(x) for x in n['args']]}
    if op in COMMUTATIVE:c['args'].sort(key=dump)
    for f in SIG[op][1]:c[f]=[float(x)+0.0 for x in n[f]] if f=='edges' else float(n[f])+0.0
    return c
def name(n):return 'd_'+hashlib.sha256(dump(canon(n)).encode()).hexdigest()[:10]
def _nodes(n):
    yield n
    for x in n.get('args',()):yield from _nodes(x)
def inputs(n):return sorted({x['name'] for x in _nodes(n) if x['op']=='col'})
def depth(n):return 1+max([depth(x) for x in n.get('args',())],default=0)
def nodes(n):return sum(1 for _ in _nodes(n))
def ops(n):return {x['op'] for x in _nodes(n)}
def complexity(n):return nodes(n)+depth(n)+len(inputs(n))
def _consts(n):
    for x in _nodes(n):
        for f in ('value','lo','hi'):
            if f in x:yield float(x[f])
        yield from (float(e) for e in x.get('edges',()))
def _r32(v):
    if v!=v:return NAN
    try:return struct.unpack('<f',struct.pack('<f',v))[0]
    except OverflowError:return math.copysign(math.inf,v)
def _out(v):
    f=_r32(v) if math.isfinite(v) else NAN
    return f+0.0 if math.isfinite(f) else NAN
def _bits(f):return struct.unpack('<I',struct.pack('<f',f))[0]
def _ord(f):b=_bits(f);return b if b<0x80000000 else 0x80000000-b
def _unord(o):return struct.unpack('<f',struct.pack('<I',o if o>=0 else 0x80000000-o))[0]
def ulp(a,b):return abs(_ord(a)-_ord(b))
REF={'add':lambda a,b:a+b,'sub':lambda a,b:a-b,'mul':lambda a,b:a*b,'safe_div':lambda a,b:NAN if b!=b or abs(b)<EPS else a/b,
     'neg':lambda x:-x,'abs':abs,'square':lambda x:x*x,'min':lambda a,b:NAN if a!=a or b!=b else min(a,b),'max':lambda a,b:NAN if a!=a or b!=b else max(a,b),
     'log1p':lambda x:NAN if x!=x or x<0 else math.log1p(x),'sqrt':lambda x:NAN if x!=x or x<0 else math.sqrt(x),
     'gt':lambda a,b:1.0 if a>b else 0.0,'ge':lambda a,b:1.0 if a>=b else 0.0,'lt':lambda a,b:1.0 if a<b else 0.0,'le':lambda a,b:1.0 if a<=b else 0.0,'eq':lambda a,b:1.0 if a==b else 0.0,
     'where':lambda c,a,b:a if c==c and c!=0 else b,'isnan':lambda x:1.0 if x!=x else 0.0}
def _ref(n,row):
    op=n['op']
    if op=='col':v=row.get(n['name']);return NAN if v is None else _r32(float(v))
    if op=='const':return float(n['value'])
    a=[_ref(x,row) for x in n['args']];x=a[0]
    if op=='clip':return NAN if x!=x else min(float(n['hi']),max(float(n['lo']),x))
    if op=='fillna':return float(n['value']) if x!=x else x
    if op=='bucketize':return NAN if x!=x else float(sum(1 for e in n['edges'] if x>=float(e)))
    return REF[op](*a)
def ref_eval(ast,row):return _out(_ref(ast,row))
def compile_numpy(ast,names):
    import numpy as np
    node=canon(ast);idx={k:i for i,k in enumerate(names)};miss=[k for k in inputs(node) if k not in idx]
    if miss:raise KeyError('DSL_INPUT_MISSING')
    cmp={'gt':np.greater,'ge':np.greater_equal,'lt':np.less,'le':np.less_equal,'eq':np.equal}
    def ev(n,X):
        op=n['op']
        if op=='col':return X[:,idx[n['name']]].astype(np.float64)
        if op=='const':return np.full(len(X),n['value'])
        a=[ev(x,X) for x in n['args']];x=a[0]
        if op=='add':return a[0]+a[1]
        if op=='sub':return a[0]-a[1]
        if op=='mul':return a[0]*a[1]
        if op=='safe_div':bad=np.isnan(a[1])|(np.abs(a[1])<EPS);return np.where(bad,np.nan,a[0]/np.where(bad,1.0,a[1]))
        if op=='neg':return -x
        if op=='abs':return np.abs(x)
        if op=='square':return x*x
        if op=='min':return np.minimum(a[0],a[1])
        if op=='max':return np.maximum(a[0],a[1])
        if op=='clip':return np.minimum(n['hi'],np.maximum(n['lo'],x))
        if op in ('log1p','sqrt'):neg=x<0;r=(np.log1p if op=='log1p' else np.sqrt)(np.where(neg,0.0,x));r[neg]=np.nan;return r
        if op in cmp:return cmp[op](a[0],a[1]).astype(np.float64)
        if op=='where':return np.where((x!=0)&~np.isnan(x),a[1],a[2])
        if op=='isnan':return np.isnan(x).astype(np.float64)
        if op=='fillna':return np.where(np.isnan(x),n['value'],x)
        if op=='bucketize':r=np.searchsorted(np.array(n['edges'],np.float64),x,side='right').astype(np.float64);r[np.isnan(x)]=np.nan;return r
        raise KeyError('DSL_OP')
    def run(X,chunk=1<<21):
        X=np.asarray(X);out=np.empty(len(X),np.float32)
        with np.errstate(all='ignore'):
            for s in range(0,len(X),chunk):
                r=ev(node,X[s:s+chunk]);r[~np.isfinite(r)]=np.nan;o=r.astype(np.float32);o[~np.isfinite(o)]=np.nan;out[s:s+chunk]=o+np.float32(0)
        return out
    return run
SPECIAL=[NAN,0.0,-0.0,1.0,-1.0,0.5,-0.5,2.0,1e-9,-1e-9,5e-10,2e-9,-2e-9,1e-30,100.0,-100.0,1e6,-1e6,3e38,-3e38]
def _key(v):return 'nan' if v!=v else _bits(v)
def parity_vector(ast,min_rows=64,random_rows=48,max_rows=4096):
    c=canon(ast);ins=inputs(c);k=len(ins);vals=[];seen=set()
    for v in SPECIAL+[w for x in _consts(c) for f in [_r32(x)] for w in (f,_unord(_ord(f)+1),_unord(_ord(f)-1))]:
        f=_r32(v)
        if (f!=f or math.isfinite(f)) and _key(f) not in seen:seen.add(_key(f));vals.append(f)
    rng=random.Random(int(hashlib.sha256(dump(c).encode()).hexdigest()[:16],16));typical=[_r32(rng.uniform(1,50)) for _ in ins]
    cand=[[v]*k for v in vals]+[typical[:i]+[v]+typical[i+1:] for i in range(k) for v in vals];rows=[];rk=set()
    def add(r):
        t=tuple(_key(v) for v in r)
        if t not in rk:rk.add(t);rows.append(r)
    for r in cand:add(r)
    target=max(min_rows,len(rows)+random_rows)
    while len(rows)<target:add([NAN if rng.random()<0.15 else 0.0 if rng.random()<0.1 else _r32(rng.uniform(-60,60)) for _ in ins])
    rows=rows[:max_rows];enc=lambda v:None if v!=v else v
    exp=[enc(ref_eval(c,dict(zip(ins,r)))) for r in rows]
    return {'schema':'AUTOLOOP_DSL_PARITY/1','dslVersion':VERSION,'name':name(c),'canonical':c,'inputs':ins,'maxUlpFloat32':1 if ops(c)&ULP_OPS else 0,
            'encoding':'numbers are the exact binary64 values of float32 inputs and outputs; null is NaN; outputs come from the reference interpreter',
            'rows':[[enc(v) for v in r] for r in rows],'expected':exp}
def parity_bytes(vec):return (dump(vec)+'\n').encode()
def parity_sha(vec):return hashlib.sha256(parity_bytes(vec)).hexdigest()
def compare(got,vec):
    tol=vec['maxUlpFloat32'];bad=[];ulps={}
    for i,(g,e) in enumerate(zip(got,vec['expected'])):
        g=NAN if g is None else float(g);e=NAN if e is None else e
        if (g!=g)!=(e!=e):bad.append(i);continue
        if g==g:
            u=ulp(_r32(g),e)
            if u:ulps[i]=u
            if u>tol:bad.append(i)
    return {'rows':len(vec['expected']),'ok':not bad and len(got)==len(vec['expected']),'failedRows':bad[:10],'failed':len(bad),'ulpRows':len(ulps),'maxUlp':max(ulps.values(),default=0)}
def parity_numpy(ast,vec):
    import numpy as np
    c=canon(ast)
    if vec['name']!=name(c) or vec['canonical']!=c:return {'ok':False,'failed':-1,'reason':'PARITY_IDENTITY'}
    X=np.array([[NAN if v is None else v for v in r] for r in vec['rows']],np.float32).reshape(len(vec['rows']),len(vec['inputs']))
    return compare(compile_numpy(c,vec['inputs'])(X).tolist(),vec)
JAVA_CLASS='SeatForecastDerivedFeatures'
JAVA_OPS={'safe_div':'safeDiv','isnan':'isNaN','fillna':'fillNaN'}
def java_param(f):p=f.split('_');return p[0]+''.join(w[:1].upper()+w[1:] for w in p[1:])
def _jlit(v):return repr(float(v))
def java_expr(n):
    op=n['op']
    if op=='col':return java_param(n['name'])
    if op=='const':return _jlit(n['value'])
    a=[java_expr(x) for x in n['args']]+[_jlit(n[f]) for f in ('lo','hi','value') if f in n]+[_jlit(e) for e in n.get('edges',())]
    return '%s(%s)'%(JAVA_OPS.get(op,op),', '.join(a))
def java_method(ast):
    c=canon(ast);ins=inputs(c);ps=',\n'.join('        final double '+java_param(f) for f in ins)
    doc='\n'.join(['    /**','     * {@code %s}'%dump(c),'     *']+['     * @param %s %s'%(java_param(f),f) for f in ins]+['     */'])
    return '%s\n    public static float %s(\n%s\n    ) {\n        return toFeature(%s);\n    }\n'%(doc,name(c),ps,java_expr(c))
JAVA_HELPERS='''
    private static double add(final double left, final double right) {
        return left + right;
    }

    private static double sub(final double left, final double right) {
        return left - right;
    }

    private static double mul(final double left, final double right) {
        return left * right;
    }

    /** 분모가 NaN이거나 절댓값이 {@link #DENOMINATOR_EPSILON} 보다 작으면 NaN이다. */
    private static double safeDiv(final double numerator, final double denominator) {
        if (Double.isNaN(denominator) || Math.abs(denominator) < DENOMINATOR_EPSILON) {
            return Double.NaN;
        }
        return numerator / denominator;
    }

    private static double neg(final double value) {
        return -value;
    }

    private static double abs(final double value) {
        return Math.abs(value);
    }

    private static double square(final double value) {
        return value * value;
    }

    private static double min(final double left, final double right) {
        return Math.min(left, right);
    }

    private static double max(final double left, final double right) {
        return Math.max(left, right);
    }

    private static double clip(final double value, final double low, final double high) {
        if (Double.isNaN(value)) {
            return Double.NaN;
        }
        return Math.min(high, Math.max(low, value));
    }

    /** 음수면 NaN이다. 플랫폼마다 같은 값을 내도록 StrictMath를 쓴다. */
    private static double log1p(final double value) {
        return value < 0 ? Double.NaN : StrictMath.log1p(value);
    }

    /** 음수면 NaN이다. */
    private static double sqrt(final double value) {
        return value < 0 ? Double.NaN : StrictMath.sqrt(value);
    }

    /** 비교는 NaN이 끼면 0이다. 아래 넷도 같다. */
    private static double gt(final double left, final double right) {
        return left > right ? 1 : 0;
    }

    private static double ge(final double left, final double right) {
        return left >= right ? 1 : 0;
    }

    private static double lt(final double left, final double right) {
        return left < right ? 1 : 0;
    }

    private static double le(final double left, final double right) {
        return left <= right ? 1 : 0;
    }

    private static double eq(final double left, final double right) {
        return left == right ? 1 : 0;
    }

    /** 조건이 0도 NaN도 아니면 둘째 값, 아니면 셋째 값이다. */
    private static double where(final double condition, final double whenTrue, final double whenFalse) {
        return !Double.isNaN(condition) && condition != 0 ? whenTrue : whenFalse;
    }

    private static double isNaN(final double value) {
        return Double.isNaN(value) ? 1 : 0;
    }

    private static double fillNaN(final double value, final double replacement) {
        return Double.isNaN(value) ? replacement : value;
    }

    /** x 이하인 경계의 개수다. 경계와 같은 값은 위 칸으로 간다. NaN은 NaN이다. */
    private static double bucketize(final double value, final double... edges) {
        if (Double.isNaN(value)) {
            return Double.NaN;
        }
        int count = 0;
        for (final double edge : edges) {
            if (value >= edge) {
                count++;
            }
        }
        return count;
    }

    /** double 결과를 학습 때와 같은 float로 맞춘다. 유한하지 않으면 NaN, 0은 +0이다. */
    private static float toFeature(final double value) {
        final float rounded = (float) value;
        if (!Float.isFinite(rounded)) {
            return Float.NaN;
        }
        return rounded + 0.0f;
    }
'''
def java_class(asts,class_name=JAVA_CLASS,package=None):
    cs=[];seen=set()
    for a in asts:
        nm=name(a)
        if nm not in seen:seen.add(nm);cs.append(canon(a))
    head=('package %s;\n\n'%package if package else '')+'import java.util.List;\n\n'
    doc='''/**
 * 자동 실험 루프가 제안한 파생 입력 %d개. 생성된 코드라 손으로 고치지 않는다.
 *
 * <p>정본은 메서드마다 적힌 정규형 JSON AST이고 메서드 이름은 그 AST의 해시다(DSL v%d).
 * 입력은 학습에 쓴 as-of 기본 입력 32개 중 일부다. float32 값을 double로 넓혀 넘기고 결측은 NaN으로 넘긴다.
 * 계산은 double로 하고 결과는 float로 반올림한다. 유한하지 않은 결과는 NaN, 0은 +0이다.
 *
 * <p>결측 규칙은 학습 쪽 참조 해석기와 같다. 같은 이름의 골든 벡터 파일로 값이 같은지 확인한다.
 */
'''%(len(cs),VERSION)
    body='public final class %s {\n\n    public static final List<String> FEATURE_NAMES = List.of(%s);\n\n    private static final double DENOMINATOR_EPSILON = %s;\n\n    private %s() {\n    }\n\n'%(class_name,', '.join('"%s"'%name(c) for c in cs),_jlit(EPS),class_name)
    return head+doc+body+'\n'.join(java_method(c) for c in cs)+JAVA_HELPERS+'}\n'
def java_sha(asts,**kw):return hashlib.sha256(java_class(asts,**kw).encode()).hexdigest()
def _corr(a,fa,b,np):
    m=fa&np.isfinite(b)
    if int(m.sum())<SEMANTIC['minPairRows']:return None
    x=a[m]-a[m].mean();y=b[m]-b[m].mean();d=math.sqrt(float((x*x).sum())*float((y*y).sum()))
    if d==0 or not math.isfinite(d):return None
    r=float((x*y).sum())/d;return r if math.isfinite(r) else None
def semantic_report(X,names,asts,cache=None):
    import numpy as np
    n=len(X);rep=[];prev=[];cols=[(k,X[:,j].astype(np.float64)) for j,k in enumerate(names)]
    for a in asts:
        nm=name(a);v=(cache or {}).get(nm)
        if v is None:v=compile_numpy(a,names)(X)
        errs=[];fin=np.isfinite(v);share=float(fin.mean()) if n else 0.0;v64=v.astype(np.float64)
        if v.dtype!=np.float32 or v.shape!=(n,):errs.append('SEM_DTYPE_SHAPE')
        if share<SEMANTIC['minFiniteShare']:errs.append('SEM_FINITE_SHARE')
        if not fin.any() or float(v[fin].min())==float(v[fin].max()):errs.append('SEM_CONSTANT')
        best={}
        for kind,pool in (('base',cols),('derived',prev)):
            for k,c in pool:
                r=_corr(v64,fin,c,np)
                if r is not None and (kind not in best or abs(r)>abs(best[kind]['corr'])):best[kind]={'with':k,'corr':r}
        if 'base' in best and abs(best['base']['corr'])>=SEMANTIC['maxAbsCorr']:errs.append('SEM_DUPLICATE_BASE')
        if 'derived' in best and abs(best['derived']['corr'])>=SEMANTIC['maxAbsCorr']:errs.append('SEM_DUPLICATE_DERIVED')
        prev.append((nm,v64))
        rep.append({'name':nm,'ok':not errs,'errors':errs,'rows':n,'finiteShare':share,'maxAbsCorrBase':best.get('base'),'maxAbsCorrDerived':best.get('derived')})
    return rep
def sample_shards(count):return [i for i in range(count) if i%SEMANTIC['sampleShardStride']==0]
