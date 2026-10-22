import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { historySourceQueryKey } from '../source.ts';
import { verifyActualCatalog, verifyActualGroups, verifyActualInvalidation, verifyActualModel, verifyActualRange, verifyActualReference, verifyActualTrial } from './contract.ts';
import { ACTUAL_METRICS } from './types.ts';
import type { ActualCatalogRequest, ActualGroup, ActualRangeRequest, ActualTrial, Anchor } from './types.ts';
import { siteUrl } from '../../site/env.ts';

export const ACTUAL_KEY = historySourceQueryKey('actual', 'history-actual-v1');
const policy = { retry: false, staleTime: Infinity, gcTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;
export async function readActualHistory<T>(path: string, signal: AbortSignal, verify: (value: unknown) => T): Promise<T> {
  const aborter = new AbortController(), abort = () => aborter.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 7000);
  try {
    const response = await fetch(siteUrl(`api/v8/history/${path}`), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: aborter.signal });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('HISTORY_ACTUAL_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error('HISTORY_ACTUAL_RESPONSE_LIMIT'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error(`HISTORY_ACTUAL_JSON_${response.status}`); }
    if (!response.ok) {
      const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
      throw new Error(typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? `HISTORY_ACTUAL_${code}` : `HISTORY_ACTUAL_HTTP_${response.status}`);
    }
    return verify(value);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function actualCatalogPath(request: ActualCatalogRequest) {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100 ||
    !Number.isSafeInteger(request.snapshotCursor) || request.snapshotCursor < 0 ||
    request.groupRef && !/^[0-9a-f]{64}$/.test(request.groupRef) ||
    request.cursor !== null && (request.cursor.length === 0 || request.cursor.length > 2048) ||
    !['', 'FINISHED', 'FAILED', 'HELD', 'RUNNING'].includes(request.status)) throw new Error('HISTORY_ACTUAL_CATALOG_REQUEST');
  const params = new URLSearchParams({ limit: String(request.limit), direction: 'DESC', snapshotCursor: String(request.snapshotCursor) });
  if (request.groupRef) params.set('groupRef', request.groupRef);
  if (request.status) params.set('status', request.status);
  if (request.cursor) params.set('cursor', request.cursor);
  return `catalog?${params}`;
}
export function actualRangePath(request: ActualRangeRequest) {
  if (!Number.isSafeInteger(request.fromOrdinal) || !Number.isSafeInteger(request.toOrdinal) ||
    request.fromOrdinal < 1 || request.toOrdinal < request.fromOrdinal || request.toOrdinal - request.fromOrdinal >= 10000 ||
    request.mode === 'RAW' && request.toOrdinal - request.fromOrdinal >= 2000 ||
    !Number.isSafeInteger(request.snapshotCursor) || request.snapshotCursor < 0 ||
    !Number.isInteger(request.buckets) || request.buckets < 16 || request.buckets > 500 ||
    !/^[0-9a-f]{64}$/.test(request.groupRef) || !ACTUAL_METRICS.includes(request.metric) ||
    !['RAW', 'MIN_MAX'].includes(request.mode)) throw new Error('HISTORY_ACTUAL_RANGE_REQUEST');
  return `range?${new URLSearchParams({
    groupRef: request.groupRef, metric: request.metric, fromOrdinal: String(request.fromOrdinal), toOrdinal: String(request.toOrdinal),
    mode: request.mode, buckets: String(request.buckets), snapshotCursor: String(request.snapshotCursor),
  })}`;
}
export function useActualGroups() {
  return useQuery({ queryKey: [...ACTUAL_KEY, 'groups'], queryFn: ({ signal }) => readActualHistory('groups', signal, verifyActualGroups), ...policy });
}
export function useActualCatalog(request: ActualCatalogRequest | null) {
  return useQuery({
    queryKey: [...ACTUAL_KEY, 'catalog', request], enabled: request !== null,
    queryFn: ({ signal }) => {
      if (!request) throw new Error('HISTORY_ACTUAL_NO_CATALOG');
      return readActualHistory(actualCatalogPath(request), signal, value => verifyActualCatalog(value, request));
    }, ...policy,
  });
}
export function useActualRanges(request: Omit<ActualRangeRequest, 'metric'> | null) {
  return useQueries({ queries: ACTUAL_METRICS.map(metric => {
    const complete = request ? { ...request, metric } : null;
    return {
      queryKey: [...ACTUAL_KEY, 'range', metric, complete], enabled: complete !== null,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!complete) throw new Error('HISTORY_ACTUAL_NO_RANGE');
        return readActualHistory(actualRangePath(complete), signal, value => verifyActualRange(value, complete));
      }, ...policy,
    };
  }) });
}
export function useActualTrial(trialId: string | null, anchor: Anchor | null, group: ActualGroup | undefined) {
  return useQuery({
    queryKey: [...ACTUAL_KEY, 'trial', trialId, anchor, group?.groupRef], enabled: Boolean(trialId && anchor && group),
    queryFn: ({ signal }) => {
      if (!trialId || !anchor || !group) throw new Error('HISTORY_ACTUAL_NO_TRIAL');
      return readActualHistory(`trials/${encodeURIComponent(trialId)}?snapshotCursor=${anchor.snapshotCursor}`, signal,
        value => verifyActualTrial(value, { ...anchor, trialId, group }));
    }, ...policy,
  });
}
export function useActualModel(trial: ActualTrial | undefined, anchor: Anchor | null, group: ActualGroup | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...ACTUAL_KEY, 'model', trial?.modelId, trial?.modelRevisionRef, anchor, group?.groupRef], enabled: Boolean(enabled && trial && anchor && group),
    queryFn: ({ signal }) => {
      if (!trial || !anchor || !group) throw new Error('HISTORY_ACTUAL_NO_MODEL');
      return readActualHistory(`models/${encodeURIComponent(trial.modelId)}?${new URLSearchParams({ modelRevisionRef: trial.modelRevisionRef, snapshotCursor: String(anchor.snapshotCursor) })}`,
        signal, value => verifyActualModel(value, { ...anchor, trial, group }));
    }, ...policy,
  });
}
export function useActualReference(anchor: Anchor | null, group: ActualGroup | undefined) {
  return useQuery({
    queryKey: [...ACTUAL_KEY, 'reference', anchor, group?.groupRef], enabled: Boolean(anchor && group),
    queryFn: ({ signal }) => {
      if (!anchor || !group) throw new Error('HISTORY_ACTUAL_NO_REFERENCE');
      return readActualHistory(`reference?${new URLSearchParams({ groupRef: group.groupRef, snapshotCursor: String(anchor.snapshotCursor) })}`,
        signal, value => verifyActualReference(value, { ...anchor, group }));
    }, ...policy,
  });
}
export function useActualInvalidations(anchor: Anchor | null) {
  const client = useQueryClient(), latest = useRef(anchor), [state, setState] = useState<'connecting' | 'connected' | 'reread'>('connecting');
  latest.current = anchor;
  useEffect(() => {
    if (!anchor) return;
    let received = anchor.snapshotCursor;
    const source = new EventSource(siteUrl('api/v8/history/events?') + new URLSearchParams({ after: String(anchor.snapshotCursor), historyGenerationId: anchor.historyGenerationId }));
    const refresh = () => void client.invalidateQueries({ queryKey: ACTUAL_KEY, refetchType: 'active' });
    const receive = (event: Event) => {
      try {
        const message = verifyActualInvalidation(JSON.parse((event as MessageEvent<string>).data));
        if (message.historyGenerationId !== latest.current?.historyGenerationId) { setState('reread'); refresh(); return; }
        if (message.commitCursor > received) { received = message.commitCursor; refresh(); }
      } catch { setState('reread'); refresh(); }
    };
    source.onopen = () => setState('connected');
    source.addEventListener('history.actual.invalidate.v1', receive);
    source.onerror = () => { setState('reread'); void client.invalidateQueries({ queryKey: [...ACTUAL_KEY, 'groups'] }); };
    return () => { source.removeEventListener('history.actual.invalidate.v1', receive); source.close(); };
  }, [anchor?.historyGenerationId, anchor?.snapshotCursor, client]);
  return state;
}
