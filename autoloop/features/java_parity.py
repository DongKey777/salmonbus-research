"""Local-only Java 21 parity proof for derived features. Emits the generated class with dsl.java_class (byte-identical to what the worker
records), compiles it with the local JDK next to a small reflection harness, runs every feature on its golden vector rows and compares the
float results with the reference outputs: exact, except at most 1 float32 ulp when the expression contains log1p or sqrt. Never runs in the pod.
usage: java_parity.py <experiment.json | candidate.json | list-of-asts.json>"""
import hashlib,json,re,shutil,struct,subprocess,sys,tempfile,types
from pathlib import Path
F=Path(__file__).resolve().parent
D=types.ModuleType('features_dsl');D.__file__=str(F/'dsl.py');exec(compile((F/'dsl.py').read_bytes(),D.__file__,'exec'),D.__dict__)
HARNESS='''import java.io.BufferedReader;
import java.io.FileReader;
import java.io.PrintWriter;
import java.lang.reflect.Method;
import java.util.Arrays;

public final class ParityMain {
    public static void main(final String[] args) throws Exception {
        try (BufferedReader in = new BufferedReader(new FileReader(args[0])); PrintWriter out = new PrintWriter(args[1])) {
            final Class<?> features = Class.forName(args[2]);
            String line;
            while ((line = in.readLine()) != null) {
                final String[] head = line.trim().split(" ");
                final int inputs = Integer.parseInt(head[1]);
                final int rows = Integer.parseInt(head[2]);
                final Class<?>[] types = new Class<?>[inputs];
                Arrays.fill(types, double.class);
                final Method method = features.getMethod(head[0], types);
                out.println(head[0]);
                for (int i = 0; i < rows; i++) {
                    final String[] cells = in.readLine().trim().split(" ");
                    final Object[] values = new Object[inputs];
                    for (int j = 0; j < inputs; j++) {
                        values[j] = (double) Float.intBitsToFloat((int) Long.parseLong(cells[j], 16));
                    }
                    out.println(Integer.toHexString(Float.floatToRawIntBits((Float) method.invoke(null, values))));
                }
            }
        }
    }
}
'''
def jdk():
    javac=shutil.which('javac');java=shutil.which('java')
    if not javac or not java:return None
    v=subprocess.run([javac,'-version'],capture_output=True,text=True).stdout+subprocess.run([javac,'-version'],capture_output=True,text=True).stderr
    m=re.search(r'javac (\d+)',v);return {'javac':javac,'java':java,'version':v.strip(),'major':int(m.group(1)) if m else 0}
def prove(asts,vectors=None):
    j=jdk()
    if j is None or j['major']<21:return {'ok':False,'reason':'JDK21_MISSING'}
    src=D.java_class(asts);names=[];vecs={}
    for a in asts:
        nm=D.name(a)
        if nm not in vecs:names.append(nm);vecs[nm]=(vectors or {}).get(nm) or D.parity_vector(a)
    with tempfile.TemporaryDirectory(prefix='dsl-java-') as t:
        t=Path(t);(t/(D.JAVA_CLASS+'.java')).write_text(src);(t/'ParityMain.java').write_text(HARNESS)
        lines=[]
        for nm in names:
            v=vecs[nm];lines.append('%s %d %d'%(nm,len(v['inputs']),len(v['rows'])))
            lines+=[' '.join('%08x'%D._bits(D.NAN if x is None else x) for x in r) for r in v['rows']]
        (t/'in.txt').write_text('\n'.join(lines)+'\n')
        c=subprocess.run([j['javac'],'--release','21','-Xlint:all','-d',str(t/'classes'),str(t/(D.JAVA_CLASS+'.java')),str(t/'ParityMain.java')],capture_output=True,text=True)
        if c.returncode:return {'ok':False,'reason':'JAVAC_FAILED','stderr':c.stderr[-2000:]}
        r=subprocess.run([j['java'],'-cp',str(t/'classes'),'ParityMain',str(t/'in.txt'),str(t/'out.txt'),D.JAVA_CLASS],capture_output=True,text=True)
        if r.returncode:return {'ok':False,'reason':'JAVA_FAILED','stderr':r.stderr[-2000:]}
        out=(t/'out.txt').read_text().split('\n');rep={};i=0
        for nm in names:
            assert out[i]==nm;n=len(vecs[nm]['rows'])
            got=[struct.unpack('<f',struct.pack('<I',int(h,16)))[0] for h in out[i+1:i+1+n]];i+=1+n
            rep[nm]=D.compare(got,vecs[nm]);rep[nm]['parityVectorSha256']=D.parity_sha(vecs[nm])
    return {'ok':all(x['ok'] for x in rep.values()),'javaSourceSha256':hashlib.sha256(src.encode()).hexdigest(),'jdk':j['version'],'javacWarnings':c.stderr.strip(),'features':rep}
def candidates_of(obj):
    if isinstance(obj,list):return [{'candidate':'ASTS','derivedFeatures':obj}]
    return [c for c in (obj.get('candidates') or [obj]) if c.get('derivedFeatures')]
if __name__=='__main__':
    obj=json.loads(Path(sys.argv[1]).read_bytes());res={c['candidate']:prove(c['derivedFeatures']) for c in candidates_of(obj)}
    print(json.dumps(res,indent=1,sort_keys=True));sys.exit(0 if all(r['ok'] for r in res.values()) else 1)
