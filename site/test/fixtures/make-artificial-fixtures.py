#!/usr/bin/env python3
"""ARTIFICIAL UI transport fixtures. Not actual execution results."""
import copy, hashlib, json, math, os, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent.parent
EVIDENCE = WEB / 'evidence' / 'full-depth-sweep-ui' / 'fixtures'
PRIOR = {'runId': 'SEAT_DEPTH_SWEEP_001', 'outcome': 'STOPPED_BEFORE_TRAINING', 'freshFits': 0, 'accepted': False, 'publicScorePublished': False}

def write(path, value):
    raw = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode() + b'\n'
    with open(path, 'xb') as f:
        f.write(raw)
    print(path.name, len(raw))

def wrap(public):
    return {'fixtureOrigin': 'ARTIFICIAL_TRANSPORT_FIXTURE', 'actualExecution': False, 'public': public}

def depth_v2(name, producer_status, receipt):
    old = json.loads((EVIDENCE / f'ARTIFICIAL-{name}.json').read_text())['public']
    v = copy.deepcopy(old)
    v['schema'] = 'full-depth-sweep/2'
    v['runId'] = 'SEAT_DEPTH_SWEEP_002'
    v['producerStatus'] = producer_status
    v['priorAttempt'] = PRIOR
    v['receiptSha256'] = receipt[0]
    v['completeSha256'] = receipt[1]
    return v

def fake_sha(label):
    return hashlib.sha256(('ARTIFICIAL:' + label).encode()).hexdigest()

def main():
    out = HERE / 'full-depth-sweep'
    none = (None, None)
    write(out / 'ARTIFICIAL-training.json', wrap(depth_v2('training', None, none)))
    write(out / 'ARTIFICIAL-next-candidate.json', wrap(depth_v2('next-candidate', None, none)))
    write(out / 'ARTIFICIAL-evaluating.json', wrap(depth_v2('evaluating', None, none)))
    write(out / 'ARTIFICIAL-complete.json', wrap(depth_v2('complete', 'FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED', (fake_sha('receipt'), fake_sha('complete')))))
    failed = depth_v2('training', 'FAILED_PRESERVED_NOT_ACCEPTED', none)
    failed.update(phase='FAILED', terminal=False, candidate=None, currentModelRoundsCompleted=None, statusDetail='깊이 비교 작업이 중단됐습니다. 저장 결과와 중단 기록을 보존합니다.')
    failed['models'][1]['status'] = 'PROGRESS_OBSERVED'
    write(out / 'ARTIFICIAL-failed.json', wrap(failed))

    # route report: population facts once, per-model metrics separately; all numbers invented.
    dev_rows, dev_groups = 20989927, 351831
    spec = [  # (rows share, groups share, train support groups or None)
        (0.31, 0.30, 410000), (0.22, 0.21, 150000), (0.17, 0.18, 40000), (0.12, 0.13, 20000),
        (0.08, 0.07, 9000), (0.05, 0.06, None), (0.03, 0.03, 1200),
    ]
    routes = []
    rows_left, groups_left = dev_rows, dev_groups
    for i, (rs, gs, sup) in enumerate(spec):
        rows = int(dev_rows * rs); groups = int(dev_groups * gs)
        rows_left -= rows; groups_left -= groups
        token = hashlib.sha256(f'ARTIFICIAL-route-{i}'.encode()).hexdigest()[:16]
        routes.append({'token': token, 'devRows': rows, 'devGroups': groups, 'weightSum': float(groups),
                       'trainSupport': None if sup is None else {'rows': sup * 61, 'groups': sup}})
    unknown = {'devRows': rows_left, 'devGroups': groups_left, 'weightSum': float(groups_left)}
    assert rows_left > 0 and groups_left > 0
    ref_mae = [1.9, 2.4, 2.1, 3.2, 2.8, 4.1, 5.3]; ref_mse = [8.1, 13.0, 9.9, 24.0, 18.5, 40.2, 61.0]
    cand_mae = [1.85, 2.3, 2.15, 3.0, 2.9, 4.4, 4.9]; cand_mse = [7.7, 12.1, 10.3, 21.5, 19.4, 44.0, 52.0]
    unk = {'ref': (3.4, 27.0), 'cand': (3.3, 25.5)}
    def model(id_, role, mode, mae, mse, unk_pair, ref=None, published=None):
        total_w = math.fsum(r['weightSum'] for r in routes) + unknown['weightSum']
        micro_mae = math.fsum([m * r['weightSum'] for m, r in zip(mae, routes)] + [unk_pair[0] * unknown['weightSum']]) / total_w
        micro_mse = math.fsum([m * r['weightSum'] for m, r in zip(mse, routes)] + [unk_pair[1] * unknown['weightSum']]) / total_w
        entry = {'id': id_, 'role': role, 'trainingMode': mode, 'depth': 6, 'rounds': 256, 'publishedGlobal': published,
                 'micro': {'MAE': micro_mae, 'MSE': micro_mse, 'pairedMAEDelta': None, 'pairedMSEDelta': None},
                 'knownRouteMacro': {'MAE': math.fsum(mae) / len(mae), 'MSE': math.fsum(mse) / len(mse), 'routeCount': len(routes)},
                 'unknown': {'MAE': unk_pair[0], 'MSE': unk_pair[1], 'pairedMAEDelta': None, 'pairedMSEDelta': None},
                 'routes': [{'token': r['token'], 'MAE': a, 'MSE': s, 'pairedMAEDelta': None, 'pairedMSEDelta': None} for r, a, s in zip(routes, mae, mse)]}
        if ref is not None:
            for mine, theirs in zip(entry['routes'], ref['routes']):
                mine['pairedMAEDelta'] = mine['MAE'] - theirs['MAE']; mine['pairedMSEDelta'] = mine['MSE'] - theirs['MSE']
            entry['unknown']['pairedMAEDelta'] = unk_pair[0] - ref['unknown']['MAE']; entry['unknown']['pairedMSEDelta'] = unk_pair[1] - ref['unknown']['MSE']
            entry['micro']['pairedMAEDelta'] = micro_mae - ref['micro']['MAE']; entry['micro']['pairedMSEDelta'] = micro_mse - ref['micro']['MSE']
        if published is not None:
            entry['publishedGlobal'] = {'source': published, 'MAE': micro_mae, 'MSE': micro_mse}
        return entry
    reference = model('BASELINE', 'REFERENCE', 'CONTINUED_REFERENCE', ref_mae, ref_mse, unk['ref'], published='fixtures/ARTIFICIAL-not-a-published-global.json')
    candidate = model('D6', 'CANDIDATE', 'FRESH_FROM_ZERO', cand_mae, cand_mse, unk['cand'], ref=reference)
    report = {
        'schema': 'route-report/1', 'origin': 'REAL_OBSERVATION_PIPELINE', 'runId': 'SEAT_DEPTH_SWEEP_002', 'evaluationRole': 'DEV',
        'producerStatus': 'ROUTE_REPORT_DEV_REUSED_NOT_ADOPTED', 'receiptSha256': fake_sha('route-report-receipt'),
        'dataset': {'manifestSha256': 'a2e42ab6ab45c1f33c8963b13456fe957a500f1752c9d027f4125a0cb0cc7a62', 'trainRows': 38651044, 'devRows': dev_rows, 'trainGroups': 631972, 'devGroups': dev_groups},
        'routeMap': {'sha256': fake_sha('route-map'), 'routeDefinition': 'R.route_id', 'tokenKind': 'OPAQUE_ROUTE_TOKEN', 'knownRouteCount': len(routes), 'unknownGroupCount': unknown['devGroups']},
        'routes': routes, 'unknown': unknown, 'models': [reference, candidate],
        'DEVReused': True, 'HRead': False, 'modelAdoption': False, 'generalizationClaim': False, 'replacesGlobalGate': False,
        'servedAt': '2027-01-15T08:00:00+00:00', 'sourceReportedAt': '2027-01-15T07:59:00+00:00',
    }
    write(HERE / 'route-report' / 'route-report.ARTIFICIAL.json', wrap(report))

if __name__ == '__main__':
    main()
