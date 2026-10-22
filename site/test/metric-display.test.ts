import test from 'node:test';
import assert from 'node:assert/strict';
import { displayValue, formatDisplayNumber, formatMetric, metricSpec, metricTooltip, rawMetricText } from '../src/metrics/display.ts';

test('readable metric units retain meaning and can return to exact raw metrics', () => {
  assert.equal(displayValue(.000014, 'Brier', 'readable'), 14);
  assert.equal(formatMetric(.000014, 'Brier', 'readable', true), '14.00 ×100만');
  assert.equal(displayValue(64, 'MSE', 'readable'), 8);
  assert.equal(metricSpec('MSE', 'readable').label, 'RMSE');
  assert.equal(metricSpec('MSE', 'readable').unit, '석');
  assert.equal(displayValue(64, 'MSE', 'raw'), 64);
  assert.equal(metricSpec('MSE', 'raw').label, 'MSE');
  assert.equal(metricSpec('MSE', 'raw').unit, '석²');
  assert.equal(displayValue(.125, 'NRPS', 'readable'), 12.5);
  assert.equal(formatMetric(.125, 'NRPS', 'readable', true), '12.50 점');
  assert.equal(displayValue(.025, 'ECE', 'readable'), 2.5);
  assert.equal(formatMetric(.025, 'ECE', 'readable', true), '2.50 %p');
  assert.equal(displayValue(5.299, 'MAE', 'readable'), 5.299);
  assert.equal(formatMetric(5.299, 'MAE', 'readable', true), '5.30 석');
});

test('unknown values remain gaps; a tiny nonzero error is never made perfect zero', () => {
  for (const metric of ['Brier', 'MAE', 'MSE', 'NRPS', 'ECE'] as const) {
    for (const mode of ['raw', 'readable'] as const) {
      for (const value of [null, undefined, NaN, Infinity]) {
        assert.equal(displayValue(value, metric, mode), null);
        assert.equal(formatMetric(value, metric, mode), '—');
      }
      assert.equal(displayValue(0, metric, mode), 0);
      assert.notEqual(formatMetric(1e-15, metric, mode), '0');
      assert.doesNotMatch(formatMetric(1e-15, metric, mode), /e[-+]/);
    }
  }
  assert.equal(displayValue(-1, 'MSE', 'readable'), null);
  assert.equal(displayValue(Number.MAX_VALUE, 'Brier', 'readable'), null);
  assert.equal(displayValue(-.000002, 'Brier', 'readable'), -2);
});

test('tooltip explains conversion without replacing the original score or hiding nearby ticks', () => {
  const raw = 60.39003214773738;
  assert.match(metricTooltip(raw, 'MSE', 'readable'), /RMSE 7\.77 석/);
  assert.match(metricTooltip(raw, 'MSE', 'readable'), /원값 MSE: 60\.39003214773738/);
  assert.equal(rawMetricText(raw), String(raw));
  assert.match(metricSpec('NRPS', 'readable').explanation, /정확도가 아닙니다/);
  const ticks = [0, 5, 10, 15, 20, 25, 30].map(formatDisplayNumber);
  assert.equal(new Set(ticks).size, ticks.length);
  assert.equal(formatDisplayNumber(12345), '12,345');
});
