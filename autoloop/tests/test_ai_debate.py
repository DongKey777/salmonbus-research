"""Tests for ai/debate.py and ai/checklists.py with scripted fake author/reviewer calls (no network, no secrets); files are written only to temp dirs.
Run: python3 -m pytest -q tests/test_ai_debate.py   or   python3 tests/test_ai_debate.py"""
import copy,importlib.util,json,re,sys,tempfile
from pathlib import Path
A=Path(__file__).resolve().parents[1]
def _load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
D=_load('autoloop_ai_debate',A/'ai/debate.py');CL=_load('autoloop_ai_checklists_t',A/'ai/checklists.py')
class GatewayRefused(Exception):pass
class Fake:
    def __init__(self,*outs,costs=0.1):self.outs=list(outs);self.calls=[];self.costs=costs
    def __call__(self,**kw):
        self.calls.append(kw);o=self.outs.pop(0)
        if isinstance(o,BaseException):raise o
        c=self.costs.pop(0) if isinstance(self.costs,list) else self.costs
        return copy.deepcopy(o),({'costUSD':c} if c is not None else {})
CTX={'runId':'AUTOLOOP_002','policy':{'planner':{'model':'claude-opus-5-5','basis':'cheaper than Fable 5.1'}},'searchSpace':{'rounds':[16,4096]},
     'ledger':[{'runId':'AUTOLOOP_001','status':'COMPLETED','candidates':[{'spec':{'candidate':'ABS_D8_E03_R1024'},'final':{'MAE':2.05}}]}],'consecutiveNoImprovement':1}
ART={'id':'EXP_A','hypothesis':'L1 objective lowers MAE (corpus of 4 days)','candidates':[{'candidate':'ABS_D8_E03_R1024','objective':'reg:absoluteerror','rounds':1024}]}
ART2={**ART,'candidates':[{**ART['candidates'][0],'rounds':512}]}
BAD={**ART,'candidates':[{**ART['candidates'][0],'rounds':5000}]}
def validate(a):return [] if a.get('candidates') and all(c.get('rounds',0)<=4096 for c in a['candidates']) else ['ROUNDS_OUT_OF_RANGE']
def au(art,*responses):return {'artifact':art,'responses':list(responses)}
def rv(verdict,*items):return {'verdict':verdict,'summary':'review summary','items':list(items)}
def it(iid,sev='BLOCKING',cites=('D2',),obj='rounds too high'):return {'itemId':iid,'severity':sev,'citations':list(cites),'objection':obj,'requestedChange':'lower rounds'}
def resp(iid,action='ACCEPT',reason='done',citation=''):return {'itemId':iid,'action':action,'reason':reason,'citation':citation}
def go(author,reviewer,**kw):
    snaps=[];args=dict(kind='design',context=CTX,author_system='SYSTEM: you design experiments.',author_schema={'type':'object'},initial_author_user='Design the next experiment.',
        validate_artifact=validate,author_call=author,reviewer_call=reviewer,author_model='claude-opus-5-5',reviewer_model='gpt-5.5-codex',max_total_usd=5.0,run_id='AUTOLOOP_002',persist=snaps.append)
    args.update(kw);return D.run(**args),snaps
def ids(items):return [i['itemId'] for i in items]
def test_checklists():
    for lst,pre,n in ((CL.DESIGN_CHECKLIST,'D',8),(CL.JUDGE_CHECKLIST,'J',7)):
        assert [r['id'] for r in lst]==['%s%d'%(pre,i) for i in range(1,n+1)]
        assert all(set(r)=={'id','rule'} and len(r['rule'])>60 and r['rule'].isascii() for r in lst)
    assert CL.BY_KIND['design'] is CL.DESIGN_CHECKLIST and CL.BY_KIND['judge'] is CL.JUDGE_CHECKLIST
def test_approve_first_review():
    a=Fake(au(ART));r=Fake(rv('APPROVE'),costs=0.05);res,snaps=go(a,r)
    assert (res['status'],res['reason'],res['rounds'],len(a.calls),len(r.calls))==('AGREED','APPROVED',1,1,1)
    assert res['artifact']==ART and abs(res['costUSD']-0.15)<1e-9 and [e['role'] for e in res['transcript']]==['author','reviewer']
    u=r.calls[0]['user'];assert all(('- D%d:'%i) in u for i in range(1,9)) and 'ABS_D8_E03_R1024' in u and 'RESPONSES' not in u and 'EARLIER REVIEW' not in u
    assert snaps[-1]['status']=='AGREED' and all(len(e['outputSha256'])==64 for e in snaps[-1]['transcript'])
def test_revise_then_approve():
    a=Fake(au(ART),au(ART2,resp('B1',citation='')));r=Fake(rv('REVISE',it('B1',obj='rounds 1024 wastes budget')),rv('APPROVE'));res,_=go(a,r)
    assert (res['status'],res['rounds'],len(a.calls),len(r.calls))==('AGREED',2,2,2) and res['artifact']==ART2
    au2=a.calls[1]['user'];assert 'REVISION REQUEST' in au2 and 'rounds 1024 wastes budget' in au2 and '"itemId":"B1"' in au2 and 'review summary' in au2
    re2=r.calls[1]['user'];assert 'EARLIER REVIEW' in re2 and 'RESPONSES' in re2 and 'proposal.candidates[0].rounds' in re2 and '"action":"ACCEPT"' in re2
    assert '{"path":"proposal.candidates[0].rounds","before":1024,"after":512}' in re2 and 'CHANGES SINCE THE REVIEWED VERSION' not in au2
    assert res['transcript'][2]['violations']==[]
def test_deadlock_repeated_ids():
    a=Fake(au(ART),au(ART,resp('B1','REBUT','rounds is in range','$.searchSpace.rounds')),au(ART))
    r=Fake(rv('REVISE',it('B1')),rv('REVISE',it('B1',obj='still too many rounds')),rv('APPROVE'));res,_=go(a,r,max_round_trips=3)
    assert (res['status'],res['reason'],len(a.calls),len(r.calls))==('DEADLOCK','REPEATED_BLOCKING',2,2) and ids(res['openBlocking'])==['B1']
    assert res['transcript'][2]['violations']==[]
def test_cap_reached():
    a=Fake(au(ART),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1')),rv('REVISE',it('B2',cites=['D8'],obj='new issue')));res,_=go(a,r)
    assert (res['status'],res['reason'],res['rounds'],len(a.calls),len(r.calls))==('DEADLOCK','CAP_REACHED',2,2,2) and ids(res['openBlocking'])==['B2'] and res['artifact']==ART2
def test_uncited_blocking_downgraded():
    a=Fake(au(ART));r=Fake(rv('REVISE',it('B1',cites=[]),it('B2',cites=['$.ledger[7].status','D99','the ledger','$.ledger']),it('N1','NON_BLOCKING',cites=[])));res,_=go(a,r)
    assert (res['status'],len(a.calls),len(r.calls))==('AGREED',1,1) and ids(res['downgraded'])==['B1','B2'] and all(d['reason']=='NO_VALID_CITATION' for d in res['downgraded'])
    e=res['transcript'][1];assert e['verdictOverridden'] and e['decision']=='APPROVE' and e['blocking']==[] and ids(e['nonBlocking'])==['B1','B2','N1']
def test_citation_forms():
    items=[it('C1',cites=['ledger:AUTOLOOP_001:MAE']),it('C2',cites=['ledger:AUTOLOOP_999:MAE']),it('C3',cites=['ledger:AUTOLOOP_001:RMSE']),it('C4',cites=['see $.ledger[0].candidates[0].final.MAE']),
           it('C5',cites=['$.ledger[0].final']),it('C6',cites=['$.consecutiveNoImprovement']),it('C7',cites=['d5']),it('C8',cites=['J1']),it('C9',cites=["$.ledger[0]['status']"])]
    res,_=go(Fake(au(ART)),Fake(rv('APPROVE',*items)),max_round_trips=1)
    assert (res['status'],res['reason'])==('DEADLOCK','CAP_REACHED') and ids(res['openBlocking'])==['C1','C4','C6','C7','C9'] and ids(res['downgraded'])==['C2','C3','C5','C8']
    assert res['transcript'][1]['verdictOverridden']
def test_validation_failure_forces_revision():
    a=Fake(au(BAD),au(ART,resp('VALIDATION')));r=Fake(rv('APPROVE'));res,_=go(a,r)
    assert (res['status'],res['rounds'],len(a.calls),len(r.calls))==('AGREED',2,2,1) and res['artifact']==ART
    t=res['transcript'];assert [e['role'] for e in t]==['author','author','reviewer'] and ids(t[0]['blocking'])==['VALIDATION'] and not t[0]['valid']
    assert 'VALIDATION' in a.calls[1]['user'] and 'ROUNDS_OUT_OF_RANGE' in a.calls[1]['user'] and '"rounds":5000' in a.calls[1]['user']
    assert 'EARLIER REVIEW' not in r.calls[0]['user']
def test_validation_never_fixed_is_author_invalid():
    a=Fake(au(BAD),au(BAD,resp('VALIDATION')));r=Fake();res,_=go(a,r)
    assert (res['status'],res['reason'],len(a.calls),len(r.calls),res['artifact'])==('AUTHOR_INVALID','VALIDATION_FAILED',2,0,None) and ids(res['openBlocking'])==['VALIDATION']
def test_malformed_author_output_and_raising_validator():
    a=Fake({'oops':1},au(ART));r=Fake(rv('APPROVE'));res,_=go(a,r)
    assert res['status']=='AGREED' and 'AUTHOR_OUTPUT_SHAPE' in res['transcript'][0]['validationErrors'][0] and 'no usable artifact' in a.calls[1]['user']
    def boom(x):raise KeyError('candidates')
    res,_=go(Fake(au(ART)),Fake(),validate_artifact=boom,max_round_trips=1)
    assert res['status']=='AUTHOR_INVALID' and res['transcript'][0]['validationErrors']==["KeyError: 'candidates'"]
def test_validation_after_review_keeps_review_items():
    a=Fake(au(ART),au(BAD,resp('B1')),au(ART2,resp('B1'),resp('VALIDATION')));r=Fake(rv('REVISE',it('B1')),rv('APPROVE'));res,_=go(a,r,max_round_trips=3)
    assert (res['status'],len(a.calls),len(r.calls))==('AGREED',3,2)
    u=a.calls[2]['user'];assert '"itemId":"B1"' in u and '"itemId":"VALIDATION"' in u
    assert '{"path":"proposal.candidates[0].rounds","before":1024,"after":5000}' in u.split('CHANGES SINCE THE REVIEWED VERSION',1)[1] and 'CHANGES SINCE THE REVIEWED VERSION' not in a.calls[1]['user']
    assert 'EARLIER REVIEW' in r.calls[1]['user'] and 'proposal.candidates[0].rounds' in r.calls[1]['user']
def test_budget_stop():
    a=Fake(au(ART),au(ART2),costs=[0.3,0.3]);r=Fake(rv('REVISE',it('B1')),costs=[0.15]);res,_=go(a,r,max_total_usd=0.5)
    assert (res['status'],res['reason'],len(a.calls),len(r.calls))==('BUDGET','BEFORE_AUTHOR_CALL',1,1) and abs(res['costUSD']-0.45)<1e-9
    assert a.calls[0]['max_usd']==0.5 and abs(r.calls[0]['max_usd']-0.2)<1e-9 and res['budgetStop']['estimateUSD']==0.3 and res['artifact']==ART
    res,_=go(Fake(),Fake(),max_total_usd=0.0);assert (res['status'],res['transcript'])==('BUDGET',[])
    res,_=go(Fake(),Fake(),max_total_usd=0.5,cost_estimates={'author':0.6});assert res['status']=='BUDGET' and res['rounds']==0
def test_budget_precheck_reserves_reviewer_before_author_revision():
    a=Fake(au(ART),au(ART2,resp('B1')),costs=[0.3,0.3]);r=Fake(rv('REVISE',it('B1')),rv('APPROVE'),costs=[0.3,0.3]);res,_=go(a,r,max_total_usd=1.0)
    assert (res['status'],res['reason'],res['rounds'],len(a.calls),len(r.calls))==('BUDGET','BEFORE_AUTHOR_CALL',1,1,1) and abs(res['costUSD']-0.6)<1e-9
    assert res['budgetStop']=={'role':'author','round':2,'spentUSD':0.6,'estimateUSD':0.3,'reviewerReserveUSD':0.3,'maxTotalUSD':1.0} and res['artifact']==ART
    a=Fake(au(ART),au(ART2,resp('B1')),costs=[0.3,0.3]);r=Fake(rv('REVISE',it('B1')),rv('APPROVE'),costs=[0.3,0.05]);res,_=go(a,r,max_total_usd=1.0,cost_estimates={'reviewer':0.05})
    assert (res['status'],len(a.calls),len(r.calls))==('AGREED',2,2) and abs(r.calls[1]['max_usd']-0.1)<1e-9
    a=Fake(au(BAD),au(ART,resp('VALIDATION')),costs=[0.3,0.3]);r=Fake(rv('APPROVE'));res,_=go(a,r,max_total_usd=0.605)
    assert (res['status'],len(a.calls),len(r.calls),res['budgetStop']['reviewerReserveUSD'])==('BUDGET',1,0,0.01)
    a=Fake(au(ART),au(ART2,resp('B1')),au(ART,resp('B2')),costs=[0.4,0.1,0.1]);r=Fake(rv('REVISE',it('B1')),rv('REVISE',it('B2')),rv('APPROVE'),costs=[0.1,0.1,0.1])
    res,_=go(a,r,max_total_usd=1.05,max_round_trips=3);assert (res['status'],len(a.calls),len(r.calls))==('AGREED',3,3) and abs(res['costUSD']-0.9)<1e-9
def test_compact_json_in_every_prompt():
    a=Fake(au(ART),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1'),it('N1','NON_BLOCKING')),rv('APPROVE'));res,_=go(a,r)
    assert D._j({'a':[1,{'b':'c'}]})=='{"a":[1,{"b":"c"}]}' and D.scrubber(['claude-opus-5-5','gpt-5.5-codex'])(D._j(CTX)) in r.calls[0]['user'] and D._j(ART) in r.calls[0]['user'] and D._j(ART) in a.calls[1]['user']
    for c in a.calls+r.calls:assert '": ' not in c['user'] and '\n "' not in c['user'] and '{\n' not in c['user'] and '[\n' not in c['user'] and ', "' not in c['user'],c['purpose']
BIG={**CTX,'notes':{'raw':['CTX_SENTINEL_%04d'%i for i in range(800)]}}
def test_round2_prompts_do_not_resend_context():
    a=Fake(au(ART),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1',cites=['$.notes.raw[3]'])),rv('APPROVE'));res,_=go(a,r,context=BIG)
    assert res['status']=='AGREED' and 'CTX_SENTINEL_0799' in r.calls[0]['user'] and res['contextDigestSha256'] is None
    for u in (a.calls[1]['user'],r.calls[1]['user']):
        assert 'CTX_SENTINEL' not in u and 'Not repeated here' in u and 'top-level keys: runId, policy, searchSpace, ledger, consecutiveNoImprovement, notes' in u
        assert len(u)<len(D._j(BIG))/2 and len(u)<6000,len(u)
    assert 'EARLIER REVIEW' in r.calls[1]['user'] and '$.notes.raw[3]' in r.calls[1]['user'] and '"after":512' in r.calls[1]['user'] and 'REVISED PROPOSAL' in r.calls[1]['user']
    a=Fake(au(BAD),au(ART,resp('VALIDATION')));r=Fake(rv('APPROVE'));res,_=go(a,r,context=BIG)
    assert res['status']=='AGREED' and 'CTX_SENTINEL' not in a.calls[1]['user'] and 'CTX_SENTINEL_0799' in r.calls[0]['user'] and 'EARLIER REVIEW' not in r.calls[0]['user']
def test_context_digest_replaces_context_after_round_one():
    dig={'champion':'ABS_D8_E03_R1024','DIGEST_MARK':[1,2]}
    a=Fake(au(ART),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1')),rv('APPROVE'));res,_=go(a,r,context=BIG,context_digest=dig)
    assert res['status']=='AGREED' and res['contextDigestSha256']==D._sha(dig) and 'CTX_SENTINEL_0799' in r.calls[0]['user']
    assert all('DIGEST_MARK' not in c['user'] for c in (a.calls[0],r.calls[0]))
    for u in (a.calls[1]['user'],r.calls[1]['user']):assert 'CONTEXT DIGEST' in u and D._j(dig) in u and 'CTX_SENTINEL' not in u and 'Not repeated here' not in u
    a=Fake(au(ART),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1')),rv('APPROVE'));go(a,r,context_digest='DIGEST_TEXT_77')
    assert 'DIGEST_TEXT_77' in a.calls[1]['user'] and 'DIGEST_TEXT_77' in r.calls[1]['user']
def test_unknown_cost_charged_at_cap():
    res,_=go(Fake(au(ART),costs=None),Fake(rv('APPROVE'),costs=0.05),max_call_usd=0.8)
    assert res['status']=='AGREED' and res['transcript'][0]['costUnknown'] and not res['transcript'][1]['costUnknown'] and abs(res['costUSD']-0.85)<1e-9
    class G(Fake):
        def __call__(self,**kw):o,_=super().__call__(**kw);return o,{'costUSD':None,'chargedUSD':0.33}
    res,_=go(G(au(ART)),Fake(rv('APPROVE'),costs=0.05));assert abs(res['costUSD']-0.38)<1e-9
def test_tiny_remaining_budget_stops_before_call():
    a=Fake(au(ART),costs=0.495);r=Fake();res,_=go(a,r,max_total_usd=0.5)
    assert (res['status'],res['reason'],len(r.calls))==('BUDGET','BEFORE_REVIEWER_CALL',0)
def test_refused():
    a=Fake(GatewayRefused('per-call guard'));r=Fake();res,_=go(a,r)
    assert (res['status'],res['reason'],len(r.calls),res['artifact'])==('REFUSED','AUTHOR_CALL_REFUSED',0,None) and 'GatewayRefused' in res['transcript'][0]['error']
    res,_=go(Fake(au(ART)),Fake(GatewayRefused('daily cap')))
    assert (res['status'],res['reason'],res['artifact'])==('REFUSED','REVIEWER_CALL_REFUSED',ART)
class GatewayFailed(Exception):
    def __init__(self,code,meta):super().__init__(code);self.meta=meta
def test_other_exception_persisted_and_raised():
    snaps=[]
    try:go(Fake(RuntimeError('cli died')),Fake(),persist=snaps.append);raised=False
    except RuntimeError:raised=True
    assert raised and snaps[-1]['status']=='ERROR' and 'cli died' in snaps[-1]['reason'] and snaps[-1]['costUSD']==1.0
    snaps=[]
    try:go(Fake(au(ART)),Fake(GatewayFailed('TIMEOUT',{'costUSD':None,'chargedUSD':0.4})),persist=snaps.append);raised=False
    except GatewayFailed:raised=True
    assert raised and snaps[-1]['status']=='ERROR' and abs(snaps[-1]['costUSD']-0.5)<1e-9 and snaps[-1]['transcript'][1]['costUnknown']
def test_malformed_review_is_not_agreement():
    for bad in ({},{'verdict':'MAYBE','items':[]},{'verdict':'APPROVE','items':'none'},{'verdict':'APPROVE','items':['x']}):
        res,_=go(Fake(au(ART)),Fake(bad));assert (res['status'],res['reason'])==('DEADLOCK','REVIEW_MALFORMED'),bad
def test_independence_first_review_blind_to_author_text():
    a=Fake(au(ART,resp('B1','REBUT','PREEMPTIVE_XYZZY','D1')),au(ART2,resp('B1','REBUT','REBUTTAL_TEXT_42','D2')))
    r=Fake(rv('REVISE',it('B1')),rv('APPROVE'));res,_=go(a,r)
    assert 'PREEMPTIVE_XYZZY' not in r.calls[0]['user'] and 'REBUTTAL_TEXT_42' in r.calls[1]['user'] and res['transcript'][0]['ignoredResponses']==1
    assert 'REBUTTAL_TEXT_42' not in r.calls[0]['user'] and all('PREEMPTIVE_XYZZY' not in c['user'] for c in r.calls)
def test_author_answer_checks_reach_reviewer():
    a=Fake(au(ART),au(ART,resp('B1','ACCEPT'),resp('B2','REBUT','fine','because'),resp('Z9')))
    r=Fake(rv('REVISE',it('B1'),it('B2'),it('B3')),rv('REVISE',it('B1')));res,_=go(a,r)
    v={(x['itemId'],x['code']) for x in res['transcript'][2]['violations']}
    assert v=={('B1','ACCEPT_WITHOUT_CHANGE'),('B2','UNCITED_REBUT'),('B3','MISSING_RESPONSE'),('Z9','UNKNOWN_ITEM')}
    u=r.calls[1]['user'];assert 'ACCEPT_WITHOUT_CHANGE' in u and 'UNCITED_REBUT' in u and 'MISSING_RESPONSE' in u and 'Z9' not in u
def test_anonymization():
    leaky={**ART,'hypothesis':'As an AI model, I (Claude, claude-opus-5-5) think my previous proposal was weak on this corpus; 클로드가 제안한다.'}
    a=Fake(au(leaky),au(ART2,resp('B1')));r=Fake(rv('REVISE',it('B1',obj='gpt-5.5-codex here: as an assistant I object; GPT-4o agrees')),rv('APPROVE'))
    res,_=go(a,r,author_model='claude-opus-5-5',reviewer_model='gpt-5.5-codex')
    pat=re.compile(r'claude|opus|sonnet|haiku|fable|anthropic|openai|gpt|codex|gemini|as an ai|as an assistant|my previous|클로드',re.I)
    for c in a.calls+r.calls:
        assert not pat.search(c['system']) and not pat.search(c['user']),pat.search(c['system']+c['user'])
        assert set(c)=={'role','model','effort','system','user','schema','max_usd','run_id','purpose'}
    assert '[redacted]' in r.calls[0]['user'] and 'the previous proposal' in r.calls[0]['user'] and 'ABS_D8_E03_R1024' in r.calls[0]['user'] and 'corpus' in r.calls[0]['user']
    assert '[redacted]' in a.calls[1]['user'] and [e['model'] for e in res['transcript']]==['claude-opus-5-5','gpt-5.5-codex','claude-opus-5-5','gpt-5.5-codex']
def test_call_parameters_per_role():
    a=Fake(au(ART));r=Fake(rv('APPROVE'));res,_=go(a,r,author_model='m-author',reviewer_model='m-review',max_call_usd=0.7)
    ka,kr=a.calls[0],r.calls[0]
    assert (ka['role'],ka['model'],ka['effort'],ka['run_id'],ka['max_usd'])==('author','m-author','high','AUTOLOOP_002',0.7)
    assert (kr['role'],kr['model'],kr['effort'],kr['max_usd'])==('reviewer','m-review','medium',0.7) and kr['schema'] is D.REVIEW_SCHEMA
    assert ka['schema']==D.author_output_schema({'type':'object'}) and ka['purpose']=='debate:design:author:r1'
    a=Fake(au(ART));r=Fake(rv('APPROVE'));go(a,r,author_effort='medium',reviewer_effort='low',kind='judge')
    assert (a.calls[0]['effort'],r.calls[0]['effort'])==('medium','low') and '- J7:' in r.calls[0]['user'] and '- D1:' not in r.calls[0]['user'] and 'judge decision' in r.calls[0]['system']
def test_judge_rule_ids_only_for_judge():
    res,_=go(Fake(au(ART)),Fake(rv('REVISE',it('B1',cites=['D1']),it('B2',cites=['J3']))),kind='judge',max_round_trips=1)
    assert ids(res['openBlocking'])==['B2'] and ids(res['downgraded'])==['B1']
def test_persist_to_temp_file():
    d=Path(tempfile.mkdtemp(prefix='debate-test-'));f=d/'debate.json'
    def persist(o):tmp=f.with_suffix('.tmp');tmp.write_text(json.dumps(o,ensure_ascii=False));tmp.replace(f)
    res,_=go(Fake(au(ART),au(ART2,resp('B1'))),Fake(rv('REVISE',it('B1')),rv('APPROVE')),persist=persist)
    disk=json.loads(f.read_text());assert disk['status']=='AGREED' and len(disk['transcript'])==4 and disk['artifact']==ART2 and disk['config']['authorEffort']=='high'
def test_bad_args_and_package_import():
    for kw in ({'kind':'plan'},{'max_round_trips':0}):
        try:go(Fake(),Fake(),**kw);ok=False
        except ValueError:ok=True
        assert ok,kw
    sys.path.insert(0,str(A))
    try:
        import importlib;m=importlib.import_module('ai.debate');assert m.BY_KIND['design'][0]['id']=='D1'
    finally:sys.path.remove(str(A))
if __name__=='__main__':
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith('test_') and callable(v)];bad=0
    for k,f in fs:
        try:f();print('PASS',k)
        except Exception as e:bad+=1;print('FAIL',k,type(e).__name__,e)
    print('%d/%d passed'%(len(fs)-bad,len(fs)));raise SystemExit(1 if bad else 0)
