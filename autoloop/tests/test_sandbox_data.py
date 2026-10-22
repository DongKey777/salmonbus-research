"""Extract and H-exclusion tests for the sandbox data mounted at /data. The H identifiers are recomputed on the host from the
pinned mirror (FULL_TRAIN_PREPARATION_014 split codes), independently of the build script, and compared with the manifest proof.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider tests/test_sandbox_data.py
"""
import hashlib
import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

AL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AL / 'sandbox'))
import runner  # noqa: E402

DATA = AL / 'sandbox-data'
MIRROR = AL.parents[1] / 'volume-mirror-20261021' / 'R' / 'salmonbus-full-v1'
M = json.loads((DATA / 'MANIFEST.json').read_bytes())


def runner_pin(k):
    return M['sourcePins'][k]['path']


def h_identifiers():
    for k in ('dataset', 'devSplit'):
        assert hashlib.sha256((MIRROR / runner_pin(k)).read_bytes()).hexdigest() == M['sourcePins'][k]['sha256']
    m14 = json.loads((MIRROR / 'outputs/FULL_TRAIN_PREPARATION_014/dataset/dataset.json').read_bytes())
    d14 = MIRROR / 'outputs/FULL_TRAIN_PREPARATION_014/dataset'
    d7 = MIRROR / 'outputs/FULL_TRAIN_PREPARATION_007/dataset'
    sids, gids = [], []
    m7 = json.loads((d7 / 'dataset.json').read_bytes())
    for sh, sh7 in zip(m14['splits']['DEV']['shards'], m7['splits']['DEV']['shards']):
        raw14, raw7 = (d14 / sh['path']).read_bytes(), (d7 / sh7['path']).read_bytes()
        assert sh['path'] == sh7['path'] and hashlib.sha256(raw14).hexdigest() == sh['sha256'] and hashlib.sha256(raw7).hexdigest() == sh7['sha256']
        t = pq.read_table(pa.BufferReader(raw14), columns=['sample_id', 'split'])
        g = pq.read_table(pa.BufferReader(raw7), columns=['sample_id', 'arrival_group_id'])
        assert np.array_equal(t['sample_id'].to_numpy(), g['sample_id'].to_numpy())
        h = t['split'].to_numpy() == 2
        sids.append(t['sample_id'].to_numpy()[h].astype(np.uint64))
        gids.append(g['arrival_group_id'].to_numpy()[h].astype(np.uint64))
    return np.sort(np.concatenate(sids)), np.unique(np.concatenate(gids))


class Extract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h_sid, cls.h_gid = h_identifiers()

    def test_dev_s_complete(self):
        s = M['splits']['dev_s']
        self.assertEqual((s['rows'], s['groups']), (10701742, 170833))
        self.assertEqual(sum(f['rows'] for f in s['files']), 10701742)
        self.assertEqual(s['serviceDays'], [20261012, 20261014, 20261016, 20261017])

    def test_manifest_proof_matches_independent_recomputation(self):
        p = M['hExclusion']
        self.assertTrue(p['computedOutsideSandbox'])
        self.assertEqual(p['hSampleIdCount'], len(self.h_sid))
        self.assertEqual(p['hSampleIdSortedSha256'], hashlib.sha256(self.h_sid.astype('<u8').tobytes()).hexdigest())
        self.assertEqual(p['hGroupCount'], len(self.h_gid))
        self.assertEqual(p['hGroupSortedSha256'], hashlib.sha256(self.h_gid.astype('<u8').tobytes()).hexdigest())
        for k in ('devSSampleIdsInH', 'devSGroupsInH', 'trainSampleGroupsInH', 'trainGroupsInDev'):
            self.assertEqual(p[k], 0, k)
        self.assertTrue(p['devPartition'])

    def test_no_file_under_data_holds_an_h_identifier(self):
        seen = set()
        for root, _, files in os.walk(DATA):
            for f in files:
                p = Path(root) / f
                rel = str(p.relative_to(DATA))
                seen.add(rel)
                if rel == 'MANIFEST.json':
                    continue
                self.assertTrue(rel.endswith('.parquet'), rel)
                names = pq.read_schema(p).names
                self.assertNotIn('split', names)
                t = pq.read_table(p, columns=[c for c in ('sample_id', 'arrival_group_id') if c in names])
                if 'sample_id' in names:
                    self.assertTrue(rel.startswith('dev_s/'), rel)
                    self.assertEqual(int(np.isin(t['sample_id'].to_numpy().astype(np.uint64), self.h_sid).sum()), 0, rel)
                self.assertEqual(int(np.isin(t['arrival_group_id'].to_numpy().astype(np.uint64), self.h_gid).sum()), 0, rel)
        self.assertEqual(seen, {f['path'] for s in M['splits'].values() for f in s['files']} | {'MANIFEST.json'})

    def test_container_sees_exactly_the_verified_files(self):
        runner.verify_data(full=True)
        res = runner.run_script('''import hashlib, os, lab_api as L
out = {}
for root, _, files in os.walk('/data'):
    for f in files:
        p = os.path.join(root, f)
        h = hashlib.sha256()
        with open(p, 'rb') as fh:
            for b in iter(lambda: fh.read(1 << 22), b''):
                h.update(b)
        out[os.path.relpath(p, '/data')] = h.hexdigest()
digest = hashlib.sha256(''.join(k + v for k, v in sorted(out.items())).encode()).hexdigest()
L.emit({'files': len(out), 'digest': digest})
''', timeout=300)
        self.assertEqual(res['status'], 'OK', res)
        want = {f['path']: f['sha256'] for s in M['splits'].values() for f in s['files']}
        want['MANIFEST.json'] = runner.file_sha(DATA / 'MANIFEST.json')
        self.assertEqual(res['result']['files'], len(want))
        self.assertEqual(res['result']['digest'], hashlib.sha256(''.join(k + v for k, v in sorted(want.items())).encode()).hexdigest())

    def test_runner_refuses_a_data_dir_with_unexpected_files(self):
        extra = DATA / 'dev_s' / 'zz-unexpected.parquet'
        try:
            extra.write_bytes(b'x')
            with self.assertRaises(runner.InfraError):
                runner.verify_data()
            self.assertEqual(runner.run_script("import lab_api as L\nL.emit({'a': 1})\n", timeout=30)['status'], 'INFRA_ERROR')
        finally:
            extra.unlink()
        runner.verify_data()


if __name__ == '__main__':
    unittest.main()
