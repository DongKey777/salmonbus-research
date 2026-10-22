import test from 'node:test';
import assert from 'node:assert/strict';
import { historySourceFromSearch, historySourceQueryKey, historySourceSearch } from '../src/history/source.ts';

test('history source: actual research is the default and invalid choices never imply fixture fallback', () => {
  assert.equal(historySourceFromSearch('?view=history'), 'actual');
  assert.equal(historySourceFromSearch('?view=history&historySource=unknown'), 'actual');
  assert.equal(historySourceFromSearch('?view=history&historySource=fixture'), 'fixture');
});
test('history source: matching trial IDs, cursors and epochs cannot share actual/fixture query caches', () => {
  const anchor = { historyGenerationId: 'same-generation-text', snapshotCursor: 5 };
  assert.notDeepEqual(historySourceQueryKey('actual', 'catalog', 0, anchor), historySourceQueryKey('fixture', 'catalog', 0, anchor));
  assert.notDeepEqual(historySourceQueryKey('actual', 'model', 'same-id', anchor), historySourceQueryKey('fixture', 'model', 'same-id', anchor));
});
test('history source: fixture mode requires an explicit URL choice and returning to actual clears it', () => {
  const fixture = historySourceSearch('?view=history', 'fixture');
  assert.equal(historySourceFromSearch(fixture), 'fixture');
  const actual = historySourceSearch(fixture, 'actual');
  assert.equal(new URLSearchParams(actual).has('historySource'), false);
  assert.equal(historySourceFromSearch(actual), 'actual');
});
