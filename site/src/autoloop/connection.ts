import { useQuery } from '@tanstack/react-query';
import { verifyAutoloopReport } from './contract.ts';
import { AUTOLOOP_LIMITS, AUTOLOOP_SCHEMA } from './types.ts';
import { PUBLIC_SITE, siteUrl } from '../site/env.ts';

export async function readAutoloopReport(signal: AbortSignal, now: number = Date.now()) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('autoloop-report.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`AUTOLOOP_HTTP_${response.status}`); }
    const raw = await response.text();
    if (raw.length > AUTOLOOP_LIMITS.responseBytes) throw new Error('AUTOLOOP_RESPONSE_LIMIT');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('AUTOLOOP_INVALID_JSON'); }
    return verifyAutoloopReport(value, now);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useAutoloopReport() {
  return useQuery({ queryKey: [AUTOLOOP_SCHEMA], queryFn: ({ signal }) => readAutoloopReport(signal), retry: false, refetchInterval: PUBLIC_SITE ? 60000 : 10000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
