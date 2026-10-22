"""Derive lifecycle/parent v(N+1) for one autonomous-loop run from the latest consumed vN.
Only run-specific values change: run id, candidate count and names, predecessor pod, scope, nonce, inputs folder, release checks.
The first derivation from v9 also switches the package to autoloop/pkg and the request to autoloop/runs/<run>/REQUEST.json.
After writing, it runs the lifecycle tests and both rehearsals; the run is ready only when all pass.
usage: make_run.py <prev-version> <run-id> <experiment.json>"""
import hashlib,json,os,re,subprocess,sys,types
from pathlib import Path
A=Path(__file__).resolve().parents[1];T=A.parent;C=T/'full-pipeline-v1/control';PKG=A/'pkg'
sha=lambda b:hashlib.sha256(b).hexdigest();canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
STATUS='AUTOLOOP_TRAINED_AND_DEV_S_SCORED_NOT_ADOPTED';ENFORCER='PINNED_AUTOLOOP_RUNNER_REQUEST'
def need(ok,code):
    if not ok:raise SystemExit('MAKE_RUN_REFUSED:'+code)
def xb(p,b):
    p.parent.mkdir(parents=True,exist_ok=True)
    with open(p,'xb') as f:f.write(b if isinstance(b,bytes) else b.encode())
def sub1(text,pattern,repl,name,count=1,flags=0):
    new,n=re.subn(pattern,repl,text,flags=flags)
    need(n==count if count else n>=1,'PATTERN:%s:%s:%d'%(name,pattern[:50],n));return new
def lit(s):return s.replace('\\','\\\\')
USED_MARKERS=('batch-authorization.json','runner-ready.json','preflight.json','start-intent.json','owned-pod.json','watchdog-armed.json')
def clean_unused(paths):
    import shutil
    for p in paths:
        if p.is_dir():
            need(not any((p/m).exists() for m in USED_MARKERS),'REFUSE_CLEAN_USED:'+p.name);shutil.rmtree(p)
        elif p.exists():p.unlink()
def main(prev,run_id,spec_path):
    try:return generate(prev,run_id,spec_path)
    except BaseException:
        n=prev+1;clean_unused([C/f'learning-batch-lifecycle-v{n}',C/f'learning-batch-parent-v{n}',A/'runs'/run_id/'REQUEST.json'])
        raise
def generate(prev,run_id,spec_path):
    n=prev+1;Lp=C/f'learning-batch-lifecycle-v{prev}';Pp=C/f'learning-batch-parent-v{prev}';Ln=C/f'learning-batch-lifecycle-v{n}';Pn=C/f'learning-batch-parent-v{n}'
    need(re.fullmatch('AUTOLOOP_[0-9]{3}',run_id),'RUN_ID');need(not Ln.exists() and not Pn.exists(),'TARGET_EXISTS')
    if (Lp/'owned-pod.json').exists():
        rel=json.loads((Lp/'released.json').read_bytes());pod=json.loads((Lp/'owned-pod.json').read_bytes())['podId'];need(rel['verified'] is True and rel['podId']==pod and rel['providerState']=='EXITED','PREV_RELEASE')
    else:
        sr=json.loads((Lp/'start-result.json').read_bytes());recs=sorted(Lp.glob('create-reconcile-*.json'),key=lambda q:int(q.stem.rsplit('-',1)[1]))
        need(sr.get('podId') is None and (sr.get('result') or {}).get('outcome')=='HTTP_REJECTED' and len(recs)>=3 and all(json.loads(r.read_bytes()).get('matchCount')==0 and json.loads(r.read_bytes()).get('podId') is None for r in recs[-3:]),'PREV_NOT_CREATED_UNPROVEN')
        pod=None
    cm=types.ModuleType('c');cm.__file__=str(PKG/'common.py');exec(compile((PKG/'common.py').read_bytes(),'common.py','exec'),cm.__dict__)
    spec=json.loads(Path(spec_path).read_bytes());names=[c['candidate'] for c in spec['candidates']];calls=len(names)
    pkg=(PKG/'PACKAGE.json').read_bytes();pkg_sha=sha(pkg);cm.verify_package(pkg_sha)
    state=json.loads((A/'state.json').read_bytes());ch=state['champion']
    tmpl=json.loads((PKG/'REQUEST.template.json').read_bytes());tmpl['experiment']=spec;tmpl['runId']=None;tmpl['champion']={'modelId':ch['modelId'],'predictions':ch['predictions'],'scope':ch['scope']}
    cm.validate_champion(tmpl['champion'])
    rq_dir=A/'runs'/run_id;rq=rq_dir/'REQUEST.json';xb(rq,json.dumps(tmpl,indent=1,sort_keys=True)+'\n');rq_sha=sha(rq.read_bytes())
    out_root='/workspace/salmonbus-full-v1/outputs/'+run_id;nonce=os.urandom(8).hex()
    # lifecycle
    code=(Lp/'lifecycle.py').read_text();plan=json.loads((Lp/'batch-plan.json').read_bytes())
    prev_pods=sorted(set(plan['previousPodIds'])|({pod} if pod else set()));plan.update(batchScopeId=f'learning-batch-v{n}',planNonce=nonce,uniqueName=f'salmonbus-learning-v{n}-'+nonce,previousPodIds=prev_pods)
    plan['createBody']['name']=plan['uniqueName'];plan['createBodySha256']=sha(canonical(plan['createBody']))
    plan['experimentPolicy'].update(runId=run_id,outputRoot=out_root,requestedMaximumTrainingCalls=calls,trainingLimitEnforcer=ENFORCER);plan['experimentPolicySha256']=sha(canonical(plan['experimentPolicy']))
    pb=(json.dumps(plan,indent=2,sort_keys=True)+'\n').encode();xb(Ln/'batch-plan.json',pb)
    old_set=re.search(r"PREVIOUS_PODS=frozenset\(\{([^}]*)\}\)",code).group(0);new_set="PREVIOUS_PODS=frozenset({"+",".join("'%s'"%p for p in prev_pods)+"})"
    old_run=re.search(r"binding\['runId'\]==policy\['runId'\]=='([A-Z0-9_]+)'",code).group(1)
    code=sub1(code,r"SCOPE='learning-batch-v\d+'",f"SCOPE='learning-batch-v{n}'",'scope')
    code=sub1(code,r"PLAN_SHA='[0-9a-f]{64}'","PLAN_SHA='"+sha(pb)+"'",'plan')
    code=code.replace(old_set,new_set)
    code=sub1(code,r"policy\['requestedMaximumTrainingCalls'\]==\d+","policy['requestedMaximumTrainingCalls']==%d"%calls,'calls')
    code=sub1(code,r"binding\['runId'\]==policy\['runId'\]=='[A-Z0-9_]+' and binding\['outputRoot'\]==policy\['outputRoot'\]=='[^']+'",lit(f"binding['runId']==policy['runId']=='{run_id}' and binding['outputRoot']==policy['outputRoot']=='{out_root}'"),'binding')
    xb(Ln/'lifecycle.py',code);xb(Ln/'stop_reliability.py',(Lp/'stop_reliability.py').read_bytes())
    old_sorted=sorted(set(plan['previousPodIds'])-{pod})
    for t in ('test_support.py','test_create.py','test_stop_integration.py','test_review_fixes.py',f'test_v{prev}_policy.py'):
        x=(Lp/t).read_text().replace(f'learning-batch-v{prev}',f'learning-batch-v{n}').replace(f'salmonbus-learning-v{prev}-',f'salmonbus-learning-v{n}-').replace(old_set.split('=',1)[1],new_set.split('=',1)[1])
        if t.endswith('_policy.py'):
            x=sub1(x,r"RUN='[A-Z0-9_]+';OUT='[^']+'",f"RUN='{run_id}';OUT='{out_root}'",'test-run')
            x=x.replace(repr(old_sorted).replace(' ',''),repr(prev_pods).replace(' ',''))
            x=sub1(x,r"\(new\['experimentPolicy'\]\['requestedMaximumTrainingCalls'\],new\['experimentPolicy'\]\['trainingLimitEnforcer'\]\),\(\d+,'[A-Z0-9_]+'\)",f"(new['experimentPolicy']['requestedMaximumTrainingCalls'],new['experimentPolicy']['trainingLimitEnforcer']),({calls},'{ENFORCER}')",'test-calls')
        xb(Ln/t.replace(f'v{prev}',f'v{n}'),x)
    ct=(Lp/'contracts.json').read_text();p_old=json.loads((Lp/'batch-plan.json').read_bytes())
    for a_,b_ in ((sha((Lp/'lifecycle.py').read_bytes()),sha(code.encode())),(sha((Lp/'batch-plan.json').read_bytes()),sha(pb)),(p_old['planNonce'],nonce),(p_old['createBodySha256'],plan['createBodySha256']),(p_old['experimentPolicySha256'],plan['experimentPolicySha256']),(f'learning-batch-v{prev}',f'learning-batch-v{n}'),(f'salmonbus-learning-v{prev}-',f'salmonbus-learning-v{n}-'),(old_run,run_id)):ct=ct.replace(a_,b_)
    ct=re.sub(r'"requestedMaximumTrainingCalls": \d+','"requestedMaximumTrainingCalls": %d'%calls,ct);ct=re.sub(r'"trainingLimitEnforcer": "[A-Z_]+"','"trainingLimitEnforcer": "%s"'%ENFORCER,ct)
    cj=json.loads(ct)
    def fix(o):
        if isinstance(o,dict):
            for k,v in list(o.items()):
                if k=='previousPodIds' and isinstance(v,list):o[k]=prev_pods
                elif k=='previousPodStatuses' and isinstance(v,dict):o[k]={i:'EXITED_OR_TERMINATED_OR_ABSENT' for i in prev_pods}
                else:fix(v)
        elif isinstance(o,list):[fix(x) for x in o]
    fix(cj);xb(Ln/'contracts.json',json.dumps(cj,indent=2,ensure_ascii=False)+'\n')
    # parent
    releases=[]
    for k in range(4,n):
        rp=C/f'learning-batch-lifecycle-v{k}/released.json'
        if rp.exists():r_=json.loads(rp.read_bytes());need(r_['verified'] is True and r_['providerState']=='EXITED','RELEASE_V%d'%k);releases.append((k,r_['podId']))
    pf=(Pp/'pod_flow.py').read_text()
    pf=sub1(pf,r'"""Parent v\d+ pod-side sequence\.',f'"""Parent v{n} pod-side sequence.','pf-doc')
    pf=sub1(pf,r"inputs=RS\.R\+'/control/[^']+'",lit(f"inputs=RS.R+'/control/autoloop-inputs-{run_id.lower()}'"),'pf-inputs')
    pf=sub1(pf,r"rt=RS\.R\+'/runtime/[^']+'",lit(f"rt=RS.R+'/runtime/autoloop-pkg-{pkg_sha[:12]}'"),'pf-runtime')
    pf=sub1(pf,r"rc\.get\('value',\{\}\)\.get\('status'\)=='[A-Z0-9_]+'",f"rc.get('value',{{}}).get('status')=='{STATUS}'",'pf-status')
    rs=(Pp/'remote_stages.py').read_text()
    rs=sub1(rs,r'by parent v\d+\.',f'by parent v{n}.','rs-doc');rs=sub1(rs,r"LAUNCH='/opt/[^']+'",f"LAUNCH='/opt/salmonbus-autoloop-launch-v{n}'",'rs-launch')
    rs=sub1(rs,r"names=\[[^\n]*\n","names=['receipt.json','complete.json','run-start.json','failure.json','worker/receipt.json','worker/complete.json','worker/progress.json','worker/metrics.json','worker/diagnostics.json']+['worker/'+m+'.'+k+'.json' for m in "+repr(tuple(names))+" for k in ('recipe','decision')]\n",'rs-names')
    eb=(Pp/'execute_batch.py').read_text()
    eb=sub1(eb,r'^"""Parent v\d+: one owned pod for [A-Z0-9_]+\. Run only after prepare_context\.py and an armed v\d+ watchdog\."""',f'"""Parent v{n}: one owned pod for {run_id}. Run only after prepare_context.py and an armed v{n} watchdog."""','eb-doc',flags=re.M)
    eb=sub1(eb,r"L=C/'learning-batch-lifecycle-v\d+'",f"L=C/'learning-batch-lifecycle-v{n}'",'eb-L')
    eb=sub1(eb,r"\nS=T/'[^']+'(\nRQ=T/'[^']+')?",lit(f"\nS=T/'autoloop/pkg'\nRQ=T/'autoloop/runs/{run_id}/REQUEST.json'"),'eb-S')
    eb=sub1(eb,r"RUN_ID='[A-Z0-9_]+';OUTPUT_ROOT='[^']+'",lit(f"RUN_ID='{run_id}';OUTPUT_ROOT='{out_root}'"),'eb-run')
    eb=sub1(eb,r"'PARENT_V\d+_FALLBACK_'",f"'PARENT_V{n}_FALLBACK_'",'eb-fallback')
    if "pinned(S/'REQUEST.false.json',PINS['package']['REQUEST.false.json'])" in eb:eb=eb.replace("pinned(S/'REQUEST.false.json',PINS['package']['REQUEST.false.json'])","pinned(RQ,PINS['request']['sha256'])")
    need("pinned(RQ,PINS['request']['sha256'])" in eb,'eb-request')
    pc=(Pp/'prepare_context.py').read_text()
    pc=sub1(pc,r'"""Parent v\d+ preflight',f'"""Parent v{n} preflight','pc-doc')
    pc=sub1(pc,r"L=C/'learning-batch-lifecycle-v\d+'",f"L=C/'learning-batch-lifecycle-v{n}'",'pc-L')
    pc=sub1(pc,r"\nS=T/'[^']+'(\nRQ=T/'[^']+')?",lit(f"\nS=T/'autoloop/pkg'\nRQ=T/'autoloop/runs/{run_id}/REQUEST.json'"),'pc-S')
    pc=sub1(pc,r"PREVIOUS=\([^)]*\)","PREVIOUS=("+",".join("'%s'"%p for p in prev_pods)+")",'pc-previous')
    pc=sub1(pc,r"'LIFECYCLE_V\d+_ALREADY_USED:'",f"'LIFECYCLE_V{n}_ALREADY_USED:'",'pc-used')
    pc=sub1(pc,r"    guards=\[[^\n]*\n",f"    guards=[guard_inactive('learning-batch-lifecycle-v%d'%k,'lifecycle.py') for k in range({n-1},0,-1)]\n",'pc-guards')
    if re.search(r"\n    RELEASES=\[",pc):pc=sub1(pc,r"\n    RELEASES=\[[^\n]*\]\n","\n    RELEASES="+repr(releases)+"\n",'pc-releases-update')
    else:pc=sub1(pc,r"(    rel\d*=json\.loads\([^\n]*\n)+","    RELEASES="+repr(releases)+"\n    for k_,pod_ in RELEASES:\n        r_=json.loads((C/('learning-batch-lifecycle-v%d/released.json'%k_)).read_bytes());assert r_['verified'] is True and r_['podId']==pod_ and r_['providerState']=='EXITED','PREDECESSOR_RELEASE:%d'%k_\n",'pc-releases')
    pc=sub1(pc,r"'v4ReleaseVerified':True[^}]*\}","'releasesVerified':[k_ for k_,_ in RELEASES]}",'pc-guardrecord') if "'v4ReleaseVerified'" in pc else pc
    pc=pc.replace("    for n,h in pins['package'].items():pin(S/n,h)\n","    for n,h in pins['package'].items():pin(S/n,h)\n    pin(RQ,pins['request']['sha256'])\n") if "pin(RQ,pins['request']['sha256'])" not in pc else pc
    pc=pc.replace("q=json.loads((S/'REQUEST.false.json').read_bytes())","q=json.loads(RQ.read_bytes())")
    pc=pc.replace("'baselineModelSha256':q['pins']['baselineModel']['sha256'],'sequence':q['sequence']","'championModelId':q['champion']['modelId'],'championPredictionsSha256':q['champion']['predictions']['sha256'],'experiment':q['experiment']")
    need("q=json.loads(RQ.read_bytes())" in pc and "'championPredictionsSha256':q['champion']['predictions']['sha256'],'experiment':q['experiment']" in pc,'pc-request')
    m=re.search(r"'previousAttempts':\[(.*?)\]",pc);need(m is not None,'pc-attempts')
    pc=pc[:m.end()-1]+","+repr(f'previous lifecycle v{prev} pod {pod} released and verified EXITED')+pc[m.end()-1:]
    pc=re.sub(r"'batchScopeId':'learning-batch-v\d+'",f"'batchScopeId':'learning-batch-v{n}'",pc)
    lr=(Pp/'launch_run.py').read_text();lr=sub1(lr,r'"""Parent v\d+ launcher:',f'"""Parent v{n} launcher:','lr-doc');lr=sub1(lr,r"L=\(C/'learning-batch-lifecycle-v\d+'\)\.resolve\(\)",f"L=(C/'learning-batch-lifecycle-v{n}').resolve()",'lr-L')
    for fn,txt in (('pod_flow.py',pf),('remote_stages.py',rs),('execute_batch.py',eb),('prepare_context.py',pc),('launch_run.py',lr),('reconstruct_outputs.py',(Pp/'reconstruct_outputs.py').read_text())):xb(Pn/fn,txt)
    pins=json.loads((Pp/'expected-pins.json').read_bytes())
    pins['lifecycle']={k:sha((Ln/k).read_bytes()) for k in ('lifecycle.py','stop_reliability.py','batch-plan.json')}
    pins['package']={'PACKAGE.json':pkg_sha};pins['request']={'path':str(rq),'sha256':rq_sha}
    stops=sorted([p_ for p_ in Lp.glob('stop-result-*.json') if json.loads(p_.read_bytes()).get('verified') is True],key=lambda p_:p_.stat().st_mtime);need(stops,'PREV_VERIFIED_STOP_RESULT')
    pins['priorStopResult']={'path':str(stops[-1]),'sha256':sha(stops[-1].read_bytes())};xb(Pn/'expected-pins.json',json.dumps(pins,sort_keys=True,indent=1)+'\n')
    old_status=re.search(r"rc\.get\('value',\{\}\)\.get\('status'\)=='([A-Z0-9_]+)'",(Pp/'pod_flow.py').read_text()).group(1)
    old_run_parent=re.search(r"RUN_ID='([A-Z0-9_]+)'",(Pp/'execute_batch.py').read_text()).group(1)
    R8=Pp/'rehearsal';xb(Pn/'rehearsal/fake_env.py',(R8/'fake_env.py').read_text())
    rh=(R8/'rehearse.py').read_text().replace(old_status,STATUS).replace(old_run_parent,run_id)
    rh=re.sub(r"'schema':'[A-Z0-9_]+_RECEIPT/1'","'schema':'AUTOLOOP_RECEIPT/1'",rh);rh=re.sub(r"'schema':'[A-Z0-9_]+_COMPLETE/1'","'schema':'AUTOLOOP_COMPLETE/1'",rh);rh=re.sub(r"'schema':'[A-Z0-9_]+_PROGRESS/1'","'schema':'AUTOLOOP_PROGRESS/1'",rh)
    xb(Pn/'rehearsal/rehearse.py',rh)
    lrh=(R8/'lifecycle_rehearse.py').read_text().replace(f'learning-batch-lifecycle-v{prev}',f'learning-batch-lifecycle-v{n}').replace(f'learning-batch-parent-v{prev}',f'learning-batch-parent-v{n}')
    lrh=sub1(lrh,r"for v in \(([^)]*)\):",lambda mm:"for v in ("+",".join("'v%d'"%k for k in range(1,n))+"):",'lr-guards')
    lrh=sub1(lrh,r"    cp\(C/'learning-batch-lifecycle-v4/released\.json'[^\n]*\n",lambda mm:"    "+";".join("cp(C/'learning-batch-lifecycle-v%d/released.json',MC/'learning-batch-lifecycle-v%d/released.json')"%(k,k) for k,_ in releases)+"\n",'lr-releases')
    lrh=sub1(lrh,r"    S=MT/'[^']+';S\.mkdir\(parents=True\)","    S=MT/'autoloop/pkg';S.mkdir(parents=True)",'lr-S')
    if "RQm=MT/'autoloop/runs/" in lrh:lrh=sub1(lrh,r"    RQm=MT/'autoloop/runs/AUTOLOOP_[0-9]{3}/REQUEST\.json';cp\(T/'autoloop/runs/AUTOLOOP_[0-9]{3}/REQUEST\.json',RQm\)\n",lit(f"    RQm=MT/'autoloop/runs/{run_id}/REQUEST.json';cp(T/'autoloop/runs/{run_id}/REQUEST.json',RQm)\n"),'lr-request-update')
    else:lrh=sub1(lrh,r"    cp\(T/'[^']+REQUEST[^']*',S/'REQUEST[^']*'\)\n",lit(f"    RQm=MT/'autoloop/runs/{run_id}/REQUEST.json';cp(T/'autoloop/runs/{run_id}/REQUEST.json',RQm)\n"),'lr-request')
    if "'package':{'PACKAGE.json':sha((S/'PACKAGE.json').read_bytes())}" not in lrh:lrh=sub1(lrh,r"'package':\{n:sha\(\(S/n\)\.read_bytes\(\)\) for n in \([^)]*\)\}","'package':{'PACKAGE.json':sha((S/'PACKAGE.json').read_bytes())},'request':{'path':str(RQm),'sha256':sha(RQm.read_bytes())}",'lr-pins')
    lrh=sub1(lrh,r"for i in \(([^)]*)\)\}",lambda mm:"for i in ("+",".join("'%s'"%p for p in prev_pods)+")}",'lr-pods')
    xb(Pn/'rehearsal/lifecycle_rehearse.py',lrh)
    report={'lifecycle':str(Ln),'parent':str(Pn),'runId':run_id,'calls':calls,'predecessor':pod,'previousPods':prev_pods,'request':{'path':str(rq),'sha256':rq_sha},'packageSha256':pkg_sha,'estimatedUSD':cm.estimate_usd(spec)}
    gates={}
    t=subprocess.run([sys.executable,'-B','-m','unittest','test_create','test_stop_integration','test_review_fixes',f'test_v{n}_policy'],cwd=Ln,capture_output=True,text=True,timeout=900)
    gates['lifecycleTests']={'exit':t.returncode,'tail':t.stderr.strip().splitlines()[-1] if t.stderr.strip() else ''}
    r1=subprocess.run([sys.executable,'-B','rehearse.py','rehearsal.json'],cwd=Pn/'rehearsal',capture_output=True,text=True,timeout=1800)
    r2=subprocess.run([sys.executable,'-B','lifecycle_rehearse.py','lifecycle-rehearsal.json'],cwd=Pn/'rehearsal',capture_output=True,text=True,timeout=2400)
    gates['dockerRehearsal']={'exit':r1.returncode,'pass':json.loads((Pn/'rehearsal/rehearsal.json').read_bytes()).get('pass') if (Pn/'rehearsal/rehearsal.json').exists() else False}
    gates['lifecycleRehearsal']={'exit':r2.returncode,'pass':json.loads((Pn/'rehearsal/lifecycle-rehearsal.json').read_bytes()).get('pass') if (Pn/'rehearsal/lifecycle-rehearsal.json').exists() else False}
    report['gates']=gates;report['ready']=gates['lifecycleTests']['exit']==0 and gates['dockerRehearsal']['pass'] is True and gates['lifecycleRehearsal']['pass'] is True
    xb(rq_dir/'make-run-report.json',json.dumps(report,indent=1)+'\n');print(json.dumps(report))
    return 0 if report['ready'] else 1
if __name__=='__main__':raise SystemExit(main(int(sys.argv[1]),sys.argv[2],sys.argv[3]))
