import { useQuery } from '@tanstack/react-query';
import { verifyFullDepthSweep } from './contract.ts';
import { DEPTH_RUN_ID, DEPTH_SCHEMA } from './types.ts';
import { siteUrl } from '../site/env.ts';

export async function readFullDepthSweep(signal: AbortSignal, now: number = Date.now()) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('full-depth-sweep.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`FULL_DEPTH_SWEEP_HTTP_${response.status}`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('FULL_DEPTH_SWEEP_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > 32768) { await reader.cancel(); throw new Error('FULL_DEPTH_SWEEP_RESPONSE_LIMIT'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('FULL_DEPTH_SWEEP_INVALID_JSON'); }
    return verifyFullDepthSweep(value, now);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useFullDepthSweep() {
  return useQuery({ queryKey: [DEPTH_SCHEMA, DEPTH_RUN_ID], queryFn: ({ signal }) => readFullDepthSweep(signal), retry: false, refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
