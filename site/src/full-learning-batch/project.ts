import type { FullLearningBatch } from './types.ts';

/** Callback totals include parent trees; targets do not establish completed work. */
export function activeRounds(data: FullLearningBatch) {
  if (!data.candidate) return null;
  const model = data.models.find(item => item.id === data.candidate);
  if (!model || model.observedRounds === null) return null;
  const parentRounds = model.id === 'A' ? 64 : 128;
  const added = model.observedRounds - parentRounds;
  return { id: model.id, observedTotal: model.observedRounds, targetTotal: model.targetRounds, parentRounds,
    observedAdditional: added, targetAdditional: model.targetRounds - parentRounds };
}
