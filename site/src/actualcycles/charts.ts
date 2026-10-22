import type { EChartsOption } from 'echarts';
import type { ChartGroup, Metric } from './types.ts';
import { candidateValue, referenceValue } from './project.ts';
import { metricInfo, score } from './presentation.ts';
import { displayValue, formatDisplayNumber, metricSpec, metricTooltip } from '../metrics/display.ts';
import type { MetricMode } from '../metrics/display.ts';

export function metricTrend(group: ChartGroup, metric: Metric, selectedId: string | null, main = false, mode: MetricMode = 'readable'): EChartsOption {
  const color = metricInfo[metric].color, baseline = referenceValue(group, metric);
  const spec = metricSpec(metric, mode);
  return {
    animation: false, grid: { left: main ? 72 : 61, right: 23, top: main ? 37 : 29, bottom: 49 },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: params => (Array.isArray(params) ? params : [params]).map(item =>
      `${item.seriesName}\n${metricTooltip((item.data as { rawValue?: number | null } | undefined)?.rawValue, metric, mode)}`).join('\n\n') },
    legend: { top: 4, right: 16, data: baseline === null ? ['새 후보'] : ['새 후보', '당시 제품 예보'] },
    xAxis: { type: 'category', data: ['1', '2', '3', '4', '5'], name: '새 모델 개선 시도', nameLocation: 'middle', nameGap: 31, axisLabel: { formatter: value => `시도 ${value}` } },
    yAxis: { type: 'value', scale: true, name: `${spec.label} · ${spec.unit}`, nameTextStyle: { align: 'left' }, axisLabel: { hideOverlap: true, formatter: formatDisplayNumber } },
    series: [
      { id: `actual-${metric}`, name: '새 후보', type: 'line', smooth: false, connectNulls: false, showSymbol: true, showAllSymbol: true, symbolSize: main ? 9 : 7,
        data: group.slots.map(cycle => ({
          value: displayValue(candidateValue(cycle, metric, group.group.groupRef), metric, mode),
          rawValue: candidateValue(cycle, metric, group.group.groupRef), candidateId: cycle?.cycleId,
          symbolSize: cycle?.cycleId === selectedId ? 12 : main ? 9 : 7,
          itemStyle: { color, borderColor: cycle?.cycleId === selectedId ? '#284762' : '#fff', borderWidth: cycle?.cycleId === selectedId ? 2.5 : 1.5 },
        })), lineStyle: { color, width: 2 }, itemStyle: { color } },
      ...(baseline === null ? [] : [{ id: `reference-${metric}`, name: '당시 제품 예보', type: 'line' as const, silent: true,
        data: Array.from({ length: 5 }, () => ({ value: displayValue(baseline, metric, mode), rawValue: baseline })), symbol: 'none', lineStyle: { color: '#94a3b8', type: 'dashed' as const, width: 1.5 } }]),
    ],
  };
}
export function deltaTrend(group: ChartGroup, mode: MetricMode = 'readable'): EChartsOption {
  const baseline = referenceValue(group, 'Brier');
  return {
    animation: false, grid: { left: 68, right: 21, top: 28, bottom: 48 },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, formatter: params => {
      const item = Array.isArray(params) ? params[0] : params;
      return `제품 − 후보 차이\n${metricTooltip((item.data as { rawValue?: number | null })?.rawValue, 'Brier', mode)}`;
    } },
    xAxis: { type: 'category', data: ['1', '2', '3', '4', '5'], name: '새 모델 개선 시도', nameLocation: 'middle', nameGap: 30 },
    yAxis: { type: 'value', name: `Brier · ${metricSpec('Brier', mode).unit}`, nameTextStyle: { align: 'left' }, axisLabel: { formatter: formatDisplayNumber } },
    series: [{ type: 'bar', name: '제품 − 후보 Brier', barMaxWidth: 28,
      data: group.slots.map(cycle => {
        const value = candidateValue(cycle, 'Brier', group.group.groupRef);
        const difference = baseline === null || value === null ? null : baseline - value;
        return { value: displayValue(difference, 'Brier', mode), rawValue: difference, itemStyle: { color: difference !== null && difference >= 0 ? '#32988f' : '#cf725b' } };
      }), markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#a7b5c5', type: 'solid' }, data: [{ yAxis: 0 }] } }],
  };
}
export function resourcesTrend(group: ChartGroup): EChartsOption {
  return {
    animation: false, grid: { left: 55, right: 48, top: 31, bottom: 43 },
    legend: { top: 3, data: ['CPU', '벽시계', '최고 RSS'] },
    tooltip: { trigger: 'axis', renderMode: 'richText', valueFormatter: value => typeof value === 'number' ? score(value, 3) : '미계측' },
    xAxis: { type: 'category', data: ['1', '2', '3', '4', '5'] },
    yAxis: [{ type: 'value', name: '초', min: 0 }, { type: 'value', name: 'MiB', min: 0, splitLine: { show: false } }],
    series: [
      { name: 'CPU', type: 'bar', barMaxWidth: 15, itemStyle: { color: '#a4b9cc' }, data: group.slots.map(cycle => cycle?.resources?.reportedCpuSeconds ?? null) },
      { name: '벽시계', type: 'bar', barMaxWidth: 15, itemStyle: { color: '#d4dfe9' }, data: group.slots.map(cycle => cycle?.resources?.reportedWallSeconds ?? null) },
      { name: '최고 RSS', type: 'line', yAxisIndex: 1, connectNulls: false, symbolSize: 6, itemStyle: { color: '#8b72be' }, data: group.slots.map(cycle => cycle?.resources?.reportedPeakRssMiB ?? null) },
    ],
  };
}
