"""TRAIN-only validation of proposed derived features for the autonomous loop. Loads the same deterministic sample the worker checks (every
32nd TRAIN shard of the pinned 007/013/012 datasets in the local volume mirror; manifests and shards verified by sha256), builds the 32 base
columns in the worker's order, then applies the structural DSL rules and dsl.semantic_report (finite share >= 0.5, not constant, |corr| < 0.99
with every base feature and every earlier derived feature of the candidate, float32 shape). DEV, DEV_S and H shards are never opened, so the
acceptance of a feature cannot depend on the scoring split. Optionally writes the golden parity vector of each accepted feature.
usage: validate.py <experiment.json | candidate.json | list-of-asts.json> [--limit SHARDS] [--parity-dir DIR]"""
import argparse,hashlib,json,sys,types
from pathlib import Path
A=Path(__file__).resolve().parents[1]
def _mod(n,p):m=types.ModuleType(n);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
D=_mod('features_dsl',A/'features/dsl.py')
MIRROR=A.parents[1]/'volume-mirror-20261021/R/salmonbus-full-v1'
def common():return _mod('autoloop_common',A/'pkg-next/common.py')
def _pinned(p,h):
    b=Path(p).read_bytes()
    if hashlib.sha256(b).hexdigest()!=h:raise SystemExit('PIN_MISMATCH:'+Path(p).name)
    return b
def train_sample(base=MIRROR,limit=None,C=None):
    import numpy as np,pyarrow as pa,pyarrow.parquet as pq
    C=C or common();base=Path(base)
    m={k:json.loads(_pinned(base/C.PIN_PATH[k],C.PIN_SHA[k])) for k in ('dataset','features','stopDemand')};dirs={k:(base/C.PIN_PATH[k]).parent for k in m}
    s7,s8,s9=(m[k]['splits']['TRAIN']['shards'][:limit] for k in ('dataset','features','stopDemand'))
    base6=m['dataset']['featureNames'];side=m['features']['featureNames'][6:];stop=m['stopDemand']['featureNames'];names=m['features']['featureNames']+stop
    if names!=D.BASE_FEATURES or len(s7)!=len(s8) or len(s7)!=len(s9):raise SystemExit('FEATURE_ORDER_OR_SHARDS')
    parts=[];used=[]
    for i in D.sample_shards(len(s7)):
        a,b,c=s7[i],s8[i],s9[i]
        if not (a['path']==b['path']==c['path'] and a['path'].startswith('train/') and a['rows']==b['rows']==c['rows']):raise SystemExit('SHARD_ALIGN')
        ta,tb,tc=(pq.read_table(pa.BufferReader(_pinned(dirs[k]/s['path'],s['sha256']))) for k,s in (('dataset',a),('features',b),('stopDemand',c)))
        sid=ta['sample_id'].to_numpy()
        if not (np.array_equal(sid,tb['sample_id'].to_numpy()) and np.array_equal(sid,tc['sample_id'].to_numpy())):raise SystemExit('SAMPLE_ID_JOIN')
        X=np.empty((len(sid),len(names)),'<f4')
        for j,f in enumerate(base6):X[:,j]=ta[f].to_numpy(zero_copy_only=False)
        for j,f in enumerate(side):X[:,6+j]=tb[f].to_numpy(zero_copy_only=False).astype('<f4')
        for j,f in enumerate(stop):X[:,6+len(side)+j]=tc[f].to_numpy(zero_copy_only=False).astype('<f4')
        parts.append(X);used.append(i)
    X=np.concatenate(parts);return X,names,{'role':'TRAIN','shards':used,'rows':int(len(X))}
def candidates_of(obj):
    if isinstance(obj,list):return [{'candidate':'ASTS','features':'ALL','derivedFeatures':obj}]
    return [c for c in (obj.get('candidates') or [obj]) if 'derivedFeatures' in c]
def check(cands,X,names,C=None):
    C=C or common();out={}
    for c in cands:
        errs=D.validate_list(c['derivedFeatures'],C.selected_names(c.get('features','ALL'),names))
        sem=[] if errs else D.semantic_report(X,names,c['derivedFeatures'])
        out[c['candidate']]={'ok':not errs and all(r['ok'] for r in sem),'structural':errs,'semantic':sem}
    return out
def main():
    ap=argparse.ArgumentParser();ap.add_argument('spec');ap.add_argument('--limit',type=int);ap.add_argument('--base',default=str(MIRROR));ap.add_argument('--parity-dir');a=ap.parse_args()
    C=common();X,names,info=train_sample(a.base,a.limit,C);rep=check(candidates_of(json.loads(Path(a.spec).read_bytes())),X,names,C)
    if a.parity_dir:
        d=Path(a.parity_dir);d.mkdir(parents=True,exist_ok=True)
        for c in candidates_of(json.loads(Path(a.spec).read_bytes())):
            if rep[c['candidate']]['ok']:
                for ast in c['derivedFeatures']:
                    v=D.parity_vector(ast);p=d/(v['name']+'.parity.json');b=D.parity_bytes(v)
                    if not p.exists():p.write_bytes(b)
                    elif p.read_bytes()!=b:raise SystemExit('PARITY_FILE_DIFFERS:'+p.name)
    ok=all(r['ok'] for r in rep.values());print(json.dumps({'ok':ok,'sample':info,'candidates':rep},indent=1,sort_keys=True));return 0 if ok else 1
if __name__=='__main__':sys.exit(main())
