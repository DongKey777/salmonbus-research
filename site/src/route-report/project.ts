import type { RouteModel, RouteReport } from './types.ts';

export type RouteSort = 'weight' | 'mae' | 'delta';
export interface RouteRow {
  token: string; devRows: number; devGroups: number; weightSum: number; weightShare: number;
  trainSupport: { rows: number; groups: number } | null;
  MAE: number; MSE: number;
  pairedMAEDelta: number | null; relativeImprovementPct: number | null;
}
export function referenceModel(data: RouteReport) { return data.models.find(model => model.role === 'REFERENCE')!; }
export function defaultModelId(data: RouteReport) { return (data.models.find(model => model.role === 'CANDIDATE') ?? referenceModel(data)).id; }
export function selectModel(data: RouteReport, id: string | null): RouteModel {
  return data.models.find(model => model.id === id) ?? data.models.find(model => model.id === defaultModelId(data))!;
}
function improvement(delta: number | null, referenceMAE: number | null) {
  return delta === null || referenceMAE === null || referenceMAE <= 0 ? null : (-delta / referenceMAE) * 100;
}
/** Small routes stay listed; support columns travel with every row and no threshold declares sufficiency. */
export function routeRows(data: RouteReport, model: RouteModel, sort: RouteSort): RouteRow[] {
  const reference = referenceModel(data), total = data.routes.reduce((sum, route) => sum + route.weightSum, 0) + data.unknown.weightSum;
  const rows = data.routes.map((route, index) => {
    const score = model.routes[index], referenceScore = reference.routes[index];
    return { token: route.token, devRows: route.devRows, devGroups: route.devGroups, weightSum: route.weightSum, weightShare: route.weightSum / total, trainSupport: route.trainSupport,
      MAE: score.MAE, MSE: score.MSE, pairedMAEDelta: score.pairedMAEDelta, relativeImprovementPct: improvement(score.pairedMAEDelta, referenceScore.MAE) };
  });
  const order = sort === 'weight' ? (a: RouteRow, b: RouteRow) => b.weightSum - a.weightSum
    : sort === 'mae' ? (a: RouteRow, b: RouteRow) => b.MAE - a.MAE
    : (a: RouteRow, b: RouteRow) => (a.pairedMAEDelta ?? Number.POSITIVE_INFINITY) - (b.pairedMAEDelta ?? Number.POSITIVE_INFINITY);
  return rows.sort((a, b) => order(a, b) || a.token.localeCompare(b.token));
}
export function summary(data: RouteReport, model: RouteModel) {
  const reference = referenceModel(data), total = data.routes.reduce((sum, route) => sum + route.weightSum, 0) + data.unknown.weightSum;
  return {
    micro: { ...model.micro, relativeImprovementPct: improvement(model.micro.pairedMAEDelta, reference.micro.MAE), matchesPublished: model.publishedGlobal !== null, publishedSource: model.publishedGlobal?.source ?? null },
    macro: model.knownRouteMacro,
    unknown: { ...model.unknown, devRows: data.unknown.devRows, devGroups: data.unknown.devGroups, weightShare: data.unknown.weightSum / total },
    devOnlyRoutes: data.routes.filter(route => route.trainSupport === null).length,
    isReference: model.role === 'REFERENCE', referenceId: reference.id,
  };
}
