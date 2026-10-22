import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyModelRegistry } from '../src/model-registry/contract.ts';

const published = () => JSON.parse(readFileSync(new URL('../public/model-registry.json', import.meta.url), 'utf8'));

test('given the published registry when verified then ten real versions with one best per run and valid lineage', () => {
  const r = verifyModelRegistry(published());
  assert.equal(r.models.length, 10);
  assert.deepEqual(r.models.filter(m => m.bestObservedDevModel).map(m => m.id), ['SEAT.B256', 'SEAT.D6', 'SEAT.V2_D8']);
  assert.ok(r.models.every(m => m.modelAdoption === false && m.generalizationClaim === false));
  assert.deepEqual(r.lineage.map(e => e.to), ['SEAT.A128', 'SEAT.B256']);
});

test('given tampered registries when verified then each is rejected with a specific code', () => {
  const cases: [string, (d: any) => void, RegExp][] = [
    ['synthetic status', d => { d.models[0].status = 'SAVED_SYNTHETIC_EXECUTION'; }, /MODEL_STATUS_0/],
    ['adoption claim', d => { d.models[4].modelAdoption = true; }, /MODEL_CLAIMS_4/],
    ['unknown parent', d => { d.models[1].parentModelId = 'SEAT.missing'; }, /PARENT_SEAT.A128/],
    ['two best models in one run', d => { d.models[3].bestObservedDevModel = true; }, /BEST_COUNT_PER_RUN/],
    ['wrong origin', d => { d.origin = 'ARTIFICIAL_TRANSPORT_FIXTURE'; }, /SCHEMA_ORIGIN/],
    ['extra key', d => { d.models[2].extra = 1; }, /MODEL_2_KEYS/],
    ['edge to unknown node', d => { d.lineage[0].to = 'SEAT.nope'; }, /EDGE_NODE_0/],
    ['id outside the allowed characters', d => { d.models[6].id = 'SEAT.V2-D6'; }, /MODEL_ID_6/],
  ];
  for (const [name, mutate, code] of cases) {
    const d = published(); mutate(d);
    assert.throws(() => verifyModelRegistry(d), code, name);
  }
});
