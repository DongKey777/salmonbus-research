"""Hand the running (older) loop process over to the current loop.py when it exits on its own. Restarts only after the
state-derived stops the current code handles better (daily budget becomes a wait, final stops run sealed H); every other
stop is left for a person, as the policy says.
usage: handover.py <old-loop-pid>"""
import json,subprocess,sys,time
from pathlib import Path
A=Path(__file__).resolve().parent
def log(event,**kw):
    rec={'event':event,'atEpoch':time.time(),'atKST':time.strftime('%Y-%m-%d %H:%M:%S'),**kw}
    with (A/'loop-events.jsonl').open('a') as f:f.write(json.dumps(rec,ensure_ascii=False)+'\n')
def alive(pid):return subprocess.run(['kill','-0',str(pid)],capture_output=True).returncode==0
def main(pid):
    while alive(pid):time.sleep(30)
    ev=[json.loads(l) for l in (A/'loop-events.jsonl').read_text().splitlines() if l.strip()]
    stop=next((e for e in reversed(ev) if e['event']=='LOOP_STOP'),None);reason=stop and stop.get('reason')
    if reason in ('BUDGET_EXHAUSTED','NO_IMPROVEMENT_ROUNDS','OVER_BUDGET') and not (A/'STOP').exists():
        out=open(A/'loop.out','a')
        p=subprocess.Popen(['caffeinate','-i','-s','python3','-u',str(A/'loop.py'),'--rounds','100','--wait-hours','8'],cwd=A,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
        log('HANDOVER_RESTART',previousReason=reason,newPid=p.pid)
    else:log('HANDOVER_NO_RESTART',previousReason=reason)
if __name__=='__main__':main(int(sys.argv[1]))
