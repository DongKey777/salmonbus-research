import { useQuery } from '@tanstack/react-query';
import { verifyFullModelValidation } from './contract.ts';
import { siteUrl } from '../site/env.ts';

export async function readFullModelValidation(signal: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('full-model-validation.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`FULL_MODEL_VALIDATION_HTTP_${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('FULL_MODEL_VALIDATION_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > 32768) { await reader.cancel(); throw new Error('FULL_MODEL_VALIDATION_RESPONSE_LIMIT'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('FULL_MODEL_VALIDATION_INVALID_JSON'); }
    return verifyFullModelValidation(value);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useFullModelValidation() {
  return useQuery({ queryKey: ['full-model-validation/1', 'saved-public-result'], queryFn: ({ signal }) => readFullModelValidation(signal), retry: false, refetchInterval: 30000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
