import { useQuery } from '@tanstack/react-query';
import { readPilotJsonFile } from './connection.ts';
import { verifyRealSupport } from './support-contract.ts';
import type { SupportAnchor, SupportRead } from './types.ts';

export async function readRealSupport(anchor: SupportAnchor, signal: AbortSignal): Promise<SupportRead> {
  const result = await readPilotJsonFile('support.json', signal);
  return result === null ? { state: 'unavailable' } : { state: 'verified', support: verifyRealSupport(result.payload, anchor) };
}
export function useRealSupport(anchor: SupportAnchor) {
  return useQuery({
    queryKey: ['real-pilot-support/1', anchor],
    queryFn: ({ signal }) => readRealSupport(anchor, signal),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    refetchInterval: query => query.state.data?.state === 'unavailable' ? 10000 : false,
    refetchIntervalInBackground: false,
  });
}
