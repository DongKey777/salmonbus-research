import type { RealPilotSupport, SupportAnchor } from './types.ts';

function fail(path: string): never { throw new Error(`REAL_PILOT_SUPPORT:${path}`); }
export function verifyRealSupport(value: unknown, anchor: SupportAnchor): RealPilotSupport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object');
  const support = value as Record<string, unknown>;
  const keys = [
    'schema', 'origin', 'publicSummarySha256', 'modelReceiptSha256', 'inputHash', 'evalRows',
    'fullEvents', 'nonFullEvents', 'policy', 'truthBytesSha256', 'rawRowsPublished',
  ];
  if (Object.keys(support).length !== keys.length || keys.some(key => !Object.hasOwn(support, key))) fail('keys');
  if (support.schema !== 'real-pilot-support/1' || support.origin !== 'LOCAL_CAPTURED_REAL_OBSERVATIONS' ||
    support.policy !== 'SEAT_ZERO_IS_FULL' || support.rawRowsPublished !== false) fail('provenance');
  for (const key of ['publicSummarySha256', 'modelReceiptSha256', 'inputHash', 'truthBytesSha256']) {
    if (typeof support[key] !== 'string' || !/^[0-9a-f]{64}$/.test(support[key] as string)) fail(key);
  }
  for (const key of ['publicSummarySha256', 'modelReceiptSha256', 'inputHash', 'evalRows'] as const) {
    if (support[key] !== anchor[key]) fail(`pin.${key}`);
  }
  if (support.evalRows !== 8) fail('evalRows');
  for (const key of ['fullEvents', 'nonFullEvents']) {
    const count = support[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 8) fail(key);
  }
  if ((support.fullEvents as number) + (support.nonFullEvents as number) !== support.evalRows) fail('countPartition');
  return support as unknown as RealPilotSupport;
}
