"""Autonomous loop worker: trains the candidates of one planner experiment on the full TRAIN split and scores them on DEV_S only
(sealed H rows are dropped right after each shard is decoded and are never kept, predicted or scored), against the fixed champion
and the stored product forecasts. Optional DSL v1 derived features (dsl.py) are checked on a TRAIN-only sample, parity-checked against their
golden vectors, appended after the 32 base columns for TRAIN and DEV_S, and recorded with their golden-vector and Java source hashes. No provider access."""
from pathlib import Path
import argparse,importlib.metadata,json,math,os,platform,resource,sys,time,types
R=Path(__file__).resolve().parent
C=types.ModuleType('autoloop_common');C.__file__=str(R/'common.py');exec(compile((R/'common.py').read_bytes(),C.__file__,'exec'),C.__dict__)
need=C.need;D=C.D

def options():
    raw=os.environ.get('AUTOLOOP_TEST')
    if raw is None:return {'base':C.BASE,'device':'cuda:0','limit':None,'expectVersions':None,'test':False}
    o=json.loads(raw);need(Path(o['base'])!=C.BASE and o['device']=='cpu' and isinstance(o['limit'],int),'TEST_OPTIONS_SCOPE')
    if 'minBlockRows' in o:C.SEARCH['minBlockRows']=int(o['minBlockRows'])
    return {'base':Path(o['base']),'device':'cpu','limit':o['limit'],'expectVersions':o['expectVersions'],'test':True}

def load_split(role,m,dirs,limit,np,pa,pq,progress):
    m7,m8,m9,m14=m['dataset'],m['features'],m['stopDemand'],m['devSplit']
    s7=m7['splits'][role]['shards'];s8=m8['splits'][role]['shards'];s9=m9['splits'][role]['shards'];need(len(s7)==len(s8)==len(s9),'SHARD_COUNT')
    s14=m14['splits']['DEV']['shards'] if role=='DEV' else [None]*len(s7)
    if limit is not None:s7,s8,s9,s14=s7[:limit],s8[:limit],s9[:limit],s14[:limit]
    feats=m8['featureNames']+m9['featureNames'];base6=m7['featureNames'];side=m8['featureNames'][6:];stop=m9['featureNames']
    parts=[];nbytes=0;sid=[]
    for i,(a,b,c9,d14) in enumerate(zip(s7,s8,s9,s14)):
        need(a['path']==b['path']==c9['path'] and a['rows']==b['rows']==c9['rows'],'SHARD_ALIGN')
        raws={}
        for key,shard in (('dataset',a),('features',b),('stopDemand',c9))+((('devSplit',d14),) if d14 else ()):
            raw=(dirs[key]/shard['path']).read_bytes();need(C.sha_bytes(raw)==shard['sha256'],'SHARD_PIN:'+key.upper());raws[key]=raw;nbytes+=len(raw)
        ta,tb,tc=(pq.read_table(pa.BufferReader(raws[k])) for k in ('dataset','features','stopDemand'))
        s=ta['sample_id'].to_numpy();need(np.array_equal(s,tb['sample_id'].to_numpy()) and np.array_equal(s,tc['sample_id'].to_numpy()),'SAMPLE_ID_JOIN')
        keep=np.ones(len(s),bool);extra={}
        if d14:
            td=pq.read_table(pa.BufferReader(raws['devSplit']));need(np.array_equal(s,td['sample_id'].to_numpy()),'SPLIT_SAMPLE_ID_JOIN')
            keep=td['split'].to_numpy()==C.DEV_SPLIT_CODE
            extra={'service_day':td['service_day'].to_numpy()[keep],'kst_hour':td['kst_hour'].to_numpy()[keep],'prod_expected_seats':tb['prod_expected_seats'].to_numpy(zero_copy_only=False)[keep].astype('<f4'),'prod_full_chance':tb['prod_full_chance'].to_numpy(zero_copy_only=False)[keep].astype('<f4')}
        n=int(keep.sum());X=np.empty((n,len(feats)),'<f4')
        for j,f in enumerate(base6):X[:,j]=ta[f].to_numpy(zero_copy_only=False)[keep]
        for j,f in enumerate(side):X[:,6+j]=tb[f].to_numpy(zero_copy_only=False)[keep].astype('<f4')
        for j,f in enumerate(stop):X[:,6+len(side)+j]=tc[f].to_numpy(zero_copy_only=False)[keep].astype('<f4')
        need(bool((ta['weight_numerator'].to_numpy()==1).all()),'WEIGHT_NUMERATOR_ONE')
        y=ta['observed_seats'].to_numpy()[keep].astype('<i4');w=1.0/ta['weight_denominator'].to_numpy()[keep].astype('<f8');gid=ta['arrival_group_id'].to_numpy()[keep]
        sid.append(C.sha_bytes(s[keep].astype('<u8').tobytes()));parts.append((X,y,w,gid,extra,keep))
        if i%32==0:progress('LOADING_'+role,shardsRead=i+1,shards=len(s7))
    X=np.concatenate([p[0] for p in parts]);y=np.concatenate([p[1] for p in parts]);w=np.concatenate([p[2] for p in parts]);gid=np.concatenate([p[3] for p in parts])
    extra={k:np.concatenate([p[4][k] for p in parts]) for k in parts[0][4]} if parts and parts[0][4] else {}
    if role=='DEV':extra['_keep']=np.concatenate([p[5] for p in parts]);extra['_shardRows']=int(sum(a_['rows'] for a_ in s7))
    del parts
    need(bool((y>=0).all()),'LABEL_DOMAIN')
    info={'role':role if role=='TRAIN' else 'DEV_S','rows':int(len(y)),'shards':len(s7),'bytesRead':nbytes,'weightSum':float(w.sum()),'groups':int(len(np.unique(gid))),'orderedSampleDigest':C.digest(sid),'complete':limit is None}
    if limit is None and role=='TRAIN':need(info['rows']==C.TRAIN_ROWS,'TRAIN_ROWS')
    if limit is None and role=='DEV':need(info['rows']==C.DEV_S_ROWS and info['groups']==C.DEV_S_GROUPS,'DEV_S_ROWS')
    return X,y,w,gid,extra,info,feats

def feature_cols(spec,feats,nb=None):
    f=spec['features'];nb=len(feats) if nb is None else nb;der=[feats.index(D.name(a)) for a in spec.get('derivedFeatures',())]
    if isinstance(f,list):return [feats.index(x) for x in f]+der
    if f=='ALL':return list(range(nb))+der
    if f=='NO_ROUTE':return [i for i,x in enumerate(feats[:nb]) if x!=C.ROUTE_FEATURE]+der
    if f=='NO_STOP':return [i for i,x in enumerate(feats[:nb]) if x not in C.STOP_FEATURES]+der
    if f=='BASE6':return list(range(6))+der
    raise C.Stop('FEATURE_SET')
def append_derived(X,fns,np):
    nb=X.shape[1];Xn=np.empty((len(X),nb+len(fns)),'<f4');Xn[:,:nb]=X
    for j,f in enumerate(fns):Xn[:,nb+j]=f(X)
    return Xn

def block_keys(X,feats,np):
    route=X[:,feats.index(C.ROUTE_FEATURE)].astype(np.int64);hb=np.searchsorted(np.array(C.HORIZON_EDGES,'f8'),np.nan_to_num(X[:,feats.index(C.HORIZON_FEATURE)],nan=0),side='right')
    return route*16+hb

def linear_fit(X,y,w,ridge,np,chunk=2_000_000):
    mu=np.nan_to_num(np.nanmean(X,axis=0),nan=0.0);M=np.nonzero(np.isnan(X).any(axis=0))[0]
    k=1+X.shape[1]+len(M);A=np.zeros((k,k));b=np.zeros(k)
    for s in range(0,len(X),chunk):
        x=X[s:s+chunk];D=np.concatenate([np.ones((len(x),1)),np.where(np.isnan(x),mu,x).astype('f8'),np.isnan(x[:,M]).astype('f8')],axis=1);wc=w[s:s+chunk]
        A+=(D*wc[:,None]).T@D;b+=(D*wc[:,None]).T@y[s:s+chunk].astype('f8')
    A[1:,1:]+=ridge*np.eye(k-1);coef=np.linalg.lstsq(A,b,rcond=None)[0]
    return {'mean':mu.tolist(),'missingCols':M.tolist(),'coef':coef.tolist()}
def linear_predict(model,X,np,chunk=2_000_000):
    mu=np.array(model['mean']);M=model['missingCols'];coef=np.array(model['coef']);out=np.empty(len(X),'<f4')
    for s in range(0,len(X),chunk):
        x=X[s:s+chunk];D=np.concatenate([np.ones((len(x),1)),np.where(np.isnan(x),mu,x).astype('f8'),np.isnan(x[:,M]).astype('f8') if M else np.zeros((len(x),0))],axis=1);out[s:s+chunk]=D@coef
    return out

def main(a):
    o=options();base=o['base'];C.verify_package(a.package_sha)
    q=json.loads(C.capture({'path':a.request,'sha256':a.request_sha},base=base));C.validate_request(q,base);env,auth=C.validate_parent_evidence(q,base,o['expectVersions'])
    out=C.safe(q['outputRoot'],base)/'worker';need(out.is_dir() and {p.name for p in out.iterdir()}=={'stdout.log','stderr.log'},'FRESH_WORKER_OUTPUT')
    began=time.monotonic();deadline=began+min(q['limits']['overallWallSeconds'],q['parentDeadlineUnix']-time.time());l=q['limits']
    resource.setrlimit(resource.RLIMIT_CPU,(l['cpuSeconds'],l['cpuSeconds']))
    import numpy as np,pyarrow as pa,pyarrow.parquet as pq,xgboost as xgb
    if not o['test']:
        need(platform.system()=='Linux' and platform.machine()=='x86_64' and sys.executable==q['pythonExecutable'] and platform.python_version()==env['versions']['python'],'LINUX_RUNTIME_EXECUTABLE')
        need({'numpy':np.__version__,'pyarrow':pa.__version__,'xgboost':xgb.__version__,'nccl':importlib.metadata.version('nvidia-nccl-cu13')}=={k:env['versions'][k] for k in ('numpy','pyarrow','xgboost','nccl')},'NATIVE_VERSIONS')
        need(xgb.build_info().get('USE_CUDA') is True and xgb.build_info()['CUDA_VERSION'][0]==13,'CUDA_RUNTIME')
    def progress(phase,**kw):C.replace_json(out/'progress.json',{'schema':'AUTOLOOP_PROGRESS/1','phase':phase,'runId':q['runId'],'experiment':q['experiment']['id'],'atEpoch':time.time(),'elapsedSeconds':time.monotonic()-began,'HRead':False,'test':o['test'],**kw})
    def tick():need(time.monotonic()<deadline,'WORKER_DEADLINE')
    progress('VERIFYING_INPUTS')
    m={k:json.loads(C.capture(q['pins'][k],base=base)) for k in ('dataset','features','stopDemand','devSplit')}
    dirs={k:C.safe(q['pins'][k]['path'],base).parent for k in m}
    need(m['features']['derivedFrom']['manifestSha256']==C.PIN_SHA['dataset'] and m['stopDemand']['derivedFrom']==m['features']['derivedFrom'] and m['devSplit']['derivedFrom']==m['features']['derivedFrom'],'DERIVED_FROM_007')
    need(m['features']['mappingProof']['seatMismatch']==0 and m['features']['mappingProof']['horizonMismatch']==0 and m['stopDemand']['mappingProof']['seatMismatch']==0,'MAPPING_PROOFS')
    need(m['devSplit']['splitTotals']['DEV_S']=={'rows':C.DEV_S_ROWS,'groups':C.DEV_S_GROUPS},'DEV_S_DECLARED')
    feats_all=m['features']['featureNames']+m['stopDemand']['featureNames'];need(len(feats_all)==32,'FEATURE_COUNT');C.validate_experiment(q['experiment'],feats_all)
    pre=0
    for i_,(a7,a8,a9,a14) in enumerate(zip(*(m[k]['splits']['DEV']['shards'] for k in ('dataset','features','stopDemand','devSplit')))):
        if o['limit'] is not None and i_>=o['limit']:break
        for key,sh in (('dataset',a7),('features',a8),('stopDemand',a9),('devSplit',a14)):need(C.file_sha(dirs[key]/sh['path'],1<<30)==sh['sha256'],'DEV_PREHASH_PIN:'+key.upper())
        pre+=1
    progress('VERIFIED_DEV_BYTES_BEFORE_TRAINING',shards=pre)
    spec_list=q['experiment']['candidates'];order=sorted(range(len(spec_list)),key=lambda i:(json.dumps(spec_list[i]['features']),spec_list[i]['blocks'],spec_list[i]['head']))
    X,y,w,gid,_,tinfo,feats=load_split('TRAIN',m,dirs,o['limit'],np,pa,pq,progress);tick()
    base_feats=list(feats);nb=len(base_feats);derived=C.derived_union(spec_list);der_info={};der_meta=None
    if derived:
        progress('DERIVING_FEATURES',derived=len(derived))
        sh=m['dataset']['splits']['TRAIN']['shards'][:o['limit']];offs=np.cumsum([0]+[s_['rows'] for s_ in sh]);need(int(offs[-1])==len(X),'DERIVED_SAMPLE_ROWS')
        picked=D.sample_shards(len(sh));Xs_=X[np.concatenate([np.arange(offs[i_],offs[i_+1]) for i_ in picked])]
        fns={nm:D.compile_numpy(a_,base_feats) for nm,a_ in derived};cache={nm:f_(Xs_) for nm,f_ in fns.items()};sem={}
        for spec in spec_list:
            if 'derivedFeatures' in spec:
                sem[spec['candidate']]=D.semantic_report(Xs_,base_feats,spec['derivedFeatures'],cache)
                for r_ in sem[spec['candidate']]:need(r_['ok'],'DERIVED_SEMANTIC:%s:%s:%s'%(spec['candidate'],r_['name'].upper(),(r_['errors'] or [''])[0]))
        for nm,a_ in derived:
            vec=D.parity_vector(a_);pr=D.parity_numpy(a_,vec);need(pr['ok'],'DERIVED_PARITY:'+nm.upper())
            vsha=C.publish_new(out/('derived-%s.parity.json'%nm),vec);need(vsha==D.parity_sha(vec),'DERIVED_PARITY_FILE:'+nm.upper())
            der_info[nm]={'canonical':a_,'inputs':D.inputs(a_),'complexity':D.complexity(a_),'parityVectorFile':'derived-%s.parity.json'%nm,'parityVectorSha256':vsha,'parityRows':len(vec['rows']),'numpyParity':pr}
        der_meta={'dslVersion':D.VERSION,'features':der_info,'trainSemantic':sem,'semanticSample':{'role':'TRAIN','shards':picked,'rows':int(len(Xs_))}}
        del Xs_,cache;X=append_derived(X,[fns[nm] for nm,_ in derived],np);feats=base_feats+[nm for nm,_ in derived];tick()
    route_train=X[:,feats.index(C.ROUTE_FEATURE)].astype(np.int64);support=np.bincount(route_train,minlength=64)
    seat=y.astype('<f4');full=(y==0).astype('<f4');w32=w.astype('<f4');bk_train=block_keys(X,feats,np)
    ordr=np.argsort(y,kind='stable');cw=np.cumsum(w[ordr]);median_label=float(y[ordr][np.searchsorted(cw,cw[-1]/2)])
    models={};results=[];calls=0;cache={'key':None,'dm':None,'label':None}
    class Watch(xgb.callback.TrainingCallback):
        def __init__(s,name,rounds,end):s.name=name;s.rounds=rounds;s.end=end;s.last=0
        def after_iteration(s,model,epoch,log):
            if time.monotonic()>=min(s.end,deadline):return True
            if time.monotonic()-s.last>10:progress('TRAINING',candidate=s.name,completedRounds=epoch+1,totalRounds=s.rounds,trainingCalls=calls);s.last=time.monotonic()
            return False
    def xgb_params(spec):
        p=dict(C.BASE_PARAMS);p.update(spec['params']);p['device']=o['device'];p['objective']=spec['objective']
        if spec['objective']=='reg:quantileerror':p['quantile_alpha']=spec['quantileAlphas']
        if spec['objective']=='reg:pseudohubererror':p.setdefault('base_score',median_label)
        return p
    def train_xgb(spec,cols,rows,label,end):
        Xs=np.ascontiguousarray(X[rows][:,cols]) if rows is not None else (X if cols==list(range(X.shape[1])) else np.ascontiguousarray(X[:,cols]))
        lab=(full if label=='FULL' else seat) if rows is None else (full if label=='FULL' else seat)[rows]
        dm=xgb.QuantileDMatrix(Xs,label=lab,weight=w32 if rows is None else w32[rows],max_bin=spec['params'].get('max_bin',C.BASE_PARAMS['max_bin']),nthread=l['cpuThreads'],feature_names=[feats[i] for i in cols])
        del Xs;b=xgb.train(xgb_params(spec),dm,num_boost_round=spec['rounds'],evals=[],verbose_eval=False,callbacks=[Watch(spec['candidate'],spec['rounds'],end)])
        need(b.num_boosted_rounds()==spec['rounds'],'CANDIDATE_ROUNDS_OR_DEADLINE:'+spec['candidate']);del dm;return b
    for i in order:
        spec=spec_list[i];tick();calls+=1;name=spec['candidate'];t=time.monotonic();end=t+l['perCandidateWallSeconds'];cols=feature_cols(spec,feats,nb)
        progress('TRAINING',candidate=name,trainingCalls=calls)
        entry={'spec':spec,'cols':cols,'pooled':None,'blocks':{}}
        if spec['kind']=='XGB':
            entry['pooled']=train_xgb(spec,cols,None,spec['head'],end)
            if spec['blocks']=='ROUTE_HORIZON':
                keys,counts=np.unique(bk_train,return_counts=True);use=[int(k) for k,c in zip(keys,counts) if c>=C.SEARCH['minBlockRows']][:C.SEARCH['maxBlocksPerCandidate']]
                for k in use:tick();entry['blocks'][k]=train_xgb(spec,cols,np.nonzero(bk_train==k)[0],spec['head'],end)
        else:
            entry['pooled']=linear_fit(X[:,cols],y,w,spec['params']['ridge'],np)
            if spec['blocks']=='ROUTE_HORIZON':
                keys,counts=np.unique(bk_train,return_counts=True)
                for k,c in zip(keys,counts):
                    if c>=C.SEARCH['minBlockRows'] and len(entry['blocks'])<C.SEARCH['maxBlocksPerCandidate']:mk=bk_train==k;entry['blocks'][int(k)]=linear_fit(X[mk][:,cols],y[mk],w[mk],spec['params']['ridge'],np)
        wall=time.monotonic()-t;files={}
        if spec['kind']=='XGB':
            p=out/(name+'.model.json');need(not p.exists(),'MODEL_EXISTS');entry['pooled'].save_model(str(p));os.chmod(p,0o600);files['pooled']=C.file_sha(p,1<<32)
            for k,bm in entry['blocks'].items():
                p=out/('%s.block-%d.model.json'%(name,k));bm.save_model(str(p));os.chmod(p,0o600);files['block-%d'%k]=C.file_sha(p,1<<32)
        else:files['linear']=C.publish_new(out/(name+'.linear.json'),{'pooled':entry['pooled'],'blocks':{str(k):v for k,v in entry['blocks'].items()},'featureNames':[feats[i] for i in cols]})
        recipe={'schema':'AUTOLOOP_RECIPE/1','candidate':name,'experiment':q['experiment']['id'],'spec':spec,'parameters':xgb_params(spec) if spec['kind']=='XGB' else spec['params'],'featureNames':[feats[i] for i in cols],
            'blocksTrained':sorted(entry['blocks']),'trainRows':tinfo['rows'],'trainWeightSum':tinfo['weightSum'],'trainOrderedSampleDigest':tinfo['orderedSampleDigest'],'requestSha256':a.request_sha,'trainingCall':calls,'trainWallSeconds':wall,'artifactSha256':files}
        if 'derivedFeatures' in spec:
            jsha=C.publish_bytes(out/(name+'.derived.java'),D.java_class(spec['derivedFeatures']).encode())
            recipe['derivedFeatures']=[{'name':D.name(a_),'canonical':D.canon(a_),'inputs':D.inputs(a_),'complexity':D.complexity(a_),'parityVectorSha256':der_info[D.name(a_)]['parityVectorSha256']} for a_ in spec['derivedFeatures']]
            recipe['derivedJava']={'dslVersion':D.VERSION,'className':D.JAVA_CLASS,'file':name+'.derived.java','sourceSha256':jsha}
        rsha=C.publish_new(out/(name+'.recipe.json'),recipe)
        models[name]=entry;results.append({'candidate':name,'kind':spec['kind'],'head':spec['head'],'blocks':spec['blocks'],'recipeSha256':rsha,'artifactSha256':files,'trainWallSeconds':wall,'trainingCall':calls})
        if 'derivedFeatures' in spec:results[-1]['derivedFeatures']=[x_['name'] for x_ in recipe['derivedFeatures']];results[-1]['derivedJavaSha256']=jsha
    del X,seat,full,w32,bk_train;tick()
    progress('LOADING_DEV_S',trainingCalls=calls)
    Xd,yd,wd,gd,ex,dinfo,_=load_split('DEV',m,dirs,o['limit'],np,pa,pq,progress);tick()
    if derived:Xd=append_derived(Xd,[fns[nm] for nm,_ in derived],np);tick()
    need(np.intersect1d(np.unique(gid),np.unique(gd)).size==0,'TRAIN_DEV_GROUP_DISJOINT');del gid
    n=len(yd);chunk=l['predictRows'];preds={}
    ch=q['champion'];cp=C.safe(ch['predictions']['path'],base);need(C.file_sha(cp,1<<32)==ch['predictions']['sha256'],'CHAMPION_BYTES');cpred=np.load(cp)
    if ch['scope']=='DEV':need(cpred.shape==(C.DEV_ROWS,),'CHAMPION_DEV_ROWS');cpred=cpred[:ex['_shardRows']][ex['_keep']]
    need(cpred.shape==(len(yd),) and bool(np.isfinite(cpred).all()),'CHAMPION_DEV_S_ROWS')
    progress('SCORING',trainingCalls=calls);bk_dev=block_keys(Xd,feats,np)
    def predict_xgb(b,cols,rows,k=None,spec=None):
        out_=np.empty(len(rows),'<f4')
        for s in range(0,len(rows),chunk):
            idx=rows[s:s+chunk];dm=xgb.DMatrix(np.ascontiguousarray(Xd[idx][:,cols]),feature_names=[feats[i] for i in cols],nthread=l['cpuThreads'])
            p=b.predict(dm,iteration_range=(0,k) if k else (0,0))
            if spec is not None and spec['objective']=='reg:quantileerror' and p.ndim==2:p=p[:,spec['quantileAlphas'].index(0.5)]
            out_[s:s+len(idx)]=p
        return out_
    allrows=np.arange(n);preds['CHAMPION']=cpred.astype('<f4')
    quantile_cov={}
    for name,e in models.items():
        tick();spec=e['spec'];cols=e['cols']
        if spec['kind']=='XGB':
            curve=spec.get('curve',[spec['rounds']])
            for k in curve:
                p=predict_xgb(e['pooled'],cols,allrows,k,spec)
                if e['blocks']:
                    for key,bm in e['blocks'].items():
                        rows=np.nonzero(bk_dev==key)[0]
                        if len(rows):p[rows]=predict_xgb(bm,cols,rows,k,spec)
                preds[(name,k)]=p
            if spec['objective']=='reg:quantileerror':
                full_q=np.empty((n,len(spec['quantileAlphas'])),'<f4')
                for s in range(0,n,chunk):
                    dm=xgb.DMatrix(np.ascontiguousarray(Xd[s:s+chunk][:,cols]),feature_names=[feats[i] for i in cols],nthread=l['cpuThreads']);pq_=e['pooled'].predict(dm);full_q[s:s+chunk]=pq_.reshape(len(pq_),-1)
                quantile_cov[name]={str(a_):float((wd*(yd<=full_q[:,j])).sum()/wd.sum()) for j,a_ in enumerate(spec['quantileAlphas'])}
        else:
            p=linear_predict(e['pooled'],Xd[:,cols],np)
            for key,lm in e['blocks'].items():
                rows=np.nonzero(bk_dev==key)[0]
                if len(rows):p[rows]=linear_predict(lm,Xd[rows][:,cols],np)
            preds[(name,'linear')]=p
        progress('SCORING',candidate=name,trainingCalls=calls)
    progress('EVALUATING',trainingCalls=calls)
    yf=yd.astype('f8');W=float(wd.sum());route=Xd[:,feats.index(C.ROUTE_FEATURE)].astype(np.int64);unseen=support[route]==0
    blk=(ex['service_day'].astype(np.int64)*100+ex['kst_hour'].astype(np.int64));ub,binv=np.unique(blk,return_inverse=True);B=len(ub);NR=64
    fullbus=yd==0
    def stats(p,head='SEAT'):
        p=p.astype('f8')
        if head=='FULL':
            t=fullbus.astype('f8');br=(p-t)**2
            return {'Brier':float((wd*br).sum()/W),'meanProbability':float((wd*p).sum()/W),'blockBrier':np.bincount(binv,wd*br,B).tolist()}
        e_=np.abs(p-yf);er=np.abs(np.rint(np.clip(p,0,70))-yf)
        st={'W':np.bincount(binv,wd,B),'AE':np.bincount(binv,wd*e_,B),'SE':np.bincount(binv,wd*(p-yf)**2,B),'O10':np.bincount(binv,wd*(er>=10),B),'O5':np.bincount(binv,wd*(er>=5),B),'IN1':np.bincount(binv,wd*(er<=1),B),'IN2':np.bincount(binv,wd*(er<=2),B),'EX':np.bincount(binv,wd*(er==0),B),
            'FW':np.bincount(binv,wd*fullbus,B),'FU2':np.bincount(binv,wd*(fullbus&(p<2)),B),'NFU2':np.bincount(binv,wd*(~fullbus&(p<2)),B),'UW':np.bincount(binv,wd*unseen,B),'UAE':np.bincount(binv,wd*unseen*e_,B),
            'RW':np.bincount(binv*NR+route,wd,B*NR).reshape(B,NR),'RAE':np.bincount(binv*NR+route,wd*e_,B*NR).reshape(B,NR)}
        return st
    def point(st):
        S=lambda k:st[k].sum();rw=st['RW'].sum(0);ra=st['RAE'].sum(0);rm=float(np.mean([ra[r]/rw[r] for r in range(NR) if rw[r]>0]))
        return {'MAE':float(S('AE')/S('W')),'RMSE':math.sqrt(float(S('SE')/S('W'))),'routeMacroMAE':rm,'unseenRouteMAE':float(S('UAE')/S('UW')) if S('UW')>0 else None,'over10Share':float(S('O10')/S('W')),'over5Share':float(S('O5')/S('W')),
                'within1Share':float(S('IN1')/S('W')),'within2Share':float(S('IN2')/S('W')),'exactShare':float(S('EX')/S('W')),'fullBusUnder2Share':float(S('FU2')/S('FW')) if S('FW')>0 else None,'notFullUnder2Share':float(S('NFU2')/(S('W')-S('FW')))}
    rng=np.random.default_rng(C.GATE['seed']);boot=rng.integers(0,B,size=(C.GATE['resamples'],B))
    def resampled(st,idx):
        S=lambda k:st[k][idx].sum(axis=1)
        rw=st['RW'][idx].sum(axis=1);ra=st['RAE'][idx].sum(axis=1)
        with np.errstate(invalid='ignore',divide='ignore'):macro=np.nanmean(np.where(rw>0,ra/rw,np.nan),axis=1)
        with np.errstate(invalid='ignore',divide='ignore'):
            return {'MAE':S('AE')/S('W'),'routeMacroMAE':macro,'unseenRouteMAE':S('UAE')/S('UW'),'over10Share':S('O10')/S('W'),'fullBusUnder2Share':S('FU2')/S('FW')}
    champ_st=stats(preds['CHAMPION']);champ_pt=point(champ_st);champ_bs=resampled(champ_st,boot)
    prod_st=stats(ex['prod_expected_seats']);prod_pt=point(prod_st)
    def ci(x):x=x[np.isfinite(x)];return [float(np.quantile(x,0.025)),float(np.quantile(x,0.975))] if len(x) else None
    metrics={'schema':'AUTOLOOP_DEV_S_METRICS/1','experiment':q['experiment']['id'],'rows':n,'weightSum':W,'blocks':int(B),'devOrderedSampleDigest':dinfo['orderedSampleDigest'],'champion':{'modelId':ch['modelId'],**champ_pt},'product':{**prod_pt,'fullChance':stats(ex['prod_full_chance'],'FULL')['Brier']},
             'routeTrainSupportRows':support[:20].tolist(),'candidates':{},'gate':C.GATE}
    for r in results:
        name=r['candidate'];spec=models[name]['spec'];curve_keys=[k for k in preds if isinstance(k,tuple) and k[0]==name]
        final_key=(name,spec['rounds']) if spec['kind']=='XGB' else (name,'linear')
        if spec['head']=='FULL':
            st=stats(preds[final_key],'FULL');r['metrics']={'Brier':st['Brier'],'productBrier':metrics['product']['fullChance']};r['gatePassed']=None;metrics['candidates'][name]={'head':'FULL','final':{'Brier':st['Brier'],'meanProbability':st['meanProbability']}};continue
        st=stats(preds[final_key]);pt=point(st);bs=resampled(st,boot)
        delta={k:ci(bs[k]-champ_bs[k]) for k in bs}
        primary=delta['MAE'] is not None and delta['MAE'][1]<0
        worse={'unseenRouteMAE':delta['unseenRouteMAE'] is not None and delta['unseenRouteMAE'][0]>0,'routeMacroMAE':delta['routeMacroMAE'][0]>0,'over10Share':delta['over10Share'][0]>0,'fullBusUnder2Share':delta['fullBusUnder2Share'] is not None and delta['fullBusUnder2Share'][1]<0}
        passed=bool(primary and not any(worse.values()))
        curve={}
        for k in curve_keys:
            if k[1]!='linear':curve[str(k[1])]=point(stats(preds[k]))['MAE']
        metrics['candidates'][name]={'head':'SEAT','kind':spec['kind'],'final':pt,'deltaVsChampionCI95':delta,'pointDeltaVsChampion':{k:(pt[k]-champ_pt[k]) if pt[k] is not None and champ_pt[k] is not None else None for k in ('MAE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')},
            'primaryImproved':bool(primary),'guardWorsened':worse,'gatePassed':passed,'curveMAE':curve,'quantileCoverage':quantile_cov.get(name)}
        r['metrics']={k:pt[k] for k in ('MAE','RMSE','routeMacroMAE','unseenRouteMAE','over10Share','fullBusUnder2Share')};r['gatePassed']=passed
    progress('DIAGNOSTICS',trainingCalls=calls)
    hz=np.searchsorted(np.array(C.HORIZON_EDGES,'f8'),np.nan_to_num(Xd[:,feats.index(C.HORIZON_FEATURE)],nan=0),side='right');cur=Xd[:,0];cb=np.select([np.isnan(cur),cur==0,cur<=5,cur<=20],[0,1,2,3],4)
    def slices(p):
        e_=np.abs(p.astype('f8')-yf);b_=p.astype('f8')-yf;outd={}
        for nm,idx,k in (('horizonBucket',hz,len(C.HORIZON_EDGES)+1),('currentSeatsBand',cb,5),('route',route,NR),('kstHour',ex['kst_hour'].astype(np.int64),24)):
            sw=np.bincount(idx,wd,k);outd[nm]=[{'key':int(j),'weight':float(sw[j]),'MAE':float(np.bincount(idx,wd*e_,k)[j]/sw[j]),'bias':float(np.bincount(idx,wd*b_,k)[j]/sw[j])} for j in range(k) if sw[j]>0]
        return outd
    diag={'schema':'AUTOLOOP_DIAGNOSTICS/1','experiment':q['experiment']['id'],'champion':slices(preds['CHAMPION']),'product':slices(ex['prod_expected_seats']),'candidates':{},'featureImportance':{}}
    for r in results:
        name=r['candidate'];spec=models[name]['spec']
        if spec['head']!='SEAT':continue
        key=(name,spec['rounds']) if spec['kind']=='XGB' else (name,'linear');diag['candidates'][name]=slices(preds[key])
        if spec['kind']=='XGB':
            g=models[name]['pooled'].get_score(importance_type='total_gain');tot=sum(g.values()) or 1;diag['featureImportance'][name]={k_:v/tot for k_,v in sorted(g.items(),key=lambda x:-x[1])[:20]}
            if 'derivedFeatures' in spec:diag.setdefault('derivedFeatureImportance',{})[name]={D.name(a_):g.get(D.name(a_),0.0)/tot for a_ in spec['derivedFeatures']}
    progress('PUBLISHING',trainingCalls=calls)
    np.save(out/'CHAMPION.dev-s-pred.npy',preds['CHAMPION']);os.chmod(out/'CHAMPION.dev-s-pred.npy',0o600)
    for r in results:
        name=r['candidate'];spec=models[name]['spec'];key=(name,spec['rounds']) if spec['kind']=='XGB' else (name,'linear')
        np.save(out/(name+'.dev-s-pred.npy'),preds[key]);os.chmod(out/(name+'.dev-s-pred.npy'),0o600)
    msha=C.publish_new(out/'metrics.json',metrics);dsha=C.publish_new(out/'diagnostics.json',diag)
    for r in results:r['decisionSha256']=C.publish_new(out/(r['candidate']+'.decision.json'),{'schema':'AUTOLOOP_DECISION/1','candidate':r['candidate'],'experiment':q['experiment']['id'],'metricsSha256':msha,'gate':C.GATE,'gatePassed':r['gatePassed'],'champion':ch['modelId'],'DEV_REUSED':True,'HRead':False,'modelAdoption':False})
    passing=[r for r in results if r['gatePassed']];best=min(passing,key=lambda r:r['metrics']['MAE']) if passing else None
    progress('FINALIZING',trainingCalls=calls)
    for k in q['pins']:C.capture(q['pins'][k],base=base)
    C.capture({'path':a.request,'sha256':a.request_sha},base=base);C.verify_package(a.package_sha)
    inv={}
    for p_ in sorted(out.iterdir()):
        if p_.name in ('stdout.log','stderr.log','progress.json'):continue
        need(p_.is_file() and not p_.is_symlink(),'OUTPUT_FLAT');inv[p_.name]={'bytes':p_.stat().st_size,'sha256':C.file_sha(p_,l['newBytes'])}
    u=resource.getrusage(resource.RUSAGE_SELF)
    receipt={'schema':'AUTOLOOP_WORKER_RECEIPT/1','status':'TEST_ONLY_NOT_ACCEPTED' if o['test'] else 'PRODUCED_NOT_ACCEPTED','test':o['test'],'runId':q['runId'],'experiment':q['experiment']['id'],'requestSha256':a.request_sha,'packageSha256':a.package_sha,'sourcePins':q['pins'],
             'trainingCalls':calls,'train':tinfo,'devS':dinfo,'results':results,'bestGatePassing':None if best is None else {'candidate':best['candidate'],'metrics':best['metrics']},'champion':{'modelId':ch['modelId'],'predictionsSha256':ch['predictions']['sha256'],'metrics':champ_pt},'product':prod_pt,
             'metricsSha256':msha,'diagnosticsSha256':dsha,'artifactInventory':inv,'HRead':False,'HRowsLoaded':0,'DEV_REUSED':True,'CPUTrainingCalls':calls if o['device']=='cpu' else 0,'modelAdoption':False,'generalizationClaim':False,
             'resources':{'wallSeconds':time.monotonic()-began,'cpuSeconds':u.ru_utime+u.ru_stime,'peakRssBytes':u.ru_maxrss*1024}}
    if der_meta is not None:receipt['derivedFeatures']=der_meta
    pin=C.publish_new(out/'receipt.json',receipt);C.publish_new(out/'complete.json',{'schema':'AUTOLOOP_WORKER_COMPLETE/1','receiptSha256':pin,'requestSha256':a.request_sha,'status':receipt['status']})
    progress('COMPLETED',trainingCalls=calls);print(json.dumps({'status':receipt['status'],'receiptSha256':pin,'trainingCalls':calls}))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--request',required=True);ap.add_argument('--request-sha',required=True);ap.add_argument('--package-sha',required=True);args=ap.parse_args()
    try:main(args)
    except (Exception,KeyboardInterrupt) as e:print(json.dumps({'status':'STOPPED_NOT_ACCEPTED','reason':C.safe_reason(e),'automaticRetry':False}));raise SystemExit(1)
