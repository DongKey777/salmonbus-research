export type RegistryModel = {
  id: string; status: string; runId: string | null; totalRounds: number; maxDepth: number | null; trainingPath: string; parentModelId: string | null;
  MAE: number; RMSE: number; MSE: number | null; gateBaselineModelId: string | null; gatePassed: boolean | null; bestObservedDevModel: boolean;
  devRowsScored: number | null; artifactSha256: string; recordSha256: string; DEVReused: boolean; modelAdoption: false; generalizationClaim: false;
};
export type RegistryEdge = { from: string; to: string; kind: string; additionalRounds: number };
export type ModelRegistry = { schema: 'model-registry-public/1'; origin: 'REAL_OBSERVATION_PIPELINE'; registryIndexSha256: string; generatedAt: string; models: RegistryModel[]; lineage: RegistryEdge[]; gateReferences: { baseline: string; candidate: string }[]; note: string };

const fail = (code: string): never => { throw new Error('MODEL_REGISTRY_' + code); };
const obj = (v: unknown, code: string) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(code));
const closed = (v: unknown, keys: string[], code: string) => { const o = obj(v, code); const k = Object.keys(o).sort(); if (k.join() !== [...keys].sort().join()) fail(code + '_KEYS'); return o; };
const hex = (v: unknown, code: string) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : fail(code));
const finite = (v: unknown, code: string) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail(code));
const MODEL_KEYS = ['id', 'status', 'runId', 'totalRounds', 'maxDepth', 'trainingPath', 'parentModelId', 'MAE', 'RMSE', 'MSE', 'gateBaselineModelId', 'gatePassed', 'bestObservedDevModel', 'devRowsScored', 'artifactSha256', 'recordSha256', 'DEVReused', 'modelAdoption', 'generalizationClaim'];

export function verifyModelRegistry(value: unknown): ModelRegistry {
  const d = closed(value, ['schema', 'origin', 'registryIndexSha256', 'generatedAt', 'models', 'lineage', 'gateReferences', 'note'], 'ROOT');
  if (d.schema !== 'model-registry-public/1' || d.origin !== 'REAL_OBSERVATION_PIPELINE') fail('SCHEMA_ORIGIN');
  hex(d.registryIndexSha256, 'INDEX_PIN');
  if (typeof d.generatedAt !== 'string' || Number.isNaN(Date.parse(d.generatedAt))) fail('GENERATED_AT');
  if (!Array.isArray(d.models) || d.models.length < 1 || d.models.length > 64) fail('MODELS');
  const ids = new Set<string>();
  const models = (d.models as unknown[]).map((entry, i) => {
    const m = closed(entry, MODEL_KEYS, 'MODEL_' + i);
    if (typeof m.id !== 'string' || !/^SEAT\.[A-Za-z0-9_]{1,32}$/.test(m.id) || ids.has(m.id)) fail('MODEL_ID_' + i);
    ids.add(m.id as string);
    if (typeof m.status !== 'string' || /SYNTHETIC|ARTIFICIAL|FIXTURE/.test(m.status)) fail('MODEL_STATUS_' + i);
    if (!Number.isInteger(m.totalRounds) || (m.totalRounds as number) < 1 || (m.totalRounds as number) > 10000) fail('MODEL_ROUNDS_' + i);
    if (m.maxDepth !== null && (!Number.isInteger(m.maxDepth) || (m.maxDepth as number) < 1 || (m.maxDepth as number) > 32)) fail('MODEL_DEPTH_' + i);
    finite(m.MAE, 'MODEL_MAE_' + i); finite(m.RMSE, 'MODEL_RMSE_' + i); if (m.MSE !== null) finite(m.MSE, 'MODEL_MSE_' + i);
    if (m.gatePassed !== null && typeof m.gatePassed !== 'boolean') fail('MODEL_GATE_' + i);
    if (typeof m.bestObservedDevModel !== 'boolean' || typeof m.DEVReused !== 'boolean') fail('MODEL_FLAGS_' + i);
    if (m.modelAdoption !== false || m.generalizationClaim !== false) fail('MODEL_CLAIMS_' + i);
    hex(m.artifactSha256, 'MODEL_ARTIFACT_' + i); hex(m.recordSha256, 'MODEL_RECORD_' + i);
    return m as unknown as RegistryModel;
  });
  for (const m of models) {
    if (m.parentModelId !== null && !ids.has(m.parentModelId)) fail('PARENT_' + m.id);
    if (m.gateBaselineModelId !== null && !ids.has(m.gateBaselineModelId)) fail('GATE_BASELINE_' + m.id);
  }
  const bestRuns = models.filter(m => m.bestObservedDevModel).map(m => m.runId ?? 'NO_RUN');
  if (new Set(bestRuns).size !== bestRuns.length) fail('BEST_COUNT_PER_RUN');
  if (!Array.isArray(d.lineage)) fail('LINEAGE');
  for (const [i, e] of (d.lineage as unknown[]).entries()) {
    const edge = closed(e, ['from', 'to', 'kind', 'additionalRounds'], 'EDGE_' + i);
    if (!ids.has(edge.from as string) || !ids.has(edge.to as string)) fail('EDGE_NODE_' + i);
  }
  if (!Array.isArray(d.gateReferences)) fail('GATE_REFS');
  if (typeof d.note !== 'string') fail('NOTE');
  return d as unknown as ModelRegistry;
}
