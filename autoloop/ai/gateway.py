"""The single way the autonomous loop calls Claude: headless `claude -p --bare` authenticated only through planner/anthropic_key_helper.sh as apiKeyHelper, from a fresh empty temp cwd with an allowlisted environment.
Before a call: argument checks, outbound filter (secret-like patterns, local /Users/ paths, 200 KB request cap), budget from the call ledger against policy.json aiBudget (read every call), and a hold on any request whose identical predecessor ended UNKNOWN or TIMEOUT.
Call ledger ai/calls.jsonl is append-only and hash-chained (chainlog): RESERVED then OUTCOME per call, hashes and sizes only, never prompt text, thinking or headers. Structured outputs go to ai/outputs/<sha256>.json.
Spend: an OUTCOME with a reported total_cost_usd counts that amount; a call without a reported cost (open reservation, TIMEOUT, UNKNOWN, unparseable output) counts its full maxUSD."""
import datetime,json,math,os,re,shutil,signal,subprocess,sys,tempfile,time,uuid
from pathlib import Path
H=Path(__file__).resolve().parent
if str(H) not in sys.path:sys.path.insert(0,str(H))
import chainlog as CL
A=H.parent;AI=H;POLICY=A/'policy.json';KEY_HELPER=A/'planner/anthropic_key_helper.sh';TOOLS_ROOT=A
KST=datetime.timezone(datetime.timedelta(hours=9))
REQUEST_CAP=200*1024;RESPONSE_CAP=1<<20;OUTPUT_CAP=256*1024;TIMEOUT=1800
EFFORTS=('low','medium','high','xhigh','max')
STATUSES=('OK','CLI_ERROR','BUDGET_STOP','TIMEOUT','INVALID_OUTPUT','UNKNOWN')
HOLD=('UNKNOWN','TIMEOUT')
SECRET=re.compile(r'sk-ant-|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN[A-Z ]*PRIVATE KEY|x-api-key|authorization\s*:|bearer\s+[A-Za-z0-9._~+/=-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|rpa_[A-Za-z0-9]{20,}|apikey_|anthropic_api_key|provider-keys',re.I)
LOCAL_PATH=re.compile(r'/Users/')
ENV_KEEP=('PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','LC_CTYPE','TMPDIR','TZ','TERM','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','https_proxy','http_proxy','no_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')
ENV_SET={'CLAUDE_CODE_DISABLE_CLAUDE_MDS':'1','CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1','DISABLE_AUTOUPDATER':'1'}
now=time.time
class GatewayError(Exception):
    def __init__(self,code,detail=None,meta=None):
        super().__init__(code+(':'+str(detail) if detail else ''));self.code=code;self.detail=detail;self.meta=meta or {}
class GatewayRefused(GatewayError):pass
class GatewayFailed(GatewayError):pass
def ledger_path():return AI/'calls.jsonl'
def outputs_dir():return AI/'outputs'
def kst_day(epoch):return datetime.datetime.fromtimestamp(epoch,KST).strftime('%Y-%m-%d')
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def scrubbed_env(src=None):
    src=os.environ if src is None else src;env={k:src[k] for k in ENV_KEEP if k in src};env.update(ENV_SET);return env
def outbound(system,user,schema_text):
    for name,text in (('system',system),('user',user),('schema',schema_text)):
        if SECRET.search(text):raise GatewayRefused('OUTBOUND_FILTER','SECRET_PATTERN:'+name)
        if LOCAL_PATH.search(text):raise GatewayRefused('OUTBOUND_FILTER','LOCAL_PATH:'+name)
    n=sum(len(t.encode()) for t in (system,user,schema_text))
    if n>REQUEST_CAP:raise GatewayRefused('REQUEST_TOO_LARGE',str(n))
    return n
SCHEMA_TYPES=('object','array','string','number','integer','boolean','null')
SCHEMA_UNSUPPORTED=('oneOf','allOf','not','const','$ref','if','patternProperties','dependentSchemas')
def check_schema(v,s,p='$'):
    if type(s) is not dict or any(k in s for k in SCHEMA_UNSUPPORTED):return [p+':unsupportedSchema']
    if 'anyOf' in s:
        if type(s['anyOf']) is not list or not s['anyOf']:return [p+':unsupportedSchema']
        rest={k:x for k,x in s.items() if k!='anyOf'}
        if any(not check_schema(v,x,p) for x in s['anyOf']):return check_schema(v,rest,p) if rest else []
        return [p+':anyOf']
    if 'enum' in s and not any(type(v) is type(x) and v==x for x in s['enum']):return [p+':enum']
    t=s.get('type')
    if isinstance(t,list):
        if not t or any(x not in SCHEMA_TYPES for x in t):return [p+':unsupportedSchema']
        return [] if any(not check_schema(v,{**s,'type':x},p) for x in t) else [p+':type']
    if t is not None and t not in SCHEMA_TYPES:return [p+':unsupportedSchema']
    if t=='null':return [] if v is None else [p+':type']
    if t=='object':
        if type(v) is not dict:return [p+':type']
        e=[p+':required' for k in s.get('required',[]) if k not in v];props=s.get('properties',{});ap=s.get('additionalProperties')
        for k,x in v.items():
            if k in props:e+=check_schema(x,props[k],p+'.'+k)
            elif ap is False:e.append(p+':additional')
            elif isinstance(ap,dict):e+=check_schema(x,ap,p+'.*')
        return e
    if t=='array':
        if type(v) is not list:return [p+':type']
        e=[p+':minItems'] if len(v)<s.get('minItems',0) else []
        if 'maxItems' in s and len(v)>s['maxItems']:e.append(p+':maxItems')
        for x in v:e+=check_schema(x,s.get('items',{}),p+'[]')
        return e
    if t=='string':
        if type(v) is not str:return [p+':type']
        if 'pattern' in s and not re.search(s['pattern'],v):return [p+':pattern']
        if len(v)<s.get('minLength',0) or len(v)>s.get('maxLength',len(v)):return [p+':length']
        return []
    if t in ('number','integer'):
        if not finite(v) or (t=='integer' and type(v) is not int):return [p+':type']
        if ('minimum' in s and v<s['minimum']) or ('maximum' in s and v>s['maximum']):return [p+':range']
        return []
    if t=='boolean' and type(v) is not bool:return [p+':type']
    return []
def tool_args(tools):
    if tools is None:return [],None
    if type(tools) is not dict or set(tools)!={'mcp_config_path','allowed_tools'}:raise GatewayRefused('BAD_ARGUMENT','tools')
    p=Path(tools['mcp_config_path'])
    if not p.is_absolute() or p.is_symlink() or not p.is_file() or Path(TOOLS_ROOT).resolve() not in p.resolve().parents or p.stat().st_size>65536:raise GatewayRefused('BAD_ARGUMENT','mcp_config_path')
    raw=p.read_bytes()
    try:json.loads(raw)
    except ValueError:raise GatewayRefused('BAD_ARGUMENT','mcp_config_json') from None
    at=tools['allowed_tools']
    if type(at) is not list or not 1<=len(at)<=32 or len(set(at))!=len(at) or not all(type(x) is str and re.fullmatch(r'mcp__[A-Za-z0-9_-]{1,64}__[A-Za-z0-9_-]{1,64}',x) for x in at):raise GatewayRefused('BAD_ARGUMENT','allowed_tools')
    return ['--mcp-config',str(p),'--allowedTools',','.join(at),'--permission-mode','dontAsk'],{'mcpConfigSha256':CL.sha(raw),'allowedTools':sorted(at)}
def command(model,effort,max_usd,schema_text,system,extra=()):
    return [shutil.which('claude') or 'claude','-p','--bare','--settings',json.dumps({'apiKeyHelper':str(KEY_HELPER)}),'--model',model,'--effort',effort,'--tools','','--strict-mcp-config',*extra,
            '--no-session-persistence','--max-budget-usd','%.2f'%max_usd,'--output-format','json','--json-schema',schema_text,'--system-prompt',system]
def _kill(p):
    try:os.killpg(p.pid,signal.SIGKILL)
    except (ProcessLookupError,PermissionError):pass
    try:p.wait(timeout=30)
    except subprocess.TimeoutExpired:pass
def run_cli(cmd,stdin,cwd,env,timeout):
    with tempfile.TemporaryFile() as fo,tempfile.TemporaryFile() as fe:
        p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=fo,stderr=fe,cwd=cwd,env=env,start_new_session=True)
        try:p.communicate(stdin,timeout=timeout)
        except BaseException:
            _kill(p);raise
        fo.seek(0);out=fo.read(RESPONSE_CAP+1);n=fe.seek(0,2);fe.seek(max(0,n-2000));err=fe.read()
        return p.returncode,out,err
def calls_view(rows):
    calls={}
    for i,r in enumerate(rows):
        t=r.get('type');cid=r.get('callId')
        if t=='RESERVED':
            if cid in calls:raise CL.ChainError('LEDGER_DUPLICATE_CALL:%d'%i)
            calls[cid]={'res':r,'out':None}
        elif t=='OUTCOME':
            if cid not in calls or calls[cid]['out'] is not None or r.get('status') not in STATUSES:raise CL.ChainError('LEDGER_ORPHAN_OUTCOME:%d'%i)
            calls[cid]['out']=r
        else:raise CL.ChainError('LEDGER_RECORD_TYPE:%d'%i)
    return calls
def charge(c):
    o=c['out']
    if o is not None and finite(o.get('costUSD')) and o['costUSD']>=0:return float(o['costUSD']),'REPORTED'
    return float(c['res']['maxUSD']),'RESERVED_MAX'
def totals(calls,day=None):
    day=day or kst_day(now());s={'day':day,'dayUSD':0.0,'totalUSD':0.0,'reportedUSD':0.0,'reservedMaxUSD':0.0,'calls':len(calls),'open':0,'byStatus':{},'byDay':{}}
    for c in calls.values():
        usd,basis=charge(c);d=kst_day(c['res']['atEpoch']);st=c['out']['status'] if c['out'] else 'OPEN'
        s['totalUSD']+=usd;s['byDay'][d]=round(s['byDay'].get(d,0.0)+usd,6);s['byStatus'][st]=s['byStatus'].get(st,0)+1
        s['reportedUSD' if basis=='REPORTED' else 'reservedMaxUSD']+=usd;s['open']+=c['out'] is None
        if d==day:s['dayUSD']+=usd
    for k in ('dayUSD','totalUSD','reportedUSD','reservedMaxUSD'):s[k]=round(s[k],6)
    return s
def verify_ledger():
    with CL.locked(ledger_path()):
        try:rows=CL.read(ledger_path());calls=calls_view(rows)
        except CL.ChainError as e:return {'ok':False,'error':str(e)}
    return {'ok':True,'records':len(rows),**totals(calls)}
def spend_summary(day=None):
    with CL.locked(ledger_path()):calls=calls_view(CL.read(ledger_path()))
    return totals(calls,day)
def _args(role,model,effort,system,user,schema,max_usd,run_id,purpose):
    for name,ok in (('role',type(role) is str and re.fullmatch(r'[a-z][a-z0-9_-]{1,31}',role)),('model',type(model) is str and re.fullmatch(r'[a-z][a-z0-9.-]{1,63}(\[1m\])?',model)),
                    ('effort',effort in EFFORTS),('system',type(system) is str and system.strip()),('user',type(user) is str and user.strip()),('schema',type(schema) is dict and schema.get('type')=='object'),
                    ('max_usd',finite(max_usd) and max_usd>=0.01),('run_id',type(run_id) is str and re.fullmatch(r'[A-Z][A-Z0-9_]{0,40}',run_id)),('purpose',type(purpose) is str and re.fullmatch(r'[a-z][a-z0-9_.:-]{0,63}',purpose))):
        if not ok:raise GatewayRefused('BAD_ARGUMENT',name)
def _write_output(obj):
    b=CL.canonical(obj);h=CL.sha(b);d=outputs_dir();d.mkdir(parents=True,exist_ok=True);p=d/(h+'.json')
    if p.exists():
        if p.read_bytes()!=b:raise GatewayFailed('OUTPUT_STORE_MISMATCH',h)
        return h
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    return h
def _sanitize(b):
    s=b.decode('utf-8','replace')[-300:];s=SECRET.sub('[REDACTED]',s);return re.sub(r'/Users/\S*','<path>',s)
def _classify(rc,raw,schema):
    r={'status':'INVALID_OUTPUT','detail':None,'costUSD':None,'usage':None,'durationMs':None,'numTurns':None,'subtype':None,'modelsUsed':None,'output':None,'error':None}
    if len(raw)>RESPONSE_CAP:r['detail']='RESPONSE_TOO_LARGE';return r
    try:d=json.loads(raw)
    except ValueError:d=None
    if type(d) is not dict:r.update(status='CLI_ERROR' if rc!=0 else 'INVALID_OUTPUT',detail='UNPARSEABLE');return r
    if finite(d.get('total_cost_usd')) and d['total_cost_usd']>=0:r['costUSD']=float(d['total_cost_usd'])
    u=d.get('usage') if type(d.get('usage')) is dict else {}
    usage={k:u[k] for k in ('input_tokens','cache_creation_input_tokens','cache_read_input_tokens','output_tokens') if type(u.get(k)) is int}
    th=(u.get('output_tokens_details') or {}).get('thinking_tokens') if type(u.get('output_tokens_details')) is dict else None
    if type(th) is int:usage['thinking_tokens']=th
    r['usage']=usage or None;r['durationMs']=d.get('duration_ms') if type(d.get('duration_ms')) is int else None;r['numTurns']=d.get('num_turns') if type(d.get('num_turns')) is int else None
    sub=d.get('subtype');r['subtype']=sub if type(sub) is str and re.fullmatch(r'[a-z_]{1,40}',sub) else None
    mu=d.get('modelUsage');r['modelsUsed']=sorted(k for k in mu if re.fullmatch(r'[A-Za-z0-9.\[\]_-]{1,80}',k)) if type(mu) is dict else None
    if r['subtype']=='error_max_budget_usd':r.update(status='BUDGET_STOP',detail='MAX_BUDGET_USD');return r
    if rc!=0 or d.get('is_error') is True:r.update(status='CLI_ERROR',detail='RC_%s'%rc if rc else 'IS_ERROR');return r
    so=d.get('structured_output')
    if type(so) is not dict:r['detail']='NO_STRUCTURED_OUTPUT';return r
    b=CL.canonical(so)
    if len(b)>OUTPUT_CAP:r['detail']='OUTPUT_TOO_LARGE';return r
    if SECRET.search(b.decode()):r['detail']='OUTPUT_SECRET_PATTERN';return r
    errs=check_schema(so,schema)
    if errs:r.update(detail='SCHEMA',error=errs[0][:200]);return r
    r.update(status='OK',output=so);return r
def call(*,role,model,effort,system,user,schema,max_usd,run_id,purpose,tools=None,allow_resend=False,runner=None,timeout=TIMEOUT):
    _args(role,model,effort,system,user,schema,max_usd,run_id,purpose)
    schema_text=json.dumps(schema,ensure_ascii=False,sort_keys=True,separators=(',',':'));n=outbound(system,user,schema_text);extra,tool_id=tool_args(tools)
    req_sha=CL.sha(CL.canonical({'model':model,'effort':effort,'system':system,'user':user,'schema':schema,'tools':tool_id}))
    try:ab=json.loads(POLICY.read_bytes()).get('aiBudget') or {};per_day=float(ab['perDayUSD']);total=float(ab['totalUSD']);guard=float(ab.get('perCallGuardUSD',per_day))
    except (OSError,ValueError,KeyError,TypeError):raise GatewayRefused('AI_BUDGET_POLICY') from None
    if max_usd>guard:raise GatewayRefused('MAX_USD_OVER_GUARD','%.2f>%.2f'%(max_usd,guard))
    call_id=uuid.uuid4().hex;lp=ledger_path();cmd=command(model,effort,max_usd,schema_text,system,extra);cwd=tempfile.mkdtemp(prefix='autoloop-ai-')
    try:
        with CL.locked(lp):
            try:rows=CL.read(lp);calls=calls_view(rows)
            except CL.ChainError as e:raise GatewayRefused('LEDGER_BROKEN',str(e)) from None
            if not allow_resend:
                for c in calls.values():
                    if c['res']['requestSha256']==req_sha and (c['out'] is None or c['out']['status'] in HOLD):raise GatewayRefused('HELD_UNKNOWN_OUTCOME',c['res']['callId'])
            s=totals(calls)
            if s['dayUSD']+max_usd>per_day+1e-9:raise GatewayRefused('AI_BUDGET_TODAY','%.4f+%.2f>%.2f'%(s['dayUSD'],max_usd,per_day))
            if s['totalUSD']+max_usd>total+1e-9:raise GatewayRefused('AI_BUDGET_TOTAL','%.4f+%.2f>%.2f'%(s['totalUSD'],max_usd,total))
            CL.append(lp,rows,{'type':'RESERVED','callId':call_id,'role':role,'purpose':purpose,'runId':run_id,'model':model,'effort':effort,'maxUSD':float(max_usd),'requestSha256':req_sha,
                               'sizes':{'system':len(system.encode()),'user':len(user.encode()),'schema':len(schema_text.encode()),'request':n},'tools':tool_id,'allowResend':bool(allow_resend),'atEpoch':now()})
        t0=time.monotonic();rc=None;raw=b'';err=b'';interrupt=None
        try:
            rc,raw,err=(runner or run_cli)(cmd,user.encode(),cwd,scrubbed_env(),timeout);r=_classify(rc,raw,schema)
        except subprocess.TimeoutExpired:r=_classify(0,b'',schema);r.update(status='TIMEOUT',detail='TIMEOUT')
        except BaseException as e:
            r=_classify(0,b'',schema);r.update(status='UNKNOWN',detail='RUNNER_'+type(e).__name__[:40]);interrupt=e if not isinstance(e,Exception) else None
    finally:shutil.rmtree(cwd,ignore_errors=True)
    out_sha=None
    if r['status']=='OK':
        try:out_sha=_write_output(r['output'])
        except (OSError,GatewayFailed):r.update(status='INVALID_OUTPUT',detail='OUTPUT_STORE')
    outcome={'type':'OUTCOME','callId':call_id,'status':r['status'],'detail':r['detail'],'costUSD':r['costUSD'],'usage':r['usage'],'durationMs':r['durationMs'],'wallMs':round((time.monotonic()-t0)*1000),
             'numTurns':r['numTurns'],'subtype':r['subtype'],'modelsUsed':r['modelsUsed'],'returnCode':rc,'responseSha256':CL.sha(raw) if raw else None,'responseBytes':len(raw),'outputSha256':out_sha,'atEpoch':now()}
    with CL.locked(lp):
        try:rows=CL.read(lp);CL.append(lp,rows,outcome)
        except CL.ChainError as e:raise GatewayFailed('LEDGER_BROKEN',str(e)) from None
    if interrupt is not None:raise interrupt
    meta={'callId':call_id,'requestSha256':req_sha,'status':r['status'],'costUSD':r['costUSD'],'chargedUSD':r['costUSD'] if r['costUSD'] is not None else float(max_usd),'durationMs':r['durationMs'],'wallMs':outcome['wallMs'],
          'turns':r['numTurns'],'model':model,'effort':effort,'auth':'api','usage':r['usage'],'modelsUsed':r['modelsUsed'],'outputSha256':out_sha}
    if r['status']!='OK':
        if r['error']:meta['schemaError']=r['error']
        if err:meta['stderrTail']=_sanitize(err)
        raise GatewayFailed(r['status'],r['detail'] or r['subtype'],meta)
    return r['output'],meta
