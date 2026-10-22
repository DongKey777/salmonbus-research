import { useQuery } from '@tanstack/react-query';
import { verifyFeaturesV2Report } from './contract.ts';
import { FEATURES_V2_LIMITS, FEATURES_V2_SCHEMA } from './types.ts';
import { siteUrl } from '../site/env.ts';

export async function readFeaturesV2Report(signal: AbortSignal, now: number = Date.now()) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('features-v2-report.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`FEATURES_V2_HTTP_${response.status}`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('FEATURES_V2_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > FEATURES_V2_LIMITS.responseBytes) { await reader.cancel(); throw new Error('FEATURES_V2_RESPONSE_LIMIT'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('FEATURES_V2_INVALID_JSON'); }
    return verifyFeaturesV2Report(value, now);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useFeaturesV2Report() {
  return useQuery({ queryKey: [FEATURES_V2_SCHEMA], queryFn: ({ signal }) => readFeaturesV2Report(signal), retry: false, refetchInterval: 10000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
