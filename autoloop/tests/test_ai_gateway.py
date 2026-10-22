"""Tests for ai/gateway.py with a fake runner (no network): env scrub, command flags, outbound filter, budget from the ledger, hash-chain tamper detection, HELD_UNKNOWN_OUTCOME, status mapping and the default runner's timeout and size cap."""
import json,os,shutil,subprocess,sys,tempfile,uuid
from pathlib import Path
A=Path(__file__).resolve().parents[1];sys.path.insert(0,str(A/'ai'))
import gateway as G,chainlog as CL
N=[0]
def check(name,ok):N[0]+=1;print(('PASS ' if ok else 'FAIL ')+name);assert ok,name
TMP=Path(tempfile.mkdtemp(prefix='ai-gw-test-'))
SCHEMA={'type':'object','additionalProperties':False,'required':['answer'],'properties':{'answer':{'type':'integer'},'note':{'type':'string'}}}
DAY0=1792600000.0;clock=[DAY0];G.now=lambda:clock[0]
def fresh(per_day=1.0,total=2.0,guard=0.6):
    d=TMP/uuid.uuid4().hex[:8];d.mkdir();(d/'policy.json').write_text(json.dumps({'aiBudget':{'perDayUSD':per_day,'totalUSD':total,'perCallGuardUSD':guard}}));G.AI=d;G.POLICY=d/'policy.json';G.TOOLS_ROOT=d;return d
def cli(so=None,cost=0.0123,rc=0,subtype='success',is_error=False):
    d={'type':'result','subtype':subtype,'is_error':is_error,'duration_ms':1234,'num_turns':2,'result':'','total_cost_usd':cost,'session_id':'s',
       'usage':{'input_tokens':5,'cache_creation_input_tokens':100,'cache_read_input_tokens':0,'output_tokens':50,'output_tokens_details':{'thinking_tokens':7}},'modelUsage':{'claude-opus-5-5':{'costUSD':cost}}}
    if so is not None:d['structured_output']=so
    return rc,json.dumps(d).encode(),b''
class Fake:
    def __init__(self,*results):self.results=list(results);self.seen=[]
    def __call__(self,cmd,stdin,cwd,env,timeout):
        self.seen.append({'cmd':cmd,'stdin':stdin,'cwdEmpty':os.listdir(cwd)==[],'cwd':cwd,'env':dict(env)});r=self.results.pop(0)
        if isinstance(r,BaseException):raise r
        return r
def go(fake,user='What is 2+3?',max_usd=0.5,**kw):
    args=dict(role='smoke',model='claude-opus-5-5',effort='low',system='Answer in JSON.',user=user,schema=SCHEMA,max_usd=max_usd,run_id='TEST_001',purpose='test',runner=fake);args.update(kw);return G.call(**args)
def code(fn):
    try:fn();return None
    except G.GatewayError as e:return e.code
def ledger():return CL.read(G.ledger_path()) if G.ledger_path().exists() else []
src={'ANTHROPIC_API_KEY':'x','ANTHROPIC_AUTH_TOKEN':'x','CLAUDE_CODE_OAUTH_TOKEN':'x','CLAUDE_CODE_EFFORT_LEVEL':'max','CLAUDE_CODE_MESSAGING_TOKEN':'x','CLAUDE_EFFORT':'max','ANTHROPIC_BASE_URL':'http://evil','PATH':'/bin','HOME':'/h'}
env=G.scrubbed_env(src)
check('env keeps only allowlisted variables and drops every auth/effort override',env['PATH']=='/bin' and env['HOME']=='/h' and not any(k.startswith('ANTHROPIC') or k in ('CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_EFFORT_LEVEL','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_EFFORT') for k in env))
check('env disables CLAUDE.md and auto memory',env['CLAUDE_CODE_DISABLE_CLAUDE_MDS']=='1' and env['CLAUDE_CODE_DISABLE_AUTO_MEMORY']=='1')
cmd=G.command('claude-opus-5-5','high',0.5,'{}','SYS')
i=cmd.index('--settings')
check('command uses --bare with the key helper as apiKeyHelper only',cmd[1:3]==['-p','--bare'] and json.loads(cmd[i+1])=={'apiKeyHelper':str(G.KEY_HELPER)})
check('command disables built-in tools, MCP discovery and session persistence',cmd[cmd.index('--tools')+1]=='' and '--strict-mcp-config' in cmd and '--no-session-persistence' in cmd and '--mcp-config' not in cmd and '--permission-mode' not in cmd)
check('command passes model, effort, budget, json output, schema and system prompt',[cmd[cmd.index(f)+1] for f in ('--model','--effort','--max-budget-usd','--output-format','--json-schema','--system-prompt')]==['claude-opus-5-5','high','0.50','json','{}','SYS'])
d=fresh();(d/'mcp.json').write_text('{"mcpServers":{}}')
extra,tid=G.tool_args({'mcp_config_path':str(d/'mcp.json'),'allowed_tools':['mcp__sandbox__run']});cmd=G.command('claude-opus-5-5','high',0.5,'{}','SYS',extra)
check('tools add mcp-config, allowedTools and dontAsk while built-ins stay off',cmd[cmd.index('--mcp-config')+1]==str(d/'mcp.json') and cmd[cmd.index('--allowedTools')+1]=='mcp__sandbox__run' and cmd[cmd.index('--permission-mode')+1]=='dontAsk' and cmd[cmd.index('--tools')+1]=='' and tid['allowedTools']==['mcp__sandbox__run'])
check('tools refuse built-in tool names',code(lambda:G.tool_args({'mcp_config_path':str(d/'mcp.json'),'allowed_tools':['Bash']}))=='BAD_ARGUMENT')
check('tools refuse a config outside the tools root',code(lambda:G.tool_args({'mcp_config_path':str(A/'policy.json'),'allowed_tools':['mcp__s__t']}))=='BAD_ARGUMENT')
fresh();f=Fake()
for name,kw in (('Anthropic key',{'user':'use sk-ant-api03-abcdef'}),('generic sk- key',{'user':'k=sk-'+'a1'*12}),('AWS key id',{'system':'AKIA'+'ABCDEFGHIJKLMNOP'}),
                ('private key block',{'user':'-----BEGIN OPENSSH PRIVATE KEY-----'}),('x-api-key header',{'user':'x-api-key: 1'}),('Authorization header',{'user':'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'}),
                ('local path in schema',{'schema':{**SCHEMA,'description':'/Users/someone/file'}}),('local path in user',{'user':'see /Users/x/y'})):
    try:go(f,**kw);c=None
    except G.GatewayRefused as e:c=e.code;msg=str(e)
    check('outbound filter refuses '+name,c=='OUTBOUND_FILTER' and 'sk-ant' not in msg and 'AKIA' not in msg)
check('oversized request is refused',code(lambda:go(f,user='x'*(200*1024)))=='REQUEST_TOO_LARGE')
check('refusals never reach the runner or the ledger',f.seen==[] and not G.ledger_path().exists())
check('benign text with hyphens, tildes and remote paths passes the filter',G.outbound('risk-adjusted task-runner sk-learn 0.03~0.10석','/workspace/salmonbus-full-v1/outputs','{}')>0)
for name,kw in (('effort',{'effort':'ultra'}),('role',{'role':'Designer'}),('run_id',{'run_id':'autoloop'}),('max_usd',{'max_usd':0}),('model',{'model':'claude opus'})):
    check('bad argument refused: '+name,code(lambda:go(f,**kw))=='BAD_ARGUMENT')
check('max_usd above the per-call guard is refused',code(lambda:go(f,max_usd=0.7))=='MAX_USD_OVER_GUARD')
fresh();os.environ['ANTHROPIC_API_KEY']='test-placeholder-not-a-key'
f=Fake(cli({'answer':5},cost=0.0123));out,meta=go(f,user='MARKER_USER_TEXT 2+3?',system='MARKER_SYSTEM_TEXT')
del os.environ['ANTHROPIC_API_KEY']
rows=ledger();raw=G.ledger_path().read_bytes();s=f.seen[0]
check('OK call returns the structured output and its cost',out=={'answer':5} and meta['status']=='OK' and meta['costUSD']==0.0123 and meta['turns']==2 and meta['usage']['thinking_tokens']==7)
check('ledger holds RESERVED then OUTCOME for the same call',[r['type'] for r in rows]==['RESERVED','OUTCOME'] and rows[0]['callId']==rows[1]['callId']==meta['callId'] and rows[1]['status']=='OK')
check('ledger stores hashes and sizes, never prompt text',b'MARKER_USER_TEXT' not in raw and b'MARKER_SYSTEM_TEXT' not in raw and rows[0]['sizes']['user']==len('MARKER_USER_TEXT 2+3?') and len(rows[0]['requestSha256'])==64 and len(rows[1]['responseSha256'])==64)
check('runner got the user text on stdin, a fresh empty cwd (removed afterwards) and a scrubbed env',s['stdin']==b'MARKER_USER_TEXT 2+3?' and s['cwdEmpty'] and not os.path.exists(s['cwd']) and 'ANTHROPIC_API_KEY' not in s['env'])
op=G.outputs_dir()/(meta['outputSha256']+'.json')
check('structured output is stored content-addressed',op.exists() and CL.sha(op.read_bytes())==meta['outputSha256'] and json.loads(op.read_bytes())=={'answer':5})
v=G.verify_ledger()
check('verify_ledger accepts the chain and totals the reported cost',v['ok'] and v['records']==2 and abs(v['totalUSD']-0.0123)<1e-9 and v['reportedUSD']==0.0123 and v['open']==0)
fresh(per_day=1.0,total=2.0,guard=0.6)
go(Fake(cli({'answer':1},cost=0.5)),user='a',max_usd=0.6);f=Fake()
check('daily budget refusal from ledger totals (0.5 spent + 0.6 > 1.0)',code(lambda:go(f,user='b',max_usd=0.6))=='AI_BUDGET_TODAY' and f.seen==[] and len(ledger())==2)
clock[0]=DAY0+86400;go(Fake(cli({'answer':1},cost=0.6)),user='c',max_usd=0.6)
clock[0]=DAY0+2*86400;go(Fake(cli({'answer':1},cost=0.5)),user='d',max_usd=0.6)
clock[0]=DAY0+3*86400
check('total budget refusal from ledger totals (1.6 spent + 0.6 > 2.0) on a fresh day',code(lambda:go(f,user='e',max_usd=0.6))=='AI_BUDGET_TOTAL' and f.seen==[])
s=G.spend_summary(G.kst_day(DAY0+86400))
check('spend_summary reports one day and the total',abs(s['dayUSD']-0.6)<1e-9 and abs(s['totalUSD']-1.6)<1e-9 and len(s['byDay'])==3)
G.POLICY.write_text(json.dumps({'aiBudget':{'perDayUSD':1.0,'totalUSD':5.0,'perCallGuardUSD':0.6}}))
check('policy is re-read on every call',code(lambda:go(Fake(cli({'answer':1},cost=0.1)),user='e',max_usd=0.6)) is None)
clock[0]=DAY0
fresh(per_day=5.0,total=5.0,guard=0.6)
try:go(Fake(subprocess.TimeoutExpired('claude',1)),user='t',max_usd=0.6);c=None
except G.GatewayFailed as e:c=e.code;m=e.meta
check('timeout ends as TIMEOUT and charges the full reservation',c=='TIMEOUT' and m['chargedUSD']==0.6 and ledger()[-1]['status']=='TIMEOUT' and G.spend_summary()['reservedMaxUSD']==0.6)
f=Fake()
check('identical request after TIMEOUT is held',code(lambda:go(f,user='t',max_usd=0.6))=='HELD_UNKNOWN_OUTCOME' and f.seen==[])
check('the hold ignores metadata (role, purpose, run, max_usd)',code(lambda:go(f,user='t',max_usd=0.3,role='other',purpose='x',run_id='OTHER_002'))=='HELD_UNKNOWN_OUTCOME' and f.seen==[])
check('a different request is not held',code(lambda:go(Fake(cli({'answer':2})),user='t2',max_usd=0.3)) is None)
f=Fake(cli({'answer':3}));go(f,user='t',max_usd=0.3,allow_resend=True)
check('allow_resend=True sends it and marks the reservation',len(f.seen)==1 and [r for r in ledger() if r['type']=='RESERVED'][-1]['allowResend'] is True)
check('runner exception ends as UNKNOWN',code(lambda:go(Fake(OSError('boom')),user='u',max_usd=0.3))=='UNKNOWN' and ledger()[-1]['status']=='UNKNOWN')
check('identical request after UNKNOWN is held',code(lambda:go(Fake(),user='u',max_usd=0.3))=='HELD_UNKNOWN_OUTCOME')
rid=CL.sha(CL.canonical({'model':'claude-opus-5-5','effort':'low','system':'Answer in JSON.','user':'open','schema':SCHEMA,'tools':None}))
with CL.locked(G.ledger_path()):rows=CL.read(G.ledger_path());CL.append(G.ledger_path(),rows,{'type':'RESERVED','callId':'dangling','role':'smoke','purpose':'test','runId':'TEST_001','model':'claude-opus-5-5','effort':'low','maxUSD':0.2,'requestSha256':rid,'sizes':{},'tools':None,'allowResend':False,'atEpoch':clock[0]})
check('identical request with an open reservation (crash mid-call) is held',code(lambda:go(Fake(),user='open',max_usd=0.3))=='HELD_UNKNOWN_OUTCOME')
check('open reservation counts its maxUSD',G.verify_ledger()['open']==1)
try:go(Fake(KeyboardInterrupt()),user='k',max_usd=0.3);ki=False
except KeyboardInterrupt:ki=True
check('interrupt records UNKNOWN before re-raising',ki and ledger()[-1]['status']=='UNKNOWN' and ledger()[-1]['detail']=='RUNNER_KeyboardInterrupt')
fresh(per_day=10,total=10,guard=1.0)
def failed(fake,user):
    try:go(fake,user=user,max_usd=0.5);return None,None
    except G.GatewayFailed as e:return e.code,e.meta
c,m=failed(Fake(cli(None,cost=0.02,rc=1,subtype='error_max_budget_usd',is_error=True)),'b1')
check('max-budget stop maps to BUDGET_STOP with its reported cost',c=='BUDGET_STOP' and m['costUSD']==0.02 and ledger()[-1]['subtype']=='error_max_budget_usd')
c,m=failed(Fake((1,b'not json',b'Error: something at /Users/x/y sk-ant-zzz')),'b2')
check('non-zero exit with unparseable output maps to CLI_ERROR charged at maxUSD, stderr sanitized',c=='CLI_ERROR' and m['chargedUSD']==0.5 and '/Users/' not in m['stderrTail'] and 'sk-ant' not in m['stderrTail'])
c,m=failed(Fake(cli({'answer':1},rc=0,subtype='error_during_execution',is_error=True)),'b3')
check('is_error result maps to CLI_ERROR',c=='CLI_ERROR')
c,m=failed(Fake(cli({'wrong':1})),'b4')
check('schema violation maps to INVALID_OUTPUT and stores nothing',c=='INVALID_OUTPUT' and ledger()[-1]['detail']=='SCHEMA' and m['outputSha256'] is None and not G.outputs_dir().exists())
c,m=failed(Fake(cli(None)),'b5')
check('missing structured output maps to INVALID_OUTPUT',c=='INVALID_OUTPUT' and ledger()[-1]['detail']=='NO_STRUCTURED_OUTPUT')
c,m=failed(Fake(cli({'answer':1,'note':'here sk-ant-api03-leak'})),'b6')
check('secret-like pattern in the output maps to INVALID_OUTPUT',c=='INVALID_OUTPUT' and ledger()[-1]['detail']=='OUTPUT_SECRET_PATTERN' and not G.outputs_dir().exists())
c,m=failed(Fake((0,b'x'*(G.RESPONSE_CAP+1),b'')),'b7')
check('response over 1 MB maps to INVALID_OUTPUT',c=='INVALID_OUTPUT' and ledger()[-1]['detail']=='RESPONSE_TOO_LARGE')
check('INVALID_OUTPUT and CLI_ERROR are not held',code(lambda:go(Fake(cli({'answer':1})),user='b4',max_usd=0.5)) is None)
check('schema checker: anyOf, enum, pattern, ranges, additionalProperties',G.check_schema({'a':'X1','n':2,'m':{'k':1.5}},{'type':'object','additionalProperties':False,'required':['a'],'properties':{'a':{'type':'string','pattern':'^[A-Z][0-9]$'},'n':{'type':'integer','minimum':0},'m':{'type':'object','additionalProperties':{'anyOf':[{'type':'number'},{'type':'string'}]}}}})==[]
      and G.check_schema({'a':'x','z':1},{'type':'object','additionalProperties':False,'required':['a','b'],'properties':{'a':{'enum':['y']}}})!=[] and G.check_schema(True,{'type':'integer'})!=[])
fresh(per_day=10,total=10,guard=1.0)
for u in ('t1','t2','t3'):go(Fake(cli({'answer':1},cost=0.1)),user=u,max_usd=0.5)
p=G.ledger_path();good=p.read_bytes();lines=good.split(b'\n')[:-1]
r=json.loads(lines[1]);r['costUSD']=0.0;lines2=list(lines);lines2[1]=CL.canonical(r);p.write_bytes(b'\n'.join(lines2)+b'\n')
v=G.verify_ledger()
check('tampered cost is detected (CHAIN_HASH)',v['ok'] is False and v['error']=='CHAIN_HASH:1')
check('a call on a tampered ledger is refused',code(lambda:go(Fake(cli({'answer':1})),user='t9'))=='LEDGER_BROKEN')
r.pop('sha256');r['sha256']=CL.sha(CL.canonical(r));lines2[1]=CL.canonical(r);p.write_bytes(b'\n'.join(lines2)+b'\n')
check('tampered record with a recomputed own hash breaks the next link (CHAIN_LINK)',G.verify_ledger()['error']=='CHAIN_LINK:2')
p.write_bytes(b'\n'.join(lines[:2]+lines[3:])+b'\n')
check('deleted record is detected (CHAIN_LINK)',G.verify_ledger()['error']=='CHAIN_LINK:2')
p.write_bytes(good[:-5])
check('truncated tail is detected',G.verify_ledger()['error']=='CHAIN_TRUNCATED')
p.write_bytes(good);check('restored ledger verifies again',G.verify_ledger()['ok'])
NUL={'type':'null'};S={'type':'string'};E={'anyOf':[{'enum':['NO_IMPROVEMENT_ROOM','ANOMALY_SUSPECTED']},NUL]}
check('null type accepts only None',G.check_schema(None,NUL)==[] and G.check_schema(0,NUL)!=[] and G.check_schema('',NUL)!=[] and G.check_schema({},NUL)!=[])
check('anyOf [string, null] validates the non-null branch type',G.check_schema(None,{'anyOf':[S,NUL]})==[] and G.check_schema('X',{'anyOf':[S,NUL]})==[] and G.check_schema(123,{'anyOf':[S,NUL]})!=[] and G.check_schema(['X'],{'anyOf':[S,NUL]})!=[])
check('anyOf [enum, null] rejects a value outside the enum',G.check_schema('ANOMALY_SUSPECTED',E)==[] and G.check_schema(None,E)==[] and G.check_schema('BAD',E)!=[] and G.check_schema(False,E)!=[])
check('type lists validate each listed type only',G.check_schema(None,{'type':['string','null']})==[] and G.check_schema('a',{'type':['string','null']})==[] and G.check_schema(1,{'type':['string','null']})!=[] and G.check_schema(1,{'type':['integer','null'],'minimum':2})!=[])
check('nested null branch inside an object is enforced',G.check_schema({'c':{'candidate':5}},{'type':'object','properties':{'c':{'type':'object','properties':{'candidate':{'anyOf':[S,NUL]}}}}})!=[])
check('unsupported keywords and unknown types fail closed',G.check_schema(1,{'oneOf':[{'type':'integer'}]})!=[] and G.check_schema(1,{'const':1})!=[] and G.check_schema(1,{'type':'int'})!=[] and G.check_schema(1,{'anyOf':[]})!=[])
import debate as DB
rv={'verdict':'REVISE','summary':'s','items':[{'itemId':'B1','severity':'BLOCKING','citations':['D4'],'objection':'o','requestedChange':'r'}]}
au={'artifact':{'answer':1},'responses':[{'itemId':'B1','action':'ACCEPT','reason':'r','citation':'D4'}]}
check('debate review and author schemas validate well-formed outputs and reject malformed ones',G.check_schema(rv,DB.REVIEW_SCHEMA)==[] and G.check_schema({**rv,'verdict':'MAYBE'},DB.REVIEW_SCHEMA)!=[]
      and G.check_schema(au,DB.author_output_schema(SCHEMA))==[] and G.check_schema({**au,'artifact':{'answer':'1'}},DB.author_output_schema(SCHEMA))!=[])
rc,out,err=G.run_cli([sys.executable,'-c','import sys;sys.stdout.write(sys.stdin.read()[::-1])'],b'abc',str(TMP),G.scrubbed_env(),10)
check('default runner pipes stdin and captures stdout',rc==0 and out==b'cba')
rc,out,err=G.run_cli([sys.executable,'-c','import sys;sys.stdout.write("y"*(%d+50))'%G.RESPONSE_CAP],b'',str(TMP),G.scrubbed_env(),10)
check('default runner caps stdout at 1 MB + 1 byte',len(out)==G.RESPONSE_CAP+1)
try:G.run_cli([sys.executable,'-c','import time;time.sleep(30)'],b'',str(TMP),G.scrubbed_env(),0.5);t=False
except subprocess.TimeoutExpired:t=True
check('default runner kills the process group on timeout',t)
shutil.rmtree(TMP)
print('ALL_PASS %d'%N[0])
