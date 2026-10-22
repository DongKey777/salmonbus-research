import { useQuery } from '@tanstack/react-query';
import { verifyFullTrainingProgress } from './contract.ts';
import type { FullTrainingProgress } from './types.ts';
import { FullPreparationReadError } from './errors.ts';
import { siteUrl } from '../site/env.ts';
export async function readFullPreparation(signal: AbortSignal): Promise<FullTrainingProgress> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('full-preparation.json'), {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw new FullPreparationReadError(`HTTP_${response.status}`, response.status); }
    const limit = 32 * 1024, size = response.headers.get('content-length');
    if (size && Number(size) > limit) { await response.body?.cancel(); throw new FullPreparationReadError('RESPONSE_LIMIT'); }
    const reader = response.body?.getReader();
    if (!reader) throw new FullPreparationReadError('EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new FullPreparationReadError('RESPONSE_LIMIT'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new FullPreparationReadError('INVALID_JSON'); }
    return verifyFullTrainingProgress(value);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useFullPreparation() {
  return useQuery({
    // Keep the existing cache identity when accepting v2, including last-good v1 data.
    queryKey: ['full-training-progress/1', 'public-status-file'],
    queryFn: ({ signal }) => readFullPreparation(signal),
    retry: false, refetchInterval: 10000, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
}
