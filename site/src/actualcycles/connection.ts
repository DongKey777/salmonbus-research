import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { verifyExtension, verifyInvalidation, verifySnapshot } from './contract.ts';
import type { Snapshot } from './types.ts';
import { PUBLIC_SITE, SNAPSHOT, siteUrl } from '../site/env.ts';

const KEY = 'real-cycle-monitor-v1';
export async function readSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const aborter = new AbortController(), abort = () => aborter.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 7000);
  try {
    const response = await fetch(PUBLIC_SITE ? siteUrl(SNAPSHOT.realCycles) : siteUrl('api/v7/real-cycles/snapshot'), {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: aborter.signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`ACTUAL_CYCLES_HTTP_${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('ACTUAL_CYCLES_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('ACTUAL_CYCLES_RESPONSE_LIMIT'); }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { throw new Error('ACTUAL_CYCLES_INVALID_JSON'); }
    return verifySnapshot(value);
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
export function useActualCycles() {
  const prior = useRef<Snapshot | null>(null), client = useQueryClient();
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'polling' | 'static'>(PUBLIC_SITE ? 'static' : 'connecting');
  const [resyncs, setResyncs] = useState(0);
  const query = useQuery({
    queryKey: [KEY],
    queryFn: async ({ signal }) => {
      const next = await readSnapshot(signal);
      if (prior.current && verifyExtension(prior.current, next) === 'RESYNC') setResyncs(count => count + 1);
      prior.current = next;
      return next;
    },
    retry: false, refetchInterval: PUBLIC_SITE ? false : 2000, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const generation = query.data?.generationId;
  useEffect(() => {
    if (!generation || PUBLIC_SITE) return;
    const source = new EventSource(siteUrl('api/v7/real-cycles/events?') + new URLSearchParams({
      after: String(prior.current?.cursor ?? 0), generationId: generation,
    }));
    const refresh = () => void client.invalidateQueries({ queryKey: [KEY] });
    const receive = (message: Event) => {
      try {
        const event = verifyInvalidation(JSON.parse((message as MessageEvent<string>).data));
        setStreamState('connected');
        if (event.serverSeq > (prior.current?.cursor ?? 0)) refresh();
      } catch { setStreamState('polling'); refresh(); }
    };
    source.onopen = () => setStreamState('connected');
    source.addEventListener('real-cycle.event.v1', receive);
    source.onerror = () => { setStreamState('polling'); refresh(); };
    return () => { source.removeEventListener('real-cycle.event.v1', receive); source.close(); };
  }, [generation, client]);
  return { ...query, streamState, resyncs };
}
