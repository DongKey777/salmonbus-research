import { useQuery } from '@tanstack/react-query';
import { verifyModelRegistry } from './contract.ts';
import { siteUrl } from '../site/env.ts';

export async function readModelRegistry(signal: AbortSignal) {
  const response = await fetch(siteUrl('model-registry.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`MODEL_REGISTRY_HTTP_${response.status}`); }
  const text = await response.text();
  if (text.length > 131072) throw new Error('MODEL_REGISTRY_RESPONSE_LIMIT');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('MODEL_REGISTRY_INVALID_JSON'); }
  return verifyModelRegistry(value);
}
export function useModelRegistry() {
  return useQuery({ queryKey: ['model-registry-public/1'], queryFn: ({ signal }) => readModelRegistry(signal), retry: false, refetchInterval: 60000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
