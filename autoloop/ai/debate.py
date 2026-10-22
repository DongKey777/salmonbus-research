"""Two-party cross-review (Stage C) of the autoloop: an author writes an artifact (an experiment plan, or a judge decision) and a reviewer critiques it.
Protocol: draft -> review -> revision -> re-review, at most max_round_trips rounds (one author call, then one reviewer call if the artifact is valid).
The run stops AGREED as soon as a well-formed review has zero blocking items. It stops DEADLOCK when blocking items remain after the cap (CAP_REACHED),
when a re-review repeats exactly the previous blocking item ids (REPEATED_BLOCKING), or when a review is malformed (REVIEW_MALFORMED).
Evidence rule: a blocking objection must cite a checklist rule id, a JSON path into the context ($.a.b[0]; it must resolve to a scalar or lie below the top level),
or ledger:<runId>:<metric> (a context record with that runId must contain the metric key); otherwise it is downgraded to non-blocking and logged.
The author answers every blocking item with ACCEPT (and changes the artifact) or REBUT (reason + citation); code checks the answers and shows its findings to the reviewer.
validate_artifact(artifact) -> list of errors: a failing (or malformed) author output becomes the blocking item VALIDATION, is not sent to the reviewer,
and the author is re-asked in the next round of the same budget; still invalid at the cap -> AUTHOR_INVALID.
Independence: the first review sees only checklist, context and artifact; a re-review sees the checklist, the earlier review, the author's per-item answers,
the code checks, the changes since the reviewed version (path, before, after) and the revised artifact. Every call is fresh and carries only the counterpart's visible text (no prior thinking).
Prompt size: all JSON is compact. The full context goes only into a first review; the author's own system/initial user text is expected to carry the data, and revision and
re-review prompts carry context_digest (str or JSON) if given, else a short reference to the context, never the full context again.
Anonymity: model names and AI self-references are scrubbed from every prompt; the parties are 'the proposal' and 'the review'.
Budget: before each call the run stops BUDGET if spent + estimate would exceed max_total_usd (estimate = cost_estimates[role] or the cost of the previous call
of that role, else 0); an author call in round >= 2 must also leave the reviewer estimate (at least min_call_usd), so a revision is never bought without its re-review;
each call gets max_usd = min(max_call_usd, remaining) and below min_call_usd the run stops BUDGET; cost = meta.costUSD, else meta.chargedUSD, else max_usd.
GatewayRefused (matched by class name) -> REFUSED; any other exception is charged the same way from its .meta, persisted with status ERROR and re-raised. Only an AGREED artifact is approved; 'artifact' otherwise holds the latest valid, unapproved one.
Calls are injected per role: call(*, role, model, effort, system, user, schema, max_usd, run_id, purpose) -> (output dict, meta dict with costUSD).
persist(record) receives a JSON-safe copy of the whole record after every step (overwrite semantics)."""
import hashlib,json,math,re
from pathlib import Path
try:from .checklists import BY_KIND
except ImportError:
    import importlib.util as _iu
    _s=_iu.spec_from_file_location('autoloop_ai_checklists',Path(__file__).with_name('checklists.py'));_m=_iu.module_from_spec(_s);_s.loader.exec_module(_m);BY_KIND=_m.BY_KIND
ITEM_ID='^[A-Z][A-Z0-9_]{0,15}$'
REVIEW_SCHEMA={'type':'object','additionalProperties':False,'required':['verdict','summary','items'],'properties':{
 'verdict':{'enum':['APPROVE','REVISE']},'summary':{'type':'string'},
 'items':{'type':'array','items':{'type':'object','additionalProperties':False,'required':['itemId','severity','citations','objection','requestedChange'],'properties':{
  'itemId':{'type':'string','pattern':ITEM_ID},'severity':{'enum':['BLOCKING','NON_BLOCKING']},'citations':{'type':'array','items':{'type':'string'}},
  'objection':{'type':'string'},'requestedChange':{'type':'string'}}}}}}
RESPONSE_ITEM_SCHEMA={'type':'object','additionalProperties':False,'required':['itemId','action','reason','citation'],'properties':{
 'itemId':{'type':'string'},'action':{'enum':['ACCEPT','REBUT']},'reason':{'type':'string'},'citation':{'type':'string'}}}
def author_output_schema(artifact_schema):
    return {'type':'object','additionalProperties':False,'required':['artifact','responses'],'properties':{'artifact':artifact_schema,'responses':{'type':'array','items':RESPONSE_ITEM_SCHEMA}}}
STATUSES=('AGREED','DEADLOCK','BUDGET','AUTHOR_INVALID','REFUSED')
WHAT={'design':'an experiment plan (the next experiment of the loop)','judge':'a judge decision on a finished experiment run'}
CITATION_FORMS='a checklist rule id (e.g. %s), a JSON path into CONTEXT starting with $ (e.g. $.ledger[0].status; it must resolve to a single value or to an element below the top level), or ledger:<runId>:<metric> (a CONTEXT record with that runId must contain that metric)'
_FAMILY=re.compile(r'(?<![A-Za-z0-9])(?:claude|anthropic|opus|sonnet|haiku|fable|openai|chatgpt|gpt|codex|gemini|llama|mistral|deepseek|qwen|grok)(?:[-_.:]?[A-Za-z0-9])*|클로드|앤트로픽|오퍼스|소네트|소넷|하이쿠|페이블|오픈AI|챗GPT|지피티|코덱스|제미나이',re.I)
_AI=r'(?:AI (?:model|assistant)|artificial intelligence|(?:large )?language model|LLM|AI|assistant)'
_SELF=[(re.compile(r"\b(?:as|being) an? "+_AI+r"\b",re.I),'[redacted]'),(re.compile(r"\bI(?:'m| am) an? "+_AI+r"\b",re.I),'[redacted]'),
       (re.compile(r'\b(?:my|our) (earlier|previous|original|first|prior) (proposal|draft|plan|decision|review|answer|version)\b',re.I),r'the \1 \2'),
       (re.compile(r'\b(?:my|our) (proposal|draft|plan|decision|review|answer)\b',re.I),r'the \1'),(re.compile(r'(?:AI|인공지능|언어 ?모델)\s?(?:으로서|로서)'),'[redacted]')]
def scrubber(model_names):
    exact=[re.compile(r'(?<![\w-])'+re.escape(m)+r'(?![\w-])',re.I) for m in sorted({m for m in model_names if m},key=len,reverse=True)]
    def scrub(text):
        for p in exact:text=p.sub('[redacted]',text)
        text=_FAMILY.sub('[redacted]',text)
        for p,r in _SELF:text=p.sub(r,text)
        return text
    return scrub
def _j(o):return json.dumps(o,ensure_ascii=False,separators=(',',':'),default=str)
def _sha(o):return hashlib.sha256((o if isinstance(o,str) else json.dumps(o,ensure_ascii=False,sort_keys=True,separators=(',',':'),default=str)).encode()).hexdigest()
_TOK=re.compile(r'\.([^.\[\]]+)|\[(\d+)\]|\[\'([^\']*)\'\]|\["([^"]*)"\]')
_LEDGER=re.compile(r'^ledger:([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+)$')
def _keys(o,acc):
    if isinstance(o,dict):
        for k,v in o.items():acc.add(str(k));_keys(v,acc)
    elif isinstance(o,list):
        for v in o:_keys(v,acc)
    return acc
class Citations:
    def __init__(self,context,rule_ids):self.ctx=context;self.ids={i.upper() for i in rule_ids};self._runs=None
    def _path(self,p):
        if not p.startswith('$'):return False
        i,cur,depth=1,self.ctx,0
        while i<len(p):
            m=_TOK.match(p,i)
            if not m:return False
            if m.group(2) is not None:
                k=int(m.group(2))
                if not isinstance(cur,list) or k>=len(cur):return False
            else:
                k=next(g for g in (m.group(1),m.group(3),m.group(4)) if g is not None)
                if not isinstance(cur,dict) or k not in cur:return False
            cur=cur[k];depth+=1;i=m.end()
        return depth>=2 or (depth==1 and not isinstance(cur,(dict,list)))
    def _ledger(self,run,metric):
        if self._runs is None:
            self._runs={}
            def walk(o):
                if isinstance(o,dict):
                    if isinstance(o.get('runId'),str):self._runs.setdefault(o['runId'],set()).update(_keys(o,set()))
                    for v in o.values():walk(v)
                elif isinstance(o,list):
                    for v in o:walk(v)
            walk(self.ctx)
        ks=self._runs.get(run);return bool(ks) and all(s in ks for s in metric.split('.'))
    def _one(self,c):
        if c.upper() in self.ids:return True
        m=_LEDGER.match(c);return self._ledger(m.group(1),m.group(2)) if m else self._path(c)
    def valid(self,c):
        if not isinstance(c,str) or not c.strip():return None
        if self._one(c.strip()):return c.strip()
        return next((t for t in re.split(r'[\s,;()]+',c) if t and self._one(t)),None)
def _public(it):return {k:it[k] for k in ('itemId','severity','citations','objection','requestedChange','downgraded') if k in it}
def _norm_review(out,rnd,cite,dg):
    if not isinstance(out,dict) or out.get('verdict') not in ('APPROVE','REVISE') or not isinstance(out.get('items'),list):return None
    blocking,non,seen=[],[],set()
    for n,it in enumerate(out['items'],1):
        if not isinstance(it,dict):return None
        iid=it.get('itemId') if isinstance(it.get('itemId'),str) and re.fullmatch(ITEM_ID,it['itemId']) else 'X%d'%n
        iid='R_VALIDATION' if iid=='VALIDATION' else iid;base,k=iid,2
        while iid in seen:iid='%s_%d'%(base,k);k+=1
        seen.add(iid);cs=it.get('citations');cs=[cs] if isinstance(cs,str) else [c for c in cs if isinstance(c,str)] if isinstance(cs,list) else []
        good=[g for g in map(cite.valid,cs) if g]
        item={'itemId':iid,'severity':'NON_BLOCKING' if it.get('severity')=='NON_BLOCKING' else 'BLOCKING','citations':cs,'validCitations':good,
              'objection':str(it.get('objection','')),'requestedChange':str(it.get('requestedChange',''))}
        if item['severity']=='BLOCKING' and not good:
            item.update(severity='NON_BLOCKING',downgraded='NO_VALID_CITATION');dg.append({'round':rnd,'itemId':iid,'citations':cs,'reason':'NO_VALID_CITATION'})
        (blocking if item['severity']=='BLOCKING' else non).append(item)
    return {'verdict':out['verdict'],'summary':str(out.get('summary','')),'blocking':blocking,'nonBlocking':non}
def _norm_author(out):
    if not isinstance(out,dict) or not isinstance(out.get('artifact'),dict):return None,[],['AUTHOR_OUTPUT_SHAPE: the output must be an object whose field "artifact" is an object']
    rs=out.get('responses');return out['artifact'],[r for r in rs if isinstance(r,dict)] if isinstance(rs,list) else [],[]
def _validate(fn,art):
    if fn is None:return []
    try:errs=fn(art)
    except Exception as e:return ['%s: %s'%(type(e).__name__,e)]
    if errs is None:return []
    if not isinstance(errs,(list,tuple)):raise TypeError('validate_artifact must return a list of errors')
    return [str(e) for e in errs]
def _check_responses(open_items,known,rs,cite,changed):
    by,viol={},[]
    for r in rs:
        i=r.get('itemId')
        if not isinstance(i,str):continue
        if i in by:viol.append({'itemId':i,'code':'DUPLICATE_RESPONSE'})
        else:by[i]=r
    for it in open_items:
        i=it['itemId'];r=by.get(i);a=r.get('action') if r else None
        if r is None:viol.append({'itemId':i,'code':'MISSING_RESPONSE'})
        elif a=='REBUT' and not cite.valid(r.get('citation')):viol.append({'itemId':i,'code':'UNCITED_REBUT'})
        elif a=='ACCEPT' and not changed:viol.append({'itemId':i,'code':'ACCEPT_WITHOUT_CHANGE'})
        elif a not in ('ACCEPT','REBUT'):viol.append({'itemId':i,'code':'BAD_ACTION'})
    return viol+[{'itemId':i,'code':'UNKNOWN_ITEM'} for i in by if i not in known]
def _diff(a,b,p='proposal',out=None):
    out=[] if out is None else out
    if isinstance(a,dict) and isinstance(b,dict):
        for k in sorted(set(a)|set(b),key=str):
            q='%s.%s'%(p,k)
            if k in a and k in b:_diff(a[k],b[k],q,out)
            else:out.append({'path':q,**({'before':a[k]} if k in a else {}),**({'after':b[k]} if k in b else {})})
    elif isinstance(a,list) and isinstance(b,list) and len(a)==len(b):
        for n,(x,y) in enumerate(zip(a,b)):_diff(x,y,'%s[%d]'%(p,n),out)
    elif a!=b:out.append({'path':p,'before':a,'after':b})
    return out
def _refused(e):return any(c.__name__=='GatewayRefused' for c in type(e).__mro__)
def _num(c):return isinstance(c,(int,float)) and not isinstance(c,bool) and math.isfinite(c) and c>=0
def _cost(meta,mx):
    m=meta if isinstance(meta,dict) else {}
    return float(next((m[k] for k in ('costUSD','chargedUSD') if _num(m.get(k))),mx))
def reviewer_system(kind,checklist):
    return ('You review %s in an autonomous experiment loop that improves a bus remaining-seat forecaster. Models are scored on the development split DEV_S by weighted MAE '
     'and are promoted only through a paired block-bootstrap gate against the current CHAMPION. You critique the proposal; you do not rewrite it.\nRules:\n'
     '1. Judge only against the CHECKLIST and the CONTEXT. Do not assume facts that are not in them.\n'
     '2. Mark an item BLOCKING only if the proposal must change before it can be used; everything else is NON_BLOCKING.\n'
     '3. Every BLOCKING item must list evidence in citations: %s. A BLOCKING item without a valid citation is automatically downgraded to NON_BLOCKING.\n'
     '4. verdict APPROVE means zero BLOCKING items; REVISE means at least one.\n'
     '5. itemId is a short uppercase id such as B1. In a re-review, reuse the itemId of an earlier item that is still unresolved and give a new itemId to a new issue. The id VALIDATION is reserved.\n'
     '6. Authorship is withheld. Evaluate the content only and do not speculate about who or what wrote it.\n'
     '7. Write in English. Output only JSON that matches the schema.')%(WHAT[kind],CITATION_FORMS%checklist[min(2,len(checklist)-1)]['id'])
def run(*,kind,context,author_system,author_schema,initial_author_user,validate_artifact,author_call,reviewer_call,author_model,reviewer_model,
        author_effort='high',reviewer_effort='medium',max_round_trips=2,max_total_usd,run_id,persist=None,checklist=None,max_call_usd=1.0,min_call_usd=0.01,cost_estimates=None,roles=('author','reviewer'),context_digest=None):
    if kind not in BY_KIND:raise ValueError('kind must be design or judge')
    if not isinstance(max_round_trips,int) or max_round_trips<1:raise ValueError('max_round_trips must be >= 1')
    cl=list(checklist or BY_KIND[kind]);cite=Citations(context,[r['id'] for r in cl]);scrub=scrubber([author_model,reviewer_model]);persist=persist or (lambda o:None)
    a_schema=author_output_schema(author_schema);r_system=reviewer_system(kind,cl);cl_txt='\n'.join('- %s: %s'%(r['id'],r['rule']) for r in cl);ctx_txt=_j(context)
    keys=' (top-level keys: %s)'%', '.join(map(str,context)) if isinstance(context,dict) and context else ''
    if context_digest is None:
        a_ctx='CONTEXT\nNot repeated here: it is the data given with the request above%s. Citation paths refer to it.'%keys
        r_ctx='CONTEXT\nNot repeated here: it is the same object the earlier review was given%s. Citation paths refer to it and are checked by code.'%keys
    else:
        dg=context_digest if isinstance(context_digest,str) else _j(context_digest)
        a_ctx='CONTEXT DIGEST (a summary; the full CONTEXT is the data given with the request above and citation paths refer to it)\n'+dg
        r_ctx='CONTEXT DIGEST (a summary; the full CONTEXT was given to the earlier review, citation paths refer to it and are checked by code)\n'+dg
    rec={'schema':'AUTOLOOP_DEBATE/1','runId':run_id,'kind':kind,'status':None,'reason':None,'artifact':None,'rounds':0,'transcript':[],'costUSD':0.0,'downgraded':[],'openBlocking':[],
         'contextSha256':_sha(context),'contextDigestSha256':None if context_digest is None else _sha(context_digest),'checklist':[r['id'] for r in cl],'config':{'authorModel':author_model,'reviewerModel':reviewer_model,'authorEffort':author_effort,
         'reviewerEffort':reviewer_effort,'maxRoundTrips':max_round_trips,'maxTotalUSD':max_total_usd,'maxCallUSD':max_call_usd,'costEstimates':cost_estimates}}
    seen={'author':[],'reviewer':[]}
    def snap():persist(json.loads(json.dumps(rec,ensure_ascii=False,default=str)))
    def abort(msg):rec.update(status='ERROR',reason=msg,costUSD=round(rec['costUSD'],6));snap()
    def finish(status,reason,open_items=()):
        rec.update(status=status,reason=reason,openBlocking=list(open_items),costUSD=round(rec['costUSD'],6));snap();return rec
    def estimate(side):
        v=(cost_estimates or {}).get(side);return float(v) if v is not None else seen[side][-1] if seen[side] else 0.0
    def call(side,rnd,system,user,schema):
        fn,model,effort=(author_call,author_model,author_effort) if side=='author' else (reviewer_call,reviewer_model,reviewer_effort)
        est=estimate(side);res=max(estimate('reviewer'),min_call_usd) if side=='author' and rnd>1 else 0.0;mx=max_call_usd
        if max_total_usd is not None:
            rem=max_total_usd-rec['costUSD']
            if rem<min_call_usd or rec['costUSD']+est+res>max_total_usd+1e-9:
                rec['budgetStop']={'role':side,'round':rnd,'spentUSD':round(rec['costUSD'],6),'estimateUSD':est,**({'reviewerReserveUSD':res} if res else {}),'maxTotalUSD':max_total_usd}
                return 'BUDGET',None,None
            mx=min(max_call_usd,rem)
        system,user=scrub(system),scrub(user)
        ent={'role':side,'round':rnd,'model':model,'effort':effort,'purpose':'debate:%s:%s:r%d'%(kind,side,rnd),'maxUSD':mx,'systemSha256':_sha(system),'system':system,'user':user}
        rec['transcript'].append(ent)
        try:out,meta=fn(role=roles[0] if side=='author' else roles[1],model=model,effort=effort,system=system,user=user,schema=schema,max_usd=mx,run_id=run_id,purpose=ent['purpose'])
        except Exception as e:
            ent.update(error='%s: %s'%(type(e).__name__,e),costUSD=0.0)
            if _refused(e):return 'REFUSED',None,ent
            em=getattr(e,'meta',None);c=_cost(em,mx);ent.update(costUSD=c,meta=em,costUnknown=not _num(em.get('costUSD') if isinstance(em,dict) else None));rec['costUSD']+=c
            abort(ent['error']);raise
        c=_cost(meta,mx);ent['costUnknown']=not _num(meta.get('costUSD') if isinstance(meta,dict) else None);seen[side].append(c);rec['costUSD']+=c
        ent.update(output=out,outputSha256=_sha(out),costUSD=c,meta=meta);return 'OK',out,ent
    proposal=last_review=reviewed=val_item=None;open_items=[]
    for rnd in range(1,max_round_trips+1):
        if rnd==1:user=initial_author_user+'\n\nOUTPUT\nPut the proposal in `artifact` and leave `responses` empty.'
        else:
            ch=_diff(reviewed,proposal)[:60] if reviewed is not None and proposal is not None else []
            user=(initial_author_user+'\n\nREVISION REQUEST\nThe proposal below was checked and the items listed must be handled. Return the complete revised proposal in `artifact`. '
                  'In `responses`, answer every BLOCKING item exactly once: ACCEPT if the proposal was changed for it, or REBUT if the proposal is kept as it is for that item, '
                  'with the reason and a `citation`: '+CITATION_FORMS%cl[min(2,len(cl)-1)]['id']+'. VALIDATION items come from the mechanical validator and must be fixed. '
                  'NON_BLOCKING items are optional and need no response.\n\nCHECKLIST\n'+cl_txt+'\n\n'+a_ctx+
                  '\n\nTHE PROPOSAL (JSON)\n'+(_j(proposal) if proposal is not None else '(the previous output had no usable artifact)')+
                  ('\n\nCHANGES SINCE THE REVIEWED VERSION (JSON; path, before, after)\n'+_j(ch) if ch else '')+('\n\nREVIEW SUMMARY\n'+last_review['summary'] if last_review else '')+'\n\nBLOCKING ITEMS (JSON)\n'+_j([_public(i) for i in open_items])+
                  '\n\nNON_BLOCKING ITEMS (JSON)\n'+_j([_public(i) for i in (last_review['nonBlocking'] if last_review else [])]))
        st,out,ent=call('author',rnd,author_system,user,a_schema)
        if st!='OK':return finish(st,'BEFORE_AUTHOR_CALL' if st=='BUDGET' else 'AUTHOR_CALL_REFUSED',open_items)
        rec['rounds']=rnd;art,rs,errs=_norm_author(out)
        try:errs=errs or _validate(validate_artifact,art)
        except TypeError as e:abort('VALIDATOR: %s'%e);raise
        changed=art is not None and (proposal is None or _sha(art)!=_sha(proposal))
        known={i['itemId'] for i in (last_review['blocking']+last_review['nonBlocking'] if last_review else [])}|({'VALIDATION'} if val_item else set())
        viol=_check_responses(open_items,known,rs,cite,changed) if rnd>1 else []
        ent.update(artifactSha256=_sha(art) if art is not None else None,valid=not errs,validationErrors=errs,responses=rs,violations=viol,nonBlocking=[],
                   ignoredResponses=len(rs) if rnd==1 else 0)
        if art is not None:proposal=art
        if errs:
            val_item={'itemId':'VALIDATION','severity':'BLOCKING','citations':['VALIDATOR'],'objection':'The proposal failed mechanical validation: '+'; '.join(errs),
                      'requestedChange':'Fix every listed validation error.','errors':errs}
            ent['blocking']=[val_item];open_items=(last_review['blocking'] if last_review else [])+[val_item]
            if rnd==max_round_trips:return finish('AUTHOR_INVALID','VALIDATION_FAILED',open_items)
            snap();continue
        val_item=None;ent['blocking']=[];rec['artifact']=art;snap()
        if last_review is None:
            user='Review the proposal below.\n\nCHECKLIST\n'+cl_txt+'\n\nCONTEXT (JSON)\n'+ctx_txt+'\n\nPROPOSAL (JSON)\n'+_j(art)
        else:
            mine={i['itemId'] for i in last_review['blocking']+last_review['nonBlocking']}
            user=('Re-review the revised proposal below. It was revised after the earlier review. RESPONSES hold the answers to the earlier items: ACCEPT means the proposal was changed '
                  'for the item, REBUT means it was kept, with a reason and a citation. Decide every earlier item again on the revised proposal: drop it if it is resolved, '
                  'keep it with the same itemId if it is not. A REBUT without a valid citation is unsupported. Raise new issues only if the revision introduced them or they block use.'
                  '\n\nCHECKLIST\n'+cl_txt+'\n\n'+r_ctx+'\n\nEARLIER REVIEW (JSON)\n'+
                  _j({'summary':last_review['summary'],'items':[_public(i) for i in last_review['blocking']+last_review['nonBlocking']]})+
                  '\n\nRESPONSES (JSON)\n'+_j([{k:r.get(k) for k in ('itemId','action','reason','citation')} for r in rs if r.get('itemId') in mine])+
                  '\n\nPROTOCOL CHECKS (computed by code)\n'+_j([v for v in viol if v['itemId'] in mine])+
                  '\n\nCHANGES SINCE THE EARLIER VERSION (JSON; path, before, after)\n'+_j(_diff(reviewed,art)[:60])+'\n\nREVISED PROPOSAL (JSON)\n'+_j(art))
        st,out,ent=call('reviewer',rnd,r_system,user,REVIEW_SCHEMA)
        if st!='OK':return finish(st,'BEFORE_REVIEWER_CALL' if st=='BUDGET' else 'REVIEWER_CALL_REFUSED',last_review['blocking'] if last_review else [])
        dg=[];rv=_norm_review(out,rnd,cite,dg)
        if rv is None:ent.update(malformed=True,blocking=[],nonBlocking=[]);return finish('DEADLOCK','REVIEW_MALFORMED')
        rec['downgraded']+=dg;decision='REVISE' if rv['blocking'] else 'APPROVE'
        ent.update(reviewedArtifactSha256=_sha(art),verdict=rv['verdict'],decision=decision,verdictOverridden=decision!=rv['verdict'],summary=rv['summary'],
                   blocking=rv['blocking'],nonBlocking=rv['nonBlocking'],downgraded=dg)
        reviewed=art
        if not rv['blocking']:return finish('AGREED','APPROVED')
        repeated=last_review is not None and {i['itemId'] for i in rv['blocking']}=={i['itemId'] for i in last_review['blocking']}
        last_review=rv;open_items=list(rv['blocking'])
        if repeated:return finish('DEADLOCK','REPEATED_BLOCKING',open_items)
        snap()
    return finish('DEADLOCK','CAP_REACHED',open_items)
