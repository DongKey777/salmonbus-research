export type HistorySourceMode = 'actual' | 'fixture';

/** An absent/invalid choice always opens actual research. Errors never select the fixture. */
export function historySourceFromSearch(search: string): HistorySourceMode {
  return new URLSearchParams(search).get('historySource') === 'fixture' ? 'fixture' : 'actual';
}
export function historySourceQueryKey(source: HistorySourceMode, ...parts: unknown[]) {
  return ['research-history', source, ...parts] as const;
}
export function historySourceSearch(search: string, source: HistorySourceMode): string {
  const params = new URLSearchParams(search);
  params.set('view', 'history');
  if (source === 'fixture') params.set('historySource', 'fixture');
  else params.delete('historySource');
  return `?${params}`;
}
