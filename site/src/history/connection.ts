import { useQueries, useQuery } from '@tanstack/react-query';
import { verifyAnchor, verifyCatalog, verifyGroups, verifyModelDetail, verifyRange, verifyTrialDetail } from './contract.ts';
import { METRICS } from './types.ts';
import { historySourceQueryKey } from './source.ts';
import type { Catalog, CatalogRequest, Envelope, RangeRequest, SnapshotCursor, Trial } from './types.ts';
import { siteUrl } from '../site/env.ts';

export const HISTORY_KEY = 'history-monitor-v1';
const ROOT = siteUrl('api/v6/history');
const MAX_BYTES = 1024 * 1024;
const queryPolicy = { retry: false, staleTime: Infinity, gcTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;
export class HistoryReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'HistoryReadError'; this.code = code; }
}
/** A closed, same-origin GET with a bounded body. No execution or write endpoints exist here. */
export async function readHistory<T>(path: string, signal: AbortSignal, verify: (value: unknown) => T): Promise<T> {
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 7000);
  try {
    const response = await fetch(`${ROOT}/${path}`, { method: 'GET', cache: 'no-store', signal: timeout.signal });
    const size = response.headers.get('content-length');
    if (size && Number(size) > MAX_BYTES) {
      await response.body?.cancel();
      throw new HistoryReadError('RESPONSE_LIMIT');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HistoryReadError('EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new HistoryReadError('RESPONSE_LIMIT');
      }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { throw new HistoryReadError(`INVALID_JSON_${response.status}`); }
    if (!response.ok) {
      const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
      throw new HistoryReadError(typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : `HTTP_${response.status}`);
    }
    return verify(payload);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export function catalogPath(request: CatalogRequest): string {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new HistoryReadError('PAGE_LIMIT');
  if ((request.groupRef && !/^[0-9a-f]{64}$/.test(request.groupRef)) ||
    !['', 'FINISHED', 'FAILED', 'HELD', 'RUNNING'].includes(request.status) ||
    (request.cursor !== null && (typeof request.cursor !== 'string' || request.cursor.length === 0 || request.cursor.length > 2048))) throw new HistoryReadError('CATALOG_FILTER');
  const params = new URLSearchParams({ limit: String(request.limit), direction: 'DESC' });
  if (request.groupRef) params.set('groupRef', request.groupRef);
  if (request.status) params.set('status', request.status);
  if (request.cursor) params.set('cursor', request.cursor);
  return `catalog?${params}`;
}
export function rangePath(request: RangeRequest): string {
  if (!Number.isSafeInteger(request.fromOrdinal) || !Number.isSafeInteger(request.toOrdinal) ||
    request.fromOrdinal < 1 || request.toOrdinal < request.fromOrdinal || request.toOrdinal - request.fromOrdinal >= 10000 ||
    (request.mode === 'RAW' && request.toOrdinal - request.fromOrdinal >= 2000) ||
    !Number.isInteger(request.buckets) || request.buckets < 16 || request.buckets > 500 ||
    !Number.isSafeInteger(request.snapshotCursor) || request.snapshotCursor < 0 ||
    !/^[0-9a-f]{64}$/.test(request.groupRef) || !METRICS.includes(request.metric) ||
    !['RAW', 'MIN_MAX'].includes(request.mode)) throw new HistoryReadError('RANGE_LIMIT');
  return `range?${new URLSearchParams({
    groupRef: request.groupRef, metric: request.metric,
    fromOrdinal: String(request.fromOrdinal), toOrdinal: String(request.toOrdinal),
    mode: request.mode, buckets: String(request.buckets), snapshotCursor: String(request.snapshotCursor),
  })}`;
}
export function useHistoryGroups() {
  return useQuery({
    queryKey: historySourceQueryKey('fixture', HISTORY_KEY, 'groups'),
    queryFn: ({ signal }) => readHistory('groups', signal, verifyGroups), ...queryPolicy,
  });
}
export type Anchor = Pick<Envelope<unknown>, 'historyGenerationId' | 'snapshotCursor'>;
export function useHistoryCatalog(
  request: CatalogRequest, session: number, enabled: boolean, pageAnchor?: Anchor, initialPage?: Envelope<Catalog>,
) {
  return useQuery({
    queryKey: historySourceQueryKey('fixture', HISTORY_KEY, 'catalog', session, request),
    enabled,
    initialData: request.cursor === null ? initialPage : undefined,
    queryFn: ({ signal }) => readHistory(catalogPath(request), signal, value => {
      const result = verifyCatalog(value, request);
      if (pageAnchor) verifyAnchor(result, pageAnchor);
      return result;
    }), ...queryPolicy,
  });
}
export function useHistoryRanges(request: Omit<RangeRequest, 'metric'> | null) {
  return useQueries({
    queries: METRICS.map(metric => {
      const full = request ? { ...request, metric } : null;
      return {
        queryKey: historySourceQueryKey('fixture', HISTORY_KEY, 'range', metric, full), enabled: full !== null,
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!full) throw new HistoryReadError('NO_RANGE');
          return readHistory(rangePath(full), signal, value => verifyRange(value, full));
        }, ...queryPolicy,
      };
    }),
  });
}
export function useHistoryTrial(trialId: string | null, anchor: Anchor | null) {
  return useQuery({
    queryKey: historySourceQueryKey('fixture', HISTORY_KEY, 'trial', trialId, anchor),
    enabled: trialId !== null && anchor !== null,
    queryFn: ({ signal }) => {
      if (!trialId || !anchor) throw new HistoryReadError('NO_TRIAL');
      return readHistory(`trials/${encodeURIComponent(trialId)}?${new URLSearchParams({ snapshotCursor: String(anchor.snapshotCursor) })}`,
        signal, value => verifyTrialDetail(value, { ...anchor, trialId }));
    }, ...queryPolicy,
  });
}
export function useHistoryModel(trial: Trial | undefined, anchor: { historyGenerationId: string; snapshotCursor: SnapshotCursor } | null) {
  return useQuery({
    queryKey: historySourceQueryKey('fixture', HISTORY_KEY, 'model', trial?.modelId, trial?.modelRevisionRef, anchor),
    enabled: trial !== undefined && anchor !== null,
    queryFn: ({ signal }) => {
      if (!trial || !anchor) throw new HistoryReadError('NO_MODEL');
      const params = new URLSearchParams({ modelRevisionRef: trial.modelRevisionRef, snapshotCursor: String(anchor.snapshotCursor) });
      return readHistory(`models/${encodeURIComponent(trial.modelId)}?${params}`, signal,
        value => verifyModelDetail(value, { ...anchor, modelId: trial.modelId, modelRevisionRef: trial.modelRevisionRef }));
    }, ...queryPolicy,
  });
}
