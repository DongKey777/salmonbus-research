import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRealSupport } from '../src/real/support-contract.ts';
import { readRealSupport } from '../src/real/support-connection.ts';
import type { SupportAnchor } from '../src/real/types.ts';

/** ARTIFICIAL TEST PINS ONLY; never exported to public/ or served as real results. */
const anchor: SupportAnchor = {
  publicSummarySha256: '1'.repeat(64), modelReceiptSha256: '2'.repeat(64), inputHash: '3'.repeat(64), evalRows: 8,
};
const artificialSupport = () => ({
  schema: 'real-pilot-support/1', origin: 'LOCAL_CAPTURED_REAL_OBSERVATIONS', ...anchor,
  fullEvents: 0, nonFullEvents: 8, policy: 'SEAT_ZERO_IS_FULL',
  truthBytesSha256: '4'.repeat(64), rawRowsPublished: false,
});

test('real support: exact public bytes, receipt, input, and eval count must all bind to the displayed summary', () => {
  const original = artificialSupport();
  const support = verifyRealSupport(original, anchor);
  assert.equal(support.fullEvents, 0);
  assert.equal(support.nonFullEvents, 8);
  for (const key of ['publicSummarySha256', 'modelReceiptSha256', 'inputHash'] as const) {
    assert.throws(() => verifyRealSupport({ ...original, [key]: 'a'.repeat(64) }, anchor), new RegExp(`pin.${key}`));
  }
  assert.throws(() => verifyRealSupport({ ...original, evalRows: 7 }, anchor), /pin.evalRows/);
  assert.deepEqual(original, artificialSupport());
});

test('real support: invalid partitions, fabricated rows, and changed fullness policy are rejected', () => {
  for (const patch of [
    { fullEvents: 1, nonFullEvents: 8 }, { fullEvents: -1, nonFullEvents: 9 },
    { fullEvents: .5, nonFullEvents: 7.5 }, { rawRowsPublished: true },
    { policy: 'SEAT_ONE_IS_FULL' }, { truthBytesSha256: 'missing' }, { rawRows: [] },
  ]) assert.throws(() => verifyRealSupport({ ...artificialSupport(), ...patch }, anchor));
});

test('real support reader: absence never invents zero counts, and a pin mismatch remains a separate error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/real-pilot/support.json');
      assert.equal(init?.method, 'GET');
      return new Response(null, { status: 404 });
    };
    assert.deepEqual(await readRealSupport(anchor, new AbortController().signal), { state: 'unavailable' });
    globalThis.fetch = async () => new Response(JSON.stringify({ ...artificialSupport(), inputHash: 'a'.repeat(64) }));
    await assert.rejects(readRealSupport(anchor, new AbortController().signal), /pin.inputHash/);
    globalThis.fetch = async () => new Response(JSON.stringify(artificialSupport()));
    const result = await readRealSupport(anchor, new AbortController().signal);
    assert.equal(result.state, 'verified');
  } finally { globalThis.fetch = originalFetch; }
});
