"""Stage a small test root that mirrors the volume layout (real manifests and shard bytes, first N shards per role) from the local mirror only; no network."""
import json,os,shutil,sys
from pathlib import Path
M=Path(os.environ.get('AUTOLOOP_MIRROR_DIR') or Path(__file__).resolve().parents[3]/'volume-mirror-20261021')
O=M/'R/salmonbus-full-v1/outputs';T=Path(sys.argv[1]);LIMIT=int(sys.argv[2])
names={'dataset':'FULL_TRAIN_PREPARATION_007','features':'FULL_TRAIN_PREPARATION_013','stopDemand':'FULL_TRAIN_PREPARATION_012','devSplit':'FULL_TRAIN_PREPARATION_014'}
for key,d in names.items():
    (T/'outputs'/d/'dataset/dev').mkdir(parents=True);shutil.copy2(O/d/'dataset/dataset.json',T/'outputs'/d/'dataset/dataset.json')
    m=json.load(open(O/d/'dataset/dataset.json'))
    roles=('DEV',) if key=='devSplit' else ('TRAIN','DEV')
    for role in roles:
        (T/'outputs'/d/'dataset'/role.lower()).mkdir(parents=True,exist_ok=True)
        for s in m['splits'][role]['shards'][:LIMIT]:
            src=O/d/'dataset'/s['path'];dst=T/'outputs'/d/'dataset'/s['path']
            if not src.exists():raise SystemExit('MIRROR_SHARD_MISSING:'+d+'/'+s['path'])
            shutil.copy2(src,dst)
w=T/'outputs/SEAT_FEATURES_V2_002/worker';w.mkdir(parents=True);shutil.copy2(O/'SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy',w/'V2_D8.dev-pred.npy')
(T/'control/test-inputs').mkdir(parents=True);print('staged',T)
