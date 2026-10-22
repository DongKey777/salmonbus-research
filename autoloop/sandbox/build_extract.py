#!/usr/bin/env python3
"""Builds the read-only analysis extract mounted at /data in the analysis sandbox.

Runs on the host, never inside the sandbox. Every source manifest is checked against the pinned digests in pkg/common.py and every
shard against its manifest digest before it is decoded. DEV keeps only split code 1 (DEV_S); sealed H rows (split code 2) are dropped
right after decoding and only their sample and group identifiers are kept in memory, to compute the exclusion proof. TRAIN is reduced
to a deterministic group sample. The proof is recomputed from the written files, not from the in-memory arrays.

Usage: python3 -B sandbox/build_extract.py [--mirror DIR] [--train-mod 8] [--replace]
"""
import argparse, hashlib, json, os, shutil, sys, time, types
from pathlib import Path

AL = Path(__file__).resolve().parents[1]
OUT = AL / 'sandbox-data'
DEFAULT_MIRROR = AL.parents[1] / 'volume-mirror-20261021' / 'R' / 'salmonbus-full-v1'
CHAMPION_REL = 'outputs/SEAT_FEATURES_V2_002/worker/V2_D8.dev-pred.npy'
CHAMPION_SHA = '60db73fd847089de7dc0863464a0753684290b26e0c069a2217f019795cd6c74'
CHAMPION_ID = 'SEAT.V2_D8'
SAMPLE_SALT = 20261022
EVAL_COLUMNS = ['prod_expected_seats', 'prod_full_chance']
SCHEMA = 'AUTOLOOP_SANDBOX_DATA/1'


def load_common():
    src = AL / 'pkg' / 'common.py'
    mod = types.ModuleType('autoloop_common')
    mod.__file__ = str(src)
    exec(compile(src.read_bytes(), str(src), 'exec'), mod.__dict__)
    return mod


C = load_common()


def need(ok, code):
    if not ok:
        raise SystemExit('BUILD_STOP:' + code)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def file_sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


def splitmix64(x, np):
    x = x.astype(np.uint64) + np.uint64(SAMPLE_SALT) + np.uint64(0x9E3779B97F4A7C15)
    x = (x ^ (x >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    x = (x ^ (x >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    return x ^ (x >> np.uint64(31))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mirror', default=str(DEFAULT_MIRROR))
    ap.add_argument('--train-mod', type=int, default=8)
    ap.add_argument('--replace', action='store_true')
    a = ap.parse_args()
    import numpy as np, pyarrow as pa, pyarrow.parquet as pq

    base = Path(a.mirror).resolve()
    need(a.train_mod >= 2, 'TRAIN_MOD')
    if OUT.exists():
        need(a.replace, 'OUTPUT_EXISTS_USE_REPLACE')
        old = OUT / 'MANIFEST.json'
        need(not old.exists() or json.loads(old.read_bytes()).get('schema') == SCHEMA, 'OUTPUT_NOT_OURS')
        shutil.rmtree(OUT)
    building = OUT / '.building'
    (building / 'dev_s').mkdir(parents=True)
    (building / 'train_sample').mkdir(parents=True)
    t0 = time.time()

    m, dirs = {}, {}
    for k in ('dataset', 'features', 'stopDemand', 'devSplit'):
        p = base / C.PIN_PATH[k]
        raw = p.read_bytes()
        need(sha(raw) == C.PIN_SHA[k], 'MANIFEST_PIN:' + k)
        m[k] = json.loads(raw)
        dirs[k] = p.parent
    need(m['features']['derivedFrom']['manifestSha256'] == C.PIN_SHA['dataset'], 'DERIVED_FROM')
    need(m['stopDemand']['derivedFrom'] == m['features']['derivedFrom'] == m['devSplit']['derivedFrom'], 'DERIVED_FROM_SAME')
    need(m['features']['mappingProof']['seatMismatch'] == 0 and m['stopDemand']['mappingProof']['seatMismatch'] == 0, 'MAPPING_PROOF')
    need(m['devSplit']['splitTotals']['DEV_S'] == {'rows': C.DEV_S_ROWS, 'groups': C.DEV_S_GROUPS}, 'DEV_S_DECLARED')
    base6 = m['dataset']['featureNames']
    side = m['features']['featureNames'][6:]
    stop = m['stopDemand']['featureNames']
    feats = m['features']['featureNames'] + stop
    need(len(feats) == 32 and m['features']['featureNames'][:6] == base6, 'FEATURE_LAYOUT')

    craw = (base / CHAMPION_REL).read_bytes()
    need(sha(craw) == CHAMPION_SHA, 'CHAMPION_PIN')
    import io
    champ = np.load(io.BytesIO(craw), allow_pickle=False)
    del craw
    need(champ.shape == (C.DEV_ROWS,) and bool(np.isfinite(champ).all()), 'CHAMPION_SHAPE')
    champ = champ.astype('<f4')

    def read_pinned(key, shard):
        raw = (dirs[key] / shard['path']).read_bytes()
        need(sha(raw) == shard['sha256'] and len(raw) == shard['bytes'], 'SHARD_PIN:' + key + ':' + shard['path'])
        return pq.read_table(pa.BufferReader(raw))

    def common_columns(ta, tb, tc, keep, id_name):
        cols = {
            id_name: pa.array(ta['sample_id'].to_numpy()[keep].astype(np.uint64)),
            'arrival_group_id': pa.array(ta['arrival_group_id'].to_numpy()[keep].astype(np.uint64)),
            'observed_seats': pa.array(ta['observed_seats'].to_numpy()[keep].astype(np.int32)),
            'weight': pa.array(1.0 / ta['weight_denominator'].to_numpy()[keep].astype('<f8')),
        }
        for f in base6:
            cols[f] = pa.array(ta[f].to_numpy(zero_copy_only=False)[keep])
        for f in side:
            cols[f] = pa.array(tb[f].to_numpy(zero_copy_only=False)[keep])
        for f in stop:
            cols[f] = pa.array(tc[f].to_numpy(zero_copy_only=False)[keep])
        return cols

    def write(cols, path):
        pq.write_table(pa.table(cols), path, compression='zstd', compression_level=6, row_group_size=1 << 22)
        os.chmod(path, 0o644)

    # DEV: keep split code 1, record only identifiers of split code 2.
    s7, s8, s9, s14 = (m[k]['splits']['DEV']['shards'] for k in ('dataset', 'features', 'stopDemand', 'devSplit'))
    need(len(s7) == len(s8) == len(s9) == len(s14), 'DEV_SHARD_COUNT')
    h_sid, h_gid, ordered = [], [], []
    offset = 0
    dev_files = []
    for i, (a7, a8, a9, a14) in enumerate(zip(s7, s8, s9, s14)):
        need(a7['path'] == a8['path'] == a9['path'] == a14['path'] and a7['rows'] == a8['rows'] == a9['rows'] == a14['rows'], 'DEV_SHARD_ALIGN')
        ta, tb, tc, td = (read_pinned(k, s) for k, s in (('dataset', a7), ('features', a8), ('stopDemand', a9), ('devSplit', a14)))
        sid = ta['sample_id'].to_numpy()
        n = len(sid)
        need(n == a7['rows'], 'DEV_ROWS:' + a7['path'])
        for t in (tb, tc, td):
            need(np.array_equal(sid, t['sample_id'].to_numpy()), 'DEV_SAMPLE_JOIN')
        need(np.array_equal(sid, np.arange(offset + 1, offset + n + 1, dtype=sid.dtype)), 'DEV_ORDINAL_POSITION')
        need(bool((ta['weight_numerator'].to_numpy() == 1).all()), 'WEIGHT_NUMERATOR_ONE')
        split = td['split'].to_numpy()
        need(bool(np.isin(split, (1, 2)).all()), 'SPLIT_CODES')
        keep = split == C.DEV_SPLIT_CODE
        hmask = split == 2
        h_sid.append(sid[hmask].astype(np.uint64))
        h_gid.append(ta['arrival_group_id'].to_numpy()[hmask].astype(np.uint64))
        ordered.append(sha(sid[keep].astype('<u8').tobytes()))
        if keep.any():
            cols = common_columns(ta, tb, tc, keep, 'sample_id')
            need(bool((cols['observed_seats'].to_numpy() >= 0).all()), 'LABEL_DOMAIN')
            cols['service_day'] = pa.array(td['service_day'].to_numpy()[keep].astype(np.int32))
            cols['kst_hour'] = pa.array(td['kst_hour'].to_numpy()[keep].astype(np.uint8))
            for f in EVAL_COLUMNS:
                cols[f] = pa.array(tb[f].to_numpy(zero_copy_only=False)[keep].astype('<f4'))
            cols['champion_pred'] = pa.array(champ[offset:offset + n][keep])
            name = 'dev_s/part-%03d.parquet' % i
            write(cols, building / name)
            dev_files.append(name)
        offset += n
        del ta, tb, tc, td
        if i % 32 == 0:
            print('dev shard', i, 'elapsed %.0fs' % (time.time() - t0), flush=True)
    need(offset == C.DEV_ROWS, 'DEV_TOTAL_ROWS')
    del champ

    # TRAIN: deterministic group sample.
    s7, s8, s9 = (m[k]['splits']['TRAIN']['shards'] for k in ('dataset', 'features', 'stopDemand'))
    need(len(s7) == len(s8) == len(s9), 'TRAIN_SHARD_COUNT')
    train_files = []
    train_groups_all = []
    train_rows_all = 0
    for i, (a7, a8, a9) in enumerate(zip(s7, s8, s9)):
        need(a7['path'] == a8['path'] == a9['path'] and a7['rows'] == a8['rows'] == a9['rows'], 'TRAIN_SHARD_ALIGN')
        ta, tb, tc = (read_pinned(k, s) for k, s in (('dataset', a7), ('features', a8), ('stopDemand', a9)))
        sid = ta['sample_id'].to_numpy()
        need(len(sid) == a7['rows'], 'TRAIN_ROWS:' + a7['path'])
        for t in (tb, tc):
            need(np.array_equal(sid, t['sample_id'].to_numpy()), 'TRAIN_SAMPLE_JOIN')
        need(bool((ta['weight_numerator'].to_numpy() == 1).all()), 'WEIGHT_NUMERATOR_ONE')
        gid = ta['arrival_group_id'].to_numpy().astype(np.uint64)
        train_groups_all.append(np.unique(gid))
        train_rows_all += len(sid)
        keep = (splitmix64(gid, np) % np.uint64(a.train_mod)) == 0
        if keep.any():
            cols = common_columns(ta, tb, tc, keep, 'train_sample_id')
            name = 'train_sample/part-%03d.parquet' % i
            write(cols, building / name)
            train_files.append(name)
        del ta, tb, tc
        if i % 32 == 0:
            print('train shard', i, 'elapsed %.0fs' % (time.time() - t0), flush=True)
    need(train_rows_all == C.TRAIN_ROWS, 'TRAIN_TOTAL_ROWS')

    # Proof, recomputed from the bytes that were written.
    def reread(names, cols):
        parts = [pq.read_table(building / n, columns=cols) for n in names]
        return {c: np.concatenate([p[c].to_numpy() for p in parts]) for c in cols}

    h_sid = np.sort(np.concatenate(h_sid))
    h_gid_u = np.unique(np.concatenate(h_gid))
    del h_gid
    dev_back = reread(dev_files, ['sample_id', 'arrival_group_id', 'weight'])
    dev_sid = np.sort(dev_back['sample_id'].astype(np.uint64))
    dev_gid_u = np.unique(dev_back['arrival_group_id'].astype(np.uint64))
    tr_back = reread(train_files, ['train_sample_id', 'arrival_group_id', 'weight'])
    tr_gid_u = np.unique(tr_back['arrival_group_id'].astype(np.uint64))
    train_groups_all = np.unique(np.concatenate(train_groups_all))
    dev_rows = int(len(dev_sid))
    need(dev_rows == C.DEV_S_ROWS and len(dev_gid_u) == C.DEV_S_GROUPS, 'DEV_S_COMPLETE')
    need(len(h_sid) == m['devSplit']['splitTotals']['H']['rows'] and len(h_gid_u) == m['devSplit']['splitTotals']['H']['groups'], 'H_DECLARED')
    proof = {
        'computedOutsideSandbox': True,
        'method': 'Host-side build: H identifiers come from the pinned FULL_TRAIN_PREPARATION_014 split column (code 2); extract identifiers are re-read from the written parquet files.',
        'hSampleIdNamespace': 'DEV role ordinal (sample_id is ROLE_CONTIGUOUS_ORDINAL_V1)',
        'hSampleIdCount': int(len(h_sid)),
        'hSampleIdSortedSha256': sha(h_sid.astype('<u8').tobytes()),
        'hGroupCount': int(len(h_gid_u)),
        'hGroupSortedSha256': sha(h_gid_u.astype('<u8').tobytes()),
        'devSSampleIdsInH': int(np.isin(dev_sid, h_sid, assume_unique=True).sum()),
        'devSGroupsInH': int(np.isin(dev_gid_u, h_gid_u, assume_unique=True).sum()),
        'trainSampleGroupsInH': int(np.isin(tr_gid_u, h_gid_u, assume_unique=True).sum()),
        'trainGroupsInDev': int(np.isin(train_groups_all, np.union1d(dev_gid_u, h_gid_u), assume_unique=True).sum()),
        'devPartition': bool(len(np.union1d(dev_sid, h_sid)) == C.DEV_ROWS and int(np.union1d(dev_sid, h_sid)[-1]) == C.DEV_ROWS),
        'trainSampleIdNote': 'TRAIN rows carry their TRAIN-role ordinal as train_sample_id, a namespace separate from the DEV ordinals in sample_id; only dev_s files have a sample_id column. TRAIN rows are excluded from H by role and by arrival_group_id (global namespace), checked above.',
    }
    need(proof['devSSampleIdsInH'] == 0 and proof['devSGroupsInH'] == 0 and proof['trainSampleGroupsInH'] == 0 and proof['trainGroupsInDev'] == 0 and proof['devPartition'], 'H_EXCLUSION')

    for sub in ('dev_s', 'train_sample'):
        (building / sub).rename(OUT / sub)
    building.rmdir()

    def inventory(names):
        out = []
        for n in names:
            p = OUT / n
            out.append({'path': n, 'rows': pq.ParquetFile(p).metadata.num_rows, 'bytes': p.stat().st_size, 'sha256': file_sha(p)})
        return out

    def schema_of(name):
        return [{'name': f.name, 'type': str(f.type)} for f in pq.read_schema(OUT / name)]

    devf, trf = inventory(dev_files), inventory(train_files)
    days = sorted(int(x) for x in np.unique(pq.read_table(OUT / 'dev_s', columns=['service_day'])['service_day'].to_numpy()))
    manifest = {
        'schema': SCHEMA,
        'createdAtEpoch': int(time.time()),
        'builder': {'path': 'sandbox/build_extract.py', 'sha256': file_sha(Path(__file__))},
        'sourcePins': {k: {'path': C.PIN_PATH[k], 'sha256': C.PIN_SHA[k]} for k in C.PIN_PATH},
        'champion': {'modelId': CHAMPION_ID, 'path': CHAMPION_REL, 'sha256': CHAMPION_SHA, 'column': 'champion_pred', 'scope': 'DEV order, filtered to DEV_S'},
        'featureNames': feats,
        'label': 'observed_seats',
        'weight': 'weight = 1/weight_denominator; weights of one arrival group sum to 1',
        'routeColumn': 'x_route_code',
        'predictionColumns': {'champion_pred': CHAMPION_ID + ' DEV prediction', 'prod_expected_seats': 'product forecast (evaluation only)', 'prod_full_chance': 'product full-bus probability (evaluation only)'},
        'splits': {
            'dev_s': {'rows': dev_rows, 'groups': int(len(dev_gid_u)), 'weightSum': float(dev_back['weight'].sum()), 'serviceDays': days,
                      'orderedSampleDigest': C.digest(ordered), 'columns': schema_of(dev_files[0]), 'files': devf},
            'train_sample': {'rows': int(len(tr_back['train_sample_id'])), 'groups': int(len(tr_gid_u)), 'weightSum': float(tr_back['weight'].sum()),
                             'sampling': {'rule': 'keep arrival group g when splitmix64(g + %d) %% %d == 0' % (SAMPLE_SALT, a.train_mod), 'targetFraction': 1.0 / a.train_mod,
                                          'sourceRows': train_rows_all, 'sourceGroups': int(len(train_groups_all))},
                             'columns': schema_of(train_files[0]), 'files': trf},
        },
        'hExclusion': proof,
        'totalBytes': sum(f['bytes'] for f in devf + trf),
    }
    tmp = OUT / 'MANIFEST.json.next'
    tmp.write_bytes(json.dumps(manifest, indent=1, sort_keys=True).encode() + b'\n')
    os.chmod(tmp, 0o644)
    tmp.rename(OUT / 'MANIFEST.json')
    print(json.dumps({'devSRows': dev_rows, 'devSGroups': int(len(dev_gid_u)), 'trainSampleRows': manifest['splits']['train_sample']['rows'],
                      'totalBytes': manifest['totalBytes'], 'hExclusion': {k: v for k, v in proof.items() if isinstance(v, (int, bool))}, 'seconds': round(time.time() - t0)}))


if __name__ == '__main__':
    main()
