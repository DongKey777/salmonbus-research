"""Append-only JSONL with a SHA-256 hash chain, shared by the AI call ledger and the research journal.
Each record carries prevSha256 (previous record's sha256, or 64 zeros) and sha256 over its own canonical JSON without that field.
Appends hold an exclusive flock on <file>.lock, re-verify the whole chain first, and fsync the line."""
import contextlib,fcntl,hashlib,json,os
from pathlib import Path
GENESIS='0'*64
class ChainError(Exception):pass
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
@contextlib.contextmanager
def locked(path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(str(path)+'.lock',os.O_RDWR|os.O_CREAT,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX);yield
    finally:
        fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
def read(path):
    path=Path(path)
    if not path.exists():return []
    if path.is_symlink() or not path.is_file():raise ChainError('CHAIN_FILE')
    raw=path.read_bytes();rows=[];prev=GENESIS
    if raw and not raw.endswith(b'\n'):raise ChainError('CHAIN_TRUNCATED')
    for i,line in enumerate(raw.split(b'\n')[:-1]):
        try:r=json.loads(line)
        except ValueError:raise ChainError('CHAIN_PARSE:%d'%i) from None
        if type(r) is not dict:raise ChainError('CHAIN_RECORD:%d'%i)
        own=r.pop('sha256',None)
        if r.get('prevSha256')!=prev:raise ChainError('CHAIN_LINK:%d'%i)
        if own!=sha(canonical(r)):raise ChainError('CHAIN_HASH:%d'%i)
        r['sha256']=own;rows.append(r);prev=own
    return rows
def append(path,rows,record):
    rec={k:v for k,v in record.items() if k not in ('sha256','prevSha256')};rec['prevSha256']=rows[-1]['sha256'] if rows else GENESIS;rec['sha256']=sha(canonical(rec))
    fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
    with os.fdopen(fd,'ab') as f:
        f.write(canonical(rec)+b'\n');f.flush();os.fsync(f.fileno())
    rows.append(rec);return rec
