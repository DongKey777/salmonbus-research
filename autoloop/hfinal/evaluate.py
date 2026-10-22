"""Sealed-H final evaluation (runs offline in the pinned CPU container). Pass 1 keeps DEV_S rows only and proves the champion
artifacts reproduce the pod's DEV_S predictions and ledger MAE; only then pass 2 keeps H rows and scores the champion against
the V2_D8 reference and the stored product forecasts. Writes h-final.json once.
usage: evaluate.py <job.json>"""
import json,math,os,sys,time,types
from pathlib import Path
import numpy as np,pyarrow as pa,pyarrow.parquet as pq,xgboost as xgb
J=json.loads(Path(sys.argv[1]).read_bytes());MR=Path(J['mirror']);OUT=Path(J['out']);ART=Path(J['artifacts']);LIMIT=J.get('testShardLimit')
C=types.ModuleType('c');C.__file__=J['common'];exec(compile(Path(J['common']).read_bytes(),'common.py','exec'),C.__dict__);need=C.need
def man(k):
    p=MR/C.PIN_PATH[k];b=p.read_bytes();need(C.sha_bytes(b)==C.PIN_SHA[k],'PIN:'+k);return json.loads(b),p.parent
M={k:man(k) for k in C.PIN_SHA};feats=M['features'][0]['featureNames']+M['stopDemand'][0]['featureNames'];need(len(feats)==32,'FEATURES')
def progress(phase,**kw):C.replace_json(OUT/'progress.json',{'phase':phase,'at':time.time(),**kw})
def load_model(spec,files):
    if spec['kind']=='LINEAR':return {'linear':json.loads((ART/files['linear']).read_bytes())}
    b=xgb.Booster();b.load_model(str(ART/files['pooled']));b.set_param({'nthread':os.cpu_count()})
    blocks={}
    for k,f in files.items():
        if k.startswith('block-'):bb=xgb.Booster();bb.load_model(str(ART/f));bb.set_param({'nthread':os.cpu_count()});blocks[int(k[6:])]=bb
    return {'pooled':b,'blocks':blocks}
def cols_of(spec):
    f=spec['features']
    if isinstance(f,list):return [feats.index(x) for x in f]
    return {'ALL':list(range(32)),'NO_ROUTE':[i for i,x in enumerate(feats) if x!=C.ROUTE_FEATURE],'NO_STOP':[i for i,x in enumerate(feats) if x not in C.STOP_FEATURES],'BASE6':list(range(6))}[f]
def bkeys(X):
    route=X[:,feats.index(C.ROUTE_FEATURE)].astype(np.int64);hb=np.searchsorted(np.array(C.HORIZON_EDGES,'f8'),np.nan_to_num(X[:,feats.index(C.HORIZON_FEATURE)],nan=0),side='right');return route*16+hb
def lin_pred(m,X):
    mu=np.array(m['mean']);Mc=m['missingCols'];coef=np.array(m['coef'])
    D=np.concatenate([np.ones((len(X),1)),np.where(np.isnan(X),mu,X).astype('f8'),np.isnan(X[:,Mc]).astype('f8') if Mc else np.zeros((len(X),0))],axis=1);return (D@coef).astype('<f4')
def predict(model,spec,X):
    cols=cols_of(spec);names=[feats[i] for i in cols];Xc=np.ascontiguousarray(X[:,cols])
    if spec['kind']=='LINEAR':
        p=lin_pred(model['linear']['pooled'],Xc);bk=bkeys(X)
        for k,lm in model['linear']['blocks'].items():
            r=np.nonzero(bk==int(k))[0]
            if len(r):p[r]=lin_pred(lm,Xc[r])
        return p
    def one(b,Xs):
        p=b.predict(xgb.DMatrix(Xs,feature_names=names))
        if spec['objective']=='reg:quantileerror' and p.ndim==2:p=p[:,spec['quantileAlphas'].index(0.5)]
        return p.astype('<f4')
    p=one(model['pooled'],Xc)
    if model['blocks']:
        bk=bkeys(X)
        for k,bm in model['blocks'].items():
            r=np.nonzero(bk==k)[0]
            if len(r):p[r]=one(bm,Xc[r])
    return p
def scan(code,models):
    s7,s8,s9,s14=(M[k][0]['splits']['DEV']['shards'][:LIMIT] for k in ('dataset','features','stopDemand','devSplit'))
    keep_all=[];acc={k:[] for k in ('y','w','day','hour','route','prod','prodFull')};preds={n:[] for n in models};total=0
    for i,(a,b,c9,d) in enumerate(zip(s7,s8,s9,s14)):
        raws={}
        for key,sh in (('dataset',a),('features',b),('stopDemand',c9),('devSplit',d)):
            raw=(M[key][1]/sh['path']).read_bytes();need(C.sha_bytes(raw)==sh['sha256'],'SHARD_PIN:'+key);raws[key]=raw
        ta,tb,tc,td=(pq.read_table(pa.BufferReader(raws[k])) for k in ('dataset','features','stopDemand','devSplit'))
        s=ta['sample_id'].to_numpy();need(all(np.array_equal(s,t['sample_id'].to_numpy()) for t in (tb,tc,td)),'JOIN')
        keep=td['split'].to_numpy()==code;keep_all.append(keep);total+=len(s);n=int(keep.sum())
        X=np.empty((n,32),'<f4')
        for j,f in enumerate(M['dataset'][0]['featureNames']):X[:,j]=ta[f].to_numpy(zero_copy_only=False)[keep]
        side=M['features'][0]['featureNames'][6:]
        for j,f in enumerate(side):X[:,6+j]=tb[f].to_numpy(zero_copy_only=False)[keep].astype('<f4')
        for j,f in enumerate(M['stopDemand'][0]['featureNames']):X[:,6+len(side)+j]=tc[f].to_numpy(zero_copy_only=False)[keep].astype('<f4')
        acc['y'].append(ta['observed_seats'].to_numpy()[keep].astype('<i4'));acc['w'].append(1.0/ta['weight_denominator'].to_numpy()[keep].astype('<f8'))
        acc['day'].append(td['service_day'].to_numpy()[keep]);acc['hour'].append(td['kst_hour'].to_numpy()[keep]);acc['route'].append(X[:,feats.index(C.ROUTE_FEATURE)].astype(np.int64))
        acc['prod'].append(tb['prod_expected_seats'].to_numpy(zero_copy_only=False)[keep].astype('<f4'));acc['prodFull'].append(tb['prod_full_chance'].to_numpy(zero_copy_only=False)[keep].astype('<f4'))
        for nm,(model,spec) in models.items():preds[nm].append(predict(model,spec,X))
        if i%16==0:progress('SCAN_%d'%code,shard=i+1,shards=len(s7))
    need(LIMIT is not None or total==C.DEV_ROWS,'DEV_ROWS')
    return {k:np.concatenate(v) for k,v in acc.items()},{k:np.concatenate(v) for k,v in preds.items()},np.concatenate(keep_all)
def evaluator(a,support):
    y=a['y'];yf=y.astype('f8');wd=a['w'];W=float(wd.sum());route=a['route'];unseen=support[route]==0;fullbus=y==0;NR=64
    ub,binv=np.unique(a['day'].astype(np.int64)*100+a['hour'].astype(np.int64),return_inverse=True);B=len(ub)
    def stats(p):
        p=p.astype('f8');e_=np.abs(p-yf);er=np.abs(np.rint(np.clip(p,0,70))-yf)
        return {'W':np.bincount(binv,wd,B),'AE':np.bincount(binv,wd*e_,B),'SE':np.bincount(binv,wd*(p-yf)**2,B),'O10':np.bincount(binv,wd*(er>=10),B),'O5':np.bincount(binv,wd*(er>=5),B),'IN1':np.bincount(binv,wd*(er<=1),B),'IN2':np.bincount(binv,wd*(er<=2),B),'EX':np.bincount(binv,wd*(er==0),B),
            'FW':np.bincount(binv,wd*fullbus,B),'FU2':np.bincount(binv,wd*(fullbus&(p<2)),B),'NFU2':np.bincount(binv,wd*(~fullbus&(p<2)),B),'UW':np.bincount(binv,wd*unseen,B),'UAE':np.bincount(binv,wd*unseen*e_,B),
            'RW':np.bincount(binv*NR+route,wd,B*NR).reshape(B,NR),'RAE':np.bincount(binv*NR+route,wd*e_,B*NR).reshape(B,NR)}
    def point(st):
        S=lambda k:st[k].sum();rw=st['RW'].sum(0);ra=st['RAE'].sum(0);rm=float(np.mean([ra[r]/rw[r] for r in range(NR) if rw[r]>0]))
        return {'MAE':float(S('AE')/S('W')),'RMSE':math.sqrt(float(S('SE')/S('W'))),'routeMacroMAE':rm,'unseenRouteMAE':float(S('UAE')/S('UW')) if S('UW')>0 else None,'over10Share':float(S('O10')/S('W')),'over5Share':float(S('O5')/S('W')),
                'within1Share':float(S('IN1')/S('W')),'within2Share':float(S('IN2')/S('W')),'exactShare':float(S('EX')/S('W')),'fullBusUnder2Share':float(S('FU2')/S('FW')) if S('FW')>0 else None,'notFullUnder2Share':float(S('NFU2')/(S('W')-S('FW')))}
    boot=np.random.default_rng(C.GATE['seed']).integers(0,B,size=(C.GATE['resamples'],B))
    def resampled(st):
        S=lambda k:st[k][boot].sum(axis=1);rw=st['RW'][boot].sum(axis=1);ra=st['RAE'][boot].sum(axis=1)
        with np.errstate(invalid='ignore',divide='ignore'):return {'MAE':S('AE')/S('W'),'routeMacroMAE':np.nanmean(np.where(rw>0,ra/rw,np.nan),axis=1),'unseenRouteMAE':S('UAE')/S('UW'),'over10Share':S('O10')/S('W'),'fullBusUnder2Share':S('FU2')/S('FW')}
    def ci(x):x=x[np.isfinite(x)];return [float(np.quantile(x,0.025)),float(np.quantile(x,0.975))] if len(x) else None
    def brier(p):t=fullbus.astype('f8');return float((wd*(p.astype('f8')-t)**2).sum()/W)
    return stats,point,resampled,ci,brier,{'rows':int(len(y)),'weightSum':W,'blocks':int(B)}
def main():
    OUT.mkdir(mode=0o700,exist_ok=False)
    ch=J['champion'];ref=J['reference'];progress('TRAIN_ROUTE_SUPPORT')
    support=np.zeros(64,'i8')
    for sh in M['features'][0]['splits']['TRAIN']['shards'][:LIMIT]:
        raw=(M['features'][1]/sh['path']).read_bytes();need(C.sha_bytes(raw)==sh['sha256'],'SHARD_PIN:TRAIN_FEATURES')
        support+=np.bincount(pq.read_table(pa.BufferReader(raw),columns=[C.ROUTE_FEATURE])[C.ROUTE_FEATURE].to_numpy(zero_copy_only=False).astype(np.int64),minlength=64)
    need(LIMIT is not None or int(support.sum())==C.TRAIN_ROWS,'TRAIN_ROWS');pod=J['podRouteTrainSupportRows'];need(pod is None or pod==support[:len(pod)].tolist(),'ROUTE_SUPPORT_MATCHES_POD')
    models={'CHAMPION':(load_model(ch['spec'],ch['files']),ch['spec'])}
    if ref['modelId']!=ch['modelId']:models['REFERENCE']=(load_model(ref['spec'],ref['files']),ref['spec'])
    progress('PASS1_DEV_S')
    a,p,keep=scan(C.DEV_SPLIT_CODE,models);need(LIMIT is not None or len(a['y'])==C.DEV_S_ROWS,'DEV_S_ROWS')
    stats,point,resampled,ci,brier,info=evaluator(a,support)
    pod_ch=np.load(ART/ch['podDevSPred']);pod_ch=pod_ch[:len(keep)][keep] if pod_ch.shape==(C.DEV_ROWS,) else pod_ch;need(pod_ch.shape==p['CHAMPION'].shape,'POD_CHAMPION_SHAPE')
    pod_ref=np.load(ART/ref['podDevPred']);need(pod_ref.shape==(C.DEV_ROWS,),'POD_REFERENCE_SHAPE')
    repro={'champion':{'maxAbsDiff':float(np.max(np.abs(pod_ch.astype('f8')-p['CHAMPION']))),'localMAE':point(stats(p['CHAMPION']))['MAE'],'podMAE':point(stats(pod_ch))['MAE'],'ledgerMAE':ch['ledgerDevSMAE']}}
    if 'REFERENCE' in p:repro['reference']={'maxAbsDiff':float(np.max(np.abs(pod_ref[:len(keep)][keep].astype('f8')-p['REFERENCE']))),'localMAE':point(stats(p['REFERENCE']))['MAE'],'podMAE':point(stats(pod_ref[:len(keep)][keep]))['MAE']}
    tol=J['tolerance'];ok=all(r['maxAbsDiff']<=tol['maxAbsDiff'] and abs(r['localMAE']-r['podMAE'])<=tol['MAE'] for r in repro.values()) and (ch['ledgerDevSMAE'] is None or abs(repro['champion']['podMAE']-ch['ledgerDevSMAE'])<=1e-9)
    C.publish_new(OUT/'reproduction.json',{'schema':'AUTOLOOP_H_REPRODUCTION/1','tolerance':tol,'results':repro,'routeTrainSupport':support[:20].tolist(),'passed':bool(ok),'HRead':False})
    if not ok:progress('REPRODUCTION_FAILED');print(json.dumps({'status':'REPRODUCTION_FAILED','reproduction':repro}));raise SystemExit(2)
    if J['mode']=='REPRODUCE_ONLY':progress('REPRODUCED');print(json.dumps({'status':'REPRODUCED','reproduction':repro}));return
    del a,p;C.publish_new(OUT/'h-opening.json',{'schema':'AUTOLOOP_H_OPENING/1','at':time.time(),'champion':ch['modelId']})
    progress('PASS2_H')
    a,p,keep=scan(2,models)
    stats,point,resampled,ci,brier,info=evaluator(a,support)
    pod_ref_h=np.load(ART/ref['podDevPred'])[:len(keep)][keep]
    if 'REFERENCE' not in p:p['REFERENCE']=p['CHAMPION']
    p['PRODUCT']=a['prod']
    st={k:stats(v) for k,v in p.items()};pt={k:point(v) for k,v in st.items()};bs={k:resampled(v) for k,v in st.items()}
    delta=lambda x,y:{k:ci(bs[x][k]-bs[y][k]) for k in bs[x]}
    res={'schema':'AUTOLOOP_H_FINAL/1','split':'H','days':J['hDays'],'population':info,'champion':{'modelId':ch['modelId'],**pt['CHAMPION']},'reference':{'modelId':ref['modelId'],**pt['REFERENCE']},'product':{**pt['PRODUCT'],'fullChanceBrier':brier(a['prodFull'])},
         'championVsReferenceCI95':delta('CHAMPION','REFERENCE') if ref['modelId']!=ch['modelId'] else None,'championVsProductCI95':delta('CHAMPION','PRODUCT'),'referenceVsProductCI95':delta('REFERENCE','PRODUCT'),
         'pointDelta':{'championMinusReference':pt['CHAMPION']['MAE']-pt['REFERENCE']['MAE'],'championMinusProduct':pt['CHAMPION']['MAE']-pt['PRODUCT']['MAE']},
         'bootstrap':{'blocks':'service day x KST hour','resamples':C.GATE['resamples'],'seed':C.GATE['seed']},'reproduction':repro,'referencePodPredictionsOnH':{'MAE':point(stats(pod_ref_h))['MAE'],'maxAbsDiffToLocal':float(np.max(np.abs(pod_ref_h.astype('f8')-p['REFERENCE'])))},'runtime':{'xgboost':xgb.__version__,'numpy':np.__version__,'pyarrow':pa.__version__,'device':'cpu'},
         'HRead':True,'HOpenedOnce':True,'modelAdoption':False,'test':LIMIT is not None}
    C.publish_new(OUT/'h-final.json',res);progress('COMPLETED');print(json.dumps({'status':'COMPLETED','championMAE':pt['CHAMPION']['MAE'],'referenceMAE':pt['REFERENCE']['MAE'],'productMAE':pt['PRODUCT']['MAE']}))
main()
