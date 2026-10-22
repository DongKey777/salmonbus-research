import {useQuery} from '@tanstack/react-query';
import type {Cycle,Run} from '../cycles/contract';
import {siteUrl} from '../site/env.ts';
type Model={modelId:string;modelDefinitionId:string;weightsRef:string;candidateId:string;cycleIndex:number;runId:string;modelReceiptRef:string;sourceArchiveRef:string;workerManifestRef:string;gitCommit:string;adopted:false};
type Evaluation={evaluationId:string;modelId:string;reportRef:string;groupRef:string};
type Catalog={models:Model[];evaluations:Evaluation[]};
const hash=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
async function bounded(url:string,cap:number,signal:AbortSignal){const r=await fetch(siteUrl(url),{signal,cache:'no-store'});if(!r.ok)throw Error('MODEL_CATALOG_HTTP_'+r.status);const text=await r.text();if(new TextEncoder().encode(text).length>cap)throw Error('MODEL_CATALOG_SIZE');return text;}
async function catalog(runId:string,signal:AbortSignal):Promise<Catalog|null>{
 const index=JSON.parse(await bounded('/model-catalog/index.json',16384,signal));if(index.schema!=='model-catalog-index/1')throw Error('MODEL_INDEX_SCHEMA');
 const binding=index.runs?.[runId];if(!binding)return null;
 if(!/^\/model-catalog\/[a-z0-9-]+\.json$/.test(binding.path)||!hash(binding.sha256))throw Error('MODEL_INDEX_BINDING');
 const text=await bounded(binding.path,262144,signal);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
 if(digest!==binding.sha256)throw Error('MODEL_CATALOG_BYTES');
 const v=JSON.parse(text);
 if(v.schema!=='research-model-catalog/1'||v.sourceKind!=='SYNTHETIC_MODEL_EXECUTION'||v.runId!==runId||v.modelCount!==6||v.evaluationCount!==6||v.mlflowConnected!==false||v.selectionDoesNotDeploy!==true||!Array.isArray(v.models)||v.models.length!==6||!Array.isArray(v.evaluations)||v.evaluations.length!==6)throw Error('MODEL_CATALOG_SCOPE');
 const ids=new Set<string>();
 for(const m of v.models){if(m.runId!==runId||m.adopted!==false||!Number.isInteger(m.cycleIndex)||m.cycleIndex<0||m.cycleIndex>5||typeof m.candidateId!=='string'||![m.modelId,m.modelDefinitionId,m.weightsRef,m.modelReceiptRef,m.sourceArchiveRef,m.workerManifestRef].every(hash)||ids.has(m.modelId))throw Error('MODEL_IDENTITY');ids.add(m.modelId);}
 for(const e of v.evaluations)if(!ids.has(e.modelId)||![e.evaluationId,e.modelId,e.reportRef,e.groupRef].every(hash))throw Error('MODEL_EVALUATION_IDENTITY');
 return v;
}
export function ModelVersion({run,cycle}:{run:Run;cycle:Cycle}){
 const q=useQuery({queryKey:['local-model-catalog',run.runId],queryFn:({signal})=>catalog(run.runId,signal),enabled:run.sourceKind==='SYNTHETIC_MODEL_EXECUTION'&&run.status==='CLOSED',staleTime:Infinity,retry:false});
 if(run.status!=='CLOSED'||!cycle.report)return null;
 if(q.error)return <p role="alert">모델 판본 연결을 확인하지 못했습니다. 등록된 평가 결과는 위 기록에서 확인할 수 있습니다.</p>;
 const m=q.data?.models.find(x=>x.runId===run.runId&&x.cycleIndex===cycle.cycleIndex&&x.candidateId===cycle.candidateId&&x.modelReceiptRef===cycle.model.receiptRef);
 const e=m?q.data?.evaluations.find(e=>e.modelId===m.modelId&&e.reportRef===cycle.report?.reportHash&&e.groupRef===cycle.report?.groupRef):null;
 if(!m||!e)return <p>완료된 모델의 판본 정보를 준비하고 있습니다.</p>;
 return <section aria-label="선택한 모델 판본"><h3>모델 판본</h3><p>모델과 평가를 별도 ID로 보존합니다. 현재 선택은 배포나 채택을 뜻하지 않습니다.</p><dl><dt>모델 ID</dt><dd>{m.modelId}</dd><dt>평가 ID</dt><dd>{e.evaluationId}</dd><dt>학습 산출물</dt><dd>{m.weightsRef}</dd><dt>실행 소스 보관본</dt><dd>{m.sourceArchiveRef}</dd><dt>Worker 판본</dt><dd>{m.workerManifestRef}</dd><dt>코드 기준 commit</dt><dd>{m.gitCommit} · 별도 보관한 연구 소스 포함</dd></dl></section>;
}
