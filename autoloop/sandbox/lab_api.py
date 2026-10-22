"""Safe aggregate helpers for analysis scripts run in the sandbox (import lab_api).

/data (read-only) holds two splits: 'dev_s' (the DEV selection split, 10,701,742 rows) and 'train_sample' (a deterministic 1/8
arrival-group sample of TRAIN). Sealed H rows are not present. Rows are weighted by `weight` (each arrival group sums to 1).
Every table helper reports n_rows and n_groups (distinct arrival groups) per cell and drops cells with fewer than MIN_GROUPS
groups. A script's only output is one emit(obj) call, which writes /out/result.json after the same policy checks the host applies.

Key specs for groupby_metrics / residual_quantiles: a column name used as categories (at most MAX_CELLS distinct values), or
'<numeric column>@q<K>' for K weighted-quantile bins (2..20). Derived names: route_code, horizon_bucket, seats_band; residual and
abs_error need pred_col. pred_col / compare_col may be a column name or a float array aligned with the split's rows.
"""
import json
import os
import re
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

import output_policy as P

DATA = Path(os.environ.get('LAB_DATA', '/data'))
OUT = Path(os.environ.get('LAB_OUT', '/out'))
MIN_GROUPS = P.MIN_GROUPS
MAX_CELLS = 400
MAX_KEYS = 3
MAX_CORR_COLUMNS = 40
HORIZON_EDGES = [1, 2, 4, 8, 16, 32]
LABEL, WEIGHT, GROUP = 'observed_seats', 'weight', 'arrival_group_id'
DERIVED = {
    'route_code': 'x_route_code as an integer',
    'horizon_bucket': 'index of f_horizon_stops in edges [1,2,4,8,16,32] (searchsorted right, NaN as 0)',
    'seats_band': 'f_remaining_seats band: 0=NaN 1=0 2=1..5 3=6..20 4=>20',
    'residual': 'pred_col - observed_seats',
    'abs_error': '|pred_col - observed_seats|',
}
_KEY = re.compile(r'^([a-z][a-z0-9_]{0,63})(?:@q([0-9]{1,2}))?$')
_manifest = None
_cache = {}
_emitted = False


def manifest():
    global _manifest
    if _manifest is None:
        _manifest = json.loads((DATA / 'MANIFEST.json').read_bytes())
    return _manifest


def _split(split):
    s = manifest()['splits']
    if split not in s:
        raise ValueError('unknown split %r; use one of %s' % (split, sorted(s)))
    return s[split]


def columns(split='dev_s'):
    """Stored column names of a split (derived names are listed in DERIVED)."""
    return [c['name'] for c in _split(split)['columns']]


def describe():
    """Schema and counts only, no rows."""
    m = manifest()
    return {'splits': {k: {'rows': v['rows'], 'groups': v['groups'], 'columns': v['columns']} for k, v in m['splits'].items()},
            'featureNames': m['featureNames'], 'label': LABEL, 'weight': m['weight'], 'derived': DERIVED, 'minGroups': MIN_GROUPS}


def _read(split, cols):
    stored = set(columns(split))
    bad = [c for c in cols if c not in stored]
    if bad:
        raise KeyError('columns %s not in split %r' % (bad, split))
    need = [c for c in cols if (split, c) not in _cache]
    if need:
        parts = {c: [] for c in need}
        for f in _split(split)['files']:
            t = pq.read_table(DATA / f['path'], columns=need)
            for c in need:
                parts[c].append(t[c].to_numpy())
        for c in need:
            _cache[(split, c)] = np.concatenate(parts[c])
    return {c: _cache[(split, c)] for c in cols}


def _pred(pred, split, n):
    if pred is None:
        return None
    if isinstance(pred, str):
        return _read(split, [pred])[pred].astype('f8')
    a = np.asarray(pred, dtype='f8')
    if a.shape != (n,):
        raise ValueError('prediction array must have shape (%d,), got %s' % (n, a.shape))
    return a


def load(cols, split='dev_s', pred_col=None):
    """Return {name: numpy array} for stored or derived columns of one split."""
    out = {}
    for c in cols:
        if c == 'route_code':
            out[c] = _read(split, ['x_route_code'])['x_route_code'].astype(np.int64)
        elif c == 'horizon_bucket':
            h = _read(split, ['f_horizon_stops'])['f_horizon_stops']
            out[c] = np.searchsorted(np.array(HORIZON_EDGES, 'f8'), np.nan_to_num(h.astype('f8'), nan=0), side='right').astype(np.int64)
        elif c == 'seats_band':
            s = _read(split, ['f_remaining_seats'])['f_remaining_seats'].astype('f8')
            out[c] = np.select([np.isnan(s), s == 0, s <= 5, s <= 20], [0, 1, 2, 3], 4).astype(np.int64)
        elif c in ('residual', 'abs_error'):
            if pred_col is None:
                raise ValueError('%s needs pred_col' % c)
            y = _read(split, [LABEL])[LABEL].astype('f8')
            r = _pred(pred_col, split, len(y)) - y
            out[c] = r if c == 'residual' else np.abs(r)
        else:
            out[c] = _read(split, [c])[c]
    return out


def _base(split):
    d = _read(split, [WEIGHT, GROUP, LABEL])
    return d[WEIGHT].astype('f8'), d[GROUP].astype(np.int64), d[LABEL].astype('f8')


def _mask(where, split, n, pred_col=None):
    m = np.ones(n, bool)
    for c, cond in (where or {}).items():
        v = load([c], split, pred_col)[c]
        if isinstance(cond, (list, tuple)):
            if len(cond) != 2:
                raise ValueError('range condition must be [lo, hi] (hi exclusive, None for open)')
            lo, hi = cond
            if lo is not None:
                m &= v >= lo
            if hi is not None:
                m &= v < hi
        else:
            m &= v == cond
    return m


def _r(x, digits=6):
    x = float(x)
    return None if not np.isfinite(x) else float('%.*g' % (digits, x))


def _wquantiles(vals, w, qs):
    o = np.argsort(vals, kind='stable')
    cw = np.cumsum(w[o])
    if len(cw) == 0 or cw[-1] <= 0:
        return [None] * len(qs)
    idx = np.minimum(np.searchsorted(cw, np.asarray(qs) * cw[-1], side='left'), len(o) - 1)
    return [float(vals[o][i]) for i in idx]


def _key_codes(spec, split, w, rows, pred_col):
    m = _KEY.match(spec)
    if not m:
        raise ValueError('bad key spec %r; use a column name or name@qK' % spec)
    name, k = m.group(1), m.group(2)
    v = load([name], split, pred_col)[name][rows]
    if k is not None:
        k = int(k)
        if not 2 <= k <= 20:
            raise ValueError('quantile bins must be 2..20')
        vf = v.astype('f8')
        fin = np.isfinite(vf)
        edges = np.unique(np.array([e for e in _wquantiles(vf[fin], w[fin], [i / k for i in range(1, k)]) if e is not None]))
        codes = np.where(fin, np.searchsorted(edges, np.nan_to_num(vf, nan=0), side='right'), len(edges) + 1).astype(np.int64)
        lo = [float(np.min(vf[fin])) if fin.any() else None] + list(edges)
        hi = list(edges) + [float(np.max(vf[fin])) if fin.any() else None]
        labels = ['[%s,%s%s' % ('%.4g' % a if a is not None else '', '%.4g' % b if b is not None else '', ']' if i == len(edges) else ')')
                  for i, (a, b) in enumerate(zip(lo, hi))] + ['nan']
        return codes, labels
    uniq, inv = np.unique(v, return_inverse=True)
    if len(uniq) > MAX_CELLS:
        raise ValueError('%s has %d distinct values; use %s@qK' % (name, len(uniq), name))
    labels = [('%.6g' % u) if isinstance(u, (float, np.floating)) else int(u) for u in uniq]
    return inv.astype(np.int64), labels


def _cells(keys, split, w, rows, pred_col):
    if not keys:
        return np.zeros(int(rows.sum()), np.int64), [{}]
    if len(keys) > MAX_KEYS:
        raise ValueError('at most %d keys' % MAX_KEYS)
    code = np.zeros(int(rows.sum()), np.int64)
    labels = []
    for spec in keys:
        c, lab = _key_codes(spec, split, w, rows, pred_col)
        code = code * (len(lab) + 1) + c
        labels.append((spec, lab))
    uniq, inv = np.unique(code, return_inverse=True)
    names = []
    for u in uniq:
        key, rest = {}, int(u)
        for spec, lab in reversed(labels):
            key[spec] = lab[rest % (len(lab) + 1)]
            rest //= len(lab) + 1
        names.append(dict(reversed(list(key.items()))))
    return inv.astype(np.int64), names


def _groups_per_cell(inv, gid, ncell):
    pairs = np.unique(inv * (int(gid.max()) + 1) + gid)
    return np.bincount(pairs // (int(gid.max()) + 1), minlength=ncell)


def groupby_metrics(keys, pred_col='champion_pred', split='dev_s', compare_col=None, where=None, min_groups=MIN_GROUPS):
    """Weighted error table per cell: n_rows, n_groups, weight share, mean label, and with a prediction MAE, bias (pred-label),
    RMSE and mean prediction; with compare_col also its MAE and the MAE delta (pred minus compare). Small cells are dropped."""
    min_groups = max(MIN_GROUPS, int(min_groups))
    w, gid, y = _base(split)
    rows = _mask(where, split, len(y), pred_col)
    p, q = _pred(pred_col, split, len(y)), _pred(compare_col, split, len(y))
    w, gid, y = w[rows], gid[rows], y[rows]
    p = p[rows] if p is not None else None
    q = q[rows] if q is not None else None
    inv, names = _cells(keys, split, w, rows, pred_col)
    nc = len(names)
    B = lambda x: np.bincount(inv, x, nc)
    n = np.bincount(inv, minlength=nc)
    W = B(w)
    G = _groups_per_cell(inv, gid, nc)
    stats = {'mean_label': B(w * y) / W}
    if p is not None:
        e = p - y
        stats.update(mae=B(w * np.abs(e)) / W, bias=B(w * e) / W, rmse=np.sqrt(B(w * e * e) / W), mean_pred=B(w * p) / W)
    if q is not None:
        eq = q - y
        stats.update(mae_compare=B(w * np.abs(eq)) / W, bias_compare=B(w * eq) / W)
        stats['mae_delta'] = stats['mae'] - stats['mae_compare'] if p is not None else None
    total = float(w.sum())
    cells, sup = [], {'cells': 0, 'rows': 0, 'weight_share': 0.0}
    for i in range(nc):
        if G[i] < min_groups:
            sup['cells'] += 1
            sup['rows'] += int(n[i])
            sup['weight_share'] += float(W[i]) / total
            continue
        cell = {'key': names[i], 'n_rows': int(n[i]), 'n_groups': int(G[i]), 'weight_share': _r(W[i] / total)}
        for k_, v_ in stats.items():
            if v_ is not None:
                cell[k_] = _r(v_[i])
        cells.append(cell)
    if len(cells) > MAX_CELLS:
        raise ValueError('%d cells after suppression > %d; use fewer or coarser keys' % (len(cells), MAX_CELLS))
    sup['weight_share'] = _r(sup['weight_share'])
    overall = {'n_rows': int(len(y)), 'n_groups': int(len(np.unique(gid))), 'weight': _r(total), 'mean_label': _r((w * y).sum() / total)}
    if overall['n_groups'] < min_groups:
        raise ValueError('selection has fewer than %d groups' % min_groups)
    if p is not None:
        e = p - y
        overall.update(mae=_r((w * np.abs(e)).sum() / total), bias=_r((w * e).sum() / total), rmse=_r(np.sqrt((w * e * e).sum() / total)))
    if q is not None:
        overall['mae_compare'] = _r((w * np.abs(q - y)).sum() / total)
    return {'_lab': 'groupby/1', 'split': split, 'keys': list(keys or []), 'pred_col': pred_col if isinstance(pred_col, str) or pred_col is None else '<array>',
            'compare_col': compare_col if isinstance(compare_col, str) or compare_col is None else '<array>', 'where': where or {},
            'min_groups': min_groups, 'overall': overall, 'cells': cells, 'suppressed': sup}


def residual_quantiles(pred_col='champion_pred', keys=None, qs=(0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95), split='dev_s', where=None, min_groups=MIN_GROUPS):
    """Weighted quantiles of the residual pred - observed_seats, overall or per cell."""
    min_groups = max(MIN_GROUPS, int(min_groups))
    qs = [float(x) for x in qs]
    if not 1 <= len(qs) <= 19 or not all(0 < x < 1 for x in qs):
        raise ValueError('qs must be 1..19 values in (0,1)')
    w, gid, y = _base(split)
    rows = _mask(where, split, len(y), pred_col)
    r = (_pred(pred_col, split, len(y)) - y)[rows]
    w, gid = w[rows], gid[rows]
    inv, names = _cells(keys, split, w, rows, pred_col)
    nc = len(names)
    G = _groups_per_cell(inv, gid, nc)
    o = np.lexsort((r, inv))
    rs, ws, cs = r[o], w[o], inv[o]
    bounds = np.searchsorted(cs, np.arange(nc + 1))
    total = float(w.sum())
    cells, sup = [], 0
    for i in range(nc):
        if G[i] < min_groups:
            sup += 1
            continue
        a, b = bounds[i], bounds[i + 1]
        cw = np.cumsum(ws[a:b])
        idx = np.minimum(np.searchsorted(cw, np.array(qs) * cw[-1], side='left'), b - a - 1)
        cells.append({'key': names[i], 'n_rows': int(b - a), 'n_groups': int(G[i]), 'weight_share': _r(cw[-1] / total),
                      'quantiles': {('%g' % q_): _r(rs[a + j], 5) for q_, j in zip(qs, idx)}})
    if len(cells) > MAX_CELLS:
        raise ValueError('%d cells > %d; use fewer or coarser keys' % (len(cells), MAX_CELLS))
    return {'_lab': 'residual_quantiles/1', 'split': split, 'pred_col': pred_col if isinstance(pred_col, str) else '<array>', 'keys': list(keys or []),
            'where': where or {}, 'min_groups': min_groups, 'cells': cells, 'suppressed_cells': sup}


def correlation_table(cols, split='dev_s', pred_col=None, target=None, where=None):
    """Weighted Pearson correlations among columns (rows where all are finite). target may be 'residual', 'abs_error',
    'observed_seats' or any column; it is appended as the last column."""
    cols = list(cols) + ([target] if target else [])
    if not 2 <= len(cols) <= MAX_CORR_COLUMNS or len(set(cols)) != len(cols):
        raise ValueError('2..%d distinct columns' % MAX_CORR_COLUMNS)
    w, gid, y = _base(split)
    rows = _mask(where, split, len(y), pred_col)
    d = load(cols, split, pred_col)
    for c in cols:
        rows &= np.isfinite(d[c].astype('f8'))
    idx = np.nonzero(rows)[0]
    w = w[idx]
    ng = int(len(np.unique(gid[idx])))
    if ng < MIN_GROUPS:
        raise ValueError('fewer than %d groups with all columns finite' % MIN_GROUPS)
    W = w.sum()
    mu = [float((w * d[c][idx].astype('f8')).sum() / W) for c in cols]
    k = len(cols)
    C = np.zeros((k, k))
    step = 1 << 20
    n = len(idx)
    for s in range(0, n, step):
        ix = idx[s:s + step]
        Z = np.stack([d[c][ix].astype('f8') - mu[j] for j, c in enumerate(cols)], axis=1)
        C += (Z * w[s:s + step, None]).T @ Z
    sd = np.sqrt(np.diag(C))
    with np.errstate(invalid='ignore', divide='ignore'):
        R = C / np.outer(sd, sd)
    return {'_lab': 'corr/1', 'split': split, 'columns': cols, 'pred_col': pred_col if isinstance(pred_col, str) or pred_col is None else '<array>',
            'n_rows': int(n), 'n_groups': ng, 'matrix': [[_r(R[i, j], 4) for j in range(k)] for i in range(k)]}


def summary(cols, split='dev_s', pred_col=None, where=None):
    """Weighted distribution summary per column: finite share, mean, std and the 1/5/25/50/75/95/99 percentiles."""
    if not 1 <= len(cols) <= MAX_CORR_COLUMNS:
        raise ValueError('1..%d columns' % MAX_CORR_COLUMNS)
    w, gid, y = _base(split)
    rows = _mask(where, split, len(y), pred_col)
    d = load(cols, split, pred_col)
    w, gid = w[rows], gid[rows]
    ng = int(len(np.unique(gid)))
    if ng < MIN_GROUPS:
        raise ValueError('selection has fewer than %d groups' % MIN_GROUPS)
    out = {}
    qs = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]
    for c in cols:
        x = d[c][rows].astype('f8')
        fin = np.isfinite(x)
        wf = w[fin]
        if not fin.any():
            out[c] = {'finite_share': 0.0}
            continue
        m = float((wf * x[fin]).sum() / wf.sum())
        out[c] = {'finite_share': _r(wf.sum() / w.sum()), 'mean': _r(m), 'std': _r(np.sqrt((wf * (x[fin] - m) ** 2).sum() / wf.sum())),
                  'percentiles': {('%g' % q): _r(v) for q, v in zip(qs, _wquantiles(x[fin], wf, qs))}}
    return {'_lab': 'summary/1', 'split': split, 'where': where or {}, 'n_rows': int(rows.sum()), 'n_groups': ng, 'columns': out}


def wmae(pred, y, w):
    return float((np.asarray(w) * np.abs(np.asarray(pred, 'f8') - np.asarray(y, 'f8'))).sum() / np.sum(w))


def wbias(pred, y, w):
    return float((np.asarray(w) * (np.asarray(pred, 'f8') - np.asarray(y, 'f8'))).sum() / np.sum(w))


def _clean(v):
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, np.ndarray):
        return _clean(v.tolist())
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float) and not np.isfinite(v):
        return None
    return v


def emit(obj):
    """Write the script's single result to /out/result.json after the host's output policy checks (raises on violation)."""
    global _emitted
    if _emitted:
        raise RuntimeError('emit() may be called once')
    raw = P.dumps(_clean(obj))
    P.parse(raw)
    fd = os.open(OUT / 'result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
    _emitted = True
    return len(raw)
