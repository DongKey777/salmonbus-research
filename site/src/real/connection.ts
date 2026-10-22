import { useQuery } from '@tanstack/react-query';
import { verifyRealPilot } from './contract.ts';
import type { PilotRead } from './types.ts';
import { siteUrl } from '../site/env.ts';

const MAX_BYTES = 32 * 1024;
export async function readPilotJsonFile(file: 'summary.json' | 'support.json', signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl(`real-pilot/${file}`), {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal,
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`REAL_PILOT_HTTP_${response.status}`); }
    const length = response.headers.get('content-length');
    if (length && Number(length) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('REAL_PILOT_RESPONSE_LIMIT');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('REAL_PILOT_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('REAL_PILOT_RESPONSE_LIMIT'); }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { throw new Error('REAL_PILOT_INVALID_JSON'); }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    return { payload, sha256 };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export async function readRealPilot(signal: AbortSignal): Promise<PilotRead> {
  const result = await readPilotJsonFile('summary.json', signal);
  return result === null ? { state: 'pending' } : {
    state: 'scored', summary: verifyRealPilot(result.payload), publicSummarySha256: result.sha256,
  };
}
export function useRealPilot() {
  return useQuery({
    queryKey: ['real-pilot-public-summary/1', 'pinned-bytes'],
    queryFn: ({ signal }) => readRealPilot(signal),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    // The export is a saved result, not a stream or a training heartbeat.
    refetchInterval: query => query.state.data?.state === 'pending' ? 10000 : false,
    refetchIntervalInBackground: false,
  });
}
