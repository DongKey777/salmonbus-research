"""Exercise evaluate.py end to end on the staged two-shard test root: every model kind as champion through FINAL mode,
plus a tampered pod prediction that must stop before H is opened. Uses only test copies; the real mirror is not touched."""
import json,os,shutil,subprocess,sys
from pathlib import Path
import numpy as np
A=Path(__file__).resolve().parents[1];SRC=A/'tests/root-happy';ROOT=A/'tests/root-hfinal';OUT=A/'tests/hfinal-out'
MIRROR=A.parent.parent/'volume-mirror-20261021/R/salmonbus-full-v1/outputs';RB=A.parent/'ml-research/route-balance-impl-v1'
for d in (ROOT,OUT):
    if d.exists():shutil.rmtree(d.relative_to(Path.cwd()) if d.is_relative_to(Path.cwd()) else d)
shutil.copytree(SRC,ROOT,copy_function=os.link);OUT.mkdir()
os.link(MIRROR/'SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy',ROOT/'outputs/SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy')
W=ROOT/'outputs/AUTOLOOP_900/worker'
bad=W/'SQ_D6.dev-s-pred.npy';x=np.load(bad);os.unlink(bad);x[17]+=0.5;np.save(W/'SQ_TAMPER.dev-s-pred.npy',x);os.link(SRC/'outputs/AUTOLOOP_900/worker/SQ_D6.dev-s-pred.npy',bad)
ref={'modelId':'SEAT.V2_D8','spec':{'kind':'XGB','head':'SEAT','features':'ALL','blocks':'NONE','objective':'reg:squarederror','params':{'max_depth':8,'eta':0.1},'rounds':1024},'files':{'pooled':'SEAT_FEATURES_V2_002/worker/V2_D8.model.json'},'podDevPred':'SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy'}
cases=[]
for cand in ('BLK_D4','LIN_BLK','LIN','Q_D6','HUB_D6','ABS_D6','SQ_D6','SQ_TAMPER'):
    real=cand if cand!='SQ_TAMPER' else 'SQ_D6';r=json.loads((W/(real+'.recipe.json')).read_bytes())
    names={'pooled':real+'.model.json','linear':real+'.linear.json'};files={k:'AUTOLOOP_900/worker/'+names.get(k,real+'.'+k+'.model.json') for k in r['artifactSha256']}
    ch={'modelId':'SEAT.AUTOLOOP_900_'+cand,'spec':r['spec'],'files':files,'podDevSPred':'AUTOLOOP_900/worker/'+cand+'.dev-s-pred.npy','ledgerDevSMAE':None}
    job={'mode':'FINAL','mirror':'/m','artifacts':'/m/outputs','out':'/o/'+cand,'common':'/pkg/common.py','champion':ch,'reference':ref,'podRouteTrainSupportRows':None,'tolerance':{'maxAbsDiff':0.01,'MAE':1e-4},'hDays':['2026-10-13','2026-10-15','2026-10-18','2026-10-19'],'testShardLimit':2}
    (OUT/(cand+'.job.json')).write_text(json.dumps(job));cases.append(cand)
script='set -e;dpkg -i /rb/.debs-linux-aarch64/libgomp1_14.2.0-19_arm64.deb >/dev/null 2>&1;python -m venv /tmp/v >/dev/null;/tmp/v/bin/pip install --quiet --no-index --find-links /rb/.wheels-linux-aarch64 numpy==2.4.4 pyarrow==24.0.0 scipy==1.18.1;/tmp/v/bin/pip install --quiet --no-index --no-deps --find-links /rb/.wheels-linux-aarch64 xgboost==3.4.1;set +e;'+''.join(f'/tmp/v/bin/python -B /h/evaluate.py /o/{c}.job.json > /o/{c}.stdout 2> /o/{c}.stderr; echo {c} $? >> /o/rc.txt;' for c in cases)
p=subprocess.run(['docker','run','--rm','--network','none','-v',f'{ROOT}:/m:ro','-v',f'{A/"hfinal"}:/h:ro','-v',f'{A/"pkg"}:/pkg:ro','-v',f'{RB}:/rb:ro','-v',f'{OUT}:/o','python:3.12-slim','sh','-c',script],capture_output=True,text=True)
rc=dict(l.split() for l in (OUT/'rc.txt').read_text().splitlines());ok=True
for c in cases:
    d=OUT/c;opened=(d/'h-opening.json').exists();final=(d/'h-final.json').exists();rep=json.loads((d/'reproduction.json').read_bytes()) if (d/'reproduction.json').exists() else None
    if c=='SQ_TAMPER':good=rc[c]=='2' and rep and rep['passed'] is False and not opened and not final
    else:
        h=json.loads((d/'h-final.json').read_bytes()) if final else None
        good=rc[c]=='0' and rep['passed'] and rep['results']['champion']['maxAbsDiff']<1e-5 and opened and h and h['HRead'] and h['test'] and h['population']['rows']>0 and h['championVsProductCI95']['MAE'][0]<=h['championVsProductCI95']['MAE'][1]
        if h:print(c,'H rows',h['population']['rows'],'blocks',h['population']['blocks'],'champion MAE %.3f ref %.3f product %.3f'%(h['champion']['MAE'],h['reference']['MAE'],h['product']['MAE']),'repro max %.2e'%rep['results']['champion']['maxAbsDiff'])
    print(('PASS ' if good else 'FAIL ')+c,'rc',rc[c]);ok&=bool(good)
    if not good:print((d.parent/(c+'.stderr')).read_text()[-1500:])
print('ALL_PASS' if ok else 'SOME_FAIL');sys.exit(0 if ok else 1)
