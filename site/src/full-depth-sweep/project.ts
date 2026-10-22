import type { DepthModel, DepthModelId, FullDepthSweep } from './types.ts';

/** Candidate-local rounds intentionally restart at zero for each fresh fit. */
export function activeDepthRounds(data: FullDepthSweep) {
  if (!data.candidate) return null;
  const model = data.models.find(item => item.id === data.candidate);
  if (!model || model.observedRounds === null) return null;
  return { id: model.id, depth: model.depth, observed: model.observedRounds, target: model.targetRounds };
}
/** DEV coverage is scoring work, never a count of accepted training runs. */
export function depthEvaluationProgress(data: FullDepthSweep) {
  return data.phase === 'EVALUATING' && data.devRowsProcessed !== null ? { observed: data.devRowsProcessed, total: data.devRows } : null;
}
export interface SeatContrast { seatDelta: number; relativeImprovementPct: number | null }
export interface DepthContrast {
  id: DepthModelId; depth: number; MAE: number; RMSE: number; gatePassed: boolean | null; isControl: boolean;
  vsFreshControl: SeatContrast | null;
  vsContinuedReference: SeatContrast;
}
function contrast(model: DepthModel, reference: DepthModel): SeatContrast {
  const seatDelta = model.metrics!.MAE - reference.metrics!.MAE;
  return { seatDelta, relativeImprovementPct: reference.metrics!.MAE > 0 ? (-seatDelta / reference.metrics!.MAE) * 100 : null };
}
/** Fresh D6 is the depth control; the continued B256 pair also differs in training path. Only sealed scores are compared. */
export function depthContrasts(data: FullDepthSweep): DepthContrast[] | null {
  if (data.phase !== 'COMPLETE') return null;
  const fresh = data.models.filter(model => model.trainingMode === 'FRESH_FROM_ZERO');
  const control = fresh.find(model => model.depth === 6), reference = data.models[0];
  if (!control || !control.metrics || !reference.metrics || fresh.some(model => !model.metrics)) return null;
  return fresh.map(model => ({
    id: model.id, depth: model.depth, MAE: model.metrics!.MAE, RMSE: model.metrics!.RMSE, gatePassed: model.gatePassed, isControl: model.id === control.id,
    vsFreshControl: model.id === control.id ? null : contrast(model, control),
    vsContinuedReference: contrast(model, reference),
  }));
}
