import { useQuery } from '@tanstack/react-query';
import { verifyRouteReport } from './contract.ts';
import { ROUTE_LIMITS, ROUTE_REPORT_SCHEMA } from './types.ts';
import { siteUrl } from '../site/env.ts';

export async function readRouteReport(signal: AbortSignal, now: number = Date.now()) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(siteUrl('route-report.json'), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`ROUTE_REPORT_HTTP_${response.status}`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('ROUTE_REPORT_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > ROUTE_LIMITS.responseBytes) { await reader.cancel(); throw new Error('ROUTE_REPORT_RESPONSE_LIMIT'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('ROUTE_REPORT_INVALID_JSON'); }
    return verifyRouteReport(value, now);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export function useRouteReport() {
  return useQuery({ queryKey: [ROUTE_REPORT_SCHEMA], queryFn: ({ signal }) => readRouteReport(signal), retry: false, refetchInterval: 10000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
}
