import type { EChartsOption } from 'echarts';
import { bucketLine, isValidPoint, rawLine, sampledPoints } from '../project.ts';
import { formatNumber } from '../presentation.ts';
import { displayValue, formatDisplayNumber, metricSpec, metricTooltip } from '../../metrics/display.ts';
import type { MetricMode } from '../../metrics/display.ts';
import { metricInfo } from './presentation.ts';
import type { ActualRange, ActualReference } from './types.ts';

export function actualRangeOption(range: ActualRange, selectedId: string | null, reference: ActualReference | undefined, main = false, metricMode: MetricMode = 'raw'): EChartsOption {
  const color = metricInfo[range.metric].color;
  const spec = metricSpec(range.metric, metricMode);
  const referenceRawValue = reference?.groupRef === range.groupRef && !['NRPS', 'ECE'].includes(range.metric) ? reference.metrics[range.metric] : null;
  const referenceValue = displayValue(referenceRawValue, range.metric, metricMode);
  const project = (ordinal: number, rawValue: number | null) => ({
    rawValue, value: [ordinal, displayValue(rawValue, range.metric, metricMode)] as [number, number | null],
  });
  const bands = (gaps: boolean) => range.buckets.flatMap(bucket => {
    if (!isValidPoint(bucket.min) || !isValidPoint(bucket.max) || (bucket.continuity === 'HAS_GAPS') !== gaps) return [];
    const center = (bucket.fromOrdinal + bucket.toOrdinal) / 2;
    return [project(center, bucket.min.value), project(center, bucket.max.value), project(center, null)];
  });
  const line = (range.mode === 'RAW' ? rawLine(range.points) : bucketLine(range.buckets))
    .map(point => ({ ...point, ...project(point.value[0], point.value[1]) }));
  return {
    animation: false,
    aria: { enabled: true, description: `실제 완료 연구의 ${spec.label}, 단위 ${spec.unit || '원값'}. ${range.mode === 'RAW' ? '개별 평가점' : '최솟값·최댓값 요약'}. ${spec.explanation} 재사용한 개발 V 평가이며 미채택.` },
    grid: { left: main ? 82 : 73, right: 26, top: 34, bottom: main ? 75 : 40 },
    xAxis: { type: 'value', min: range.fromOrdinal, max: Math.max(range.fromOrdinal + 1, range.toOrdinal), minInterval: 1, splitNumber: main ? 8 : 4,
      axisLabel: { formatter: (value: number) => formatNumber(value), hideOverlap: true }, splitLine: { show: false },
      ...(main ? { name: '후보 평가 순번 · trial ordinal', nameLocation: 'middle' as const, nameGap: 31 } : {}) },
    yAxis: { type: 'value', scale: true, splitNumber: main ? 5 : 3, name: spec.unit || spec.label, nameTextStyle: { align: 'right' },
      axisLabel: { hideOverlap: true, formatter: (value: number) => formatDisplayNumber(value) }, splitLine: { lineStyle: { color: '#edf1f6', type: 'dashed' } } },
    legend: { top: 2, right: 16, data: referenceValue === null ? ['실제 후보'] : ['실제 후보', '당시 제품 예보'] },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: params => {
      const item = (Array.isArray(params) ? params[0] : params).data as { candidateId?: string; value?: [number, number | null]; rawValue?: number | null; cycleIndex?: number } | undefined;
      return item?.candidateId && item.value ? `후보 평가 #${formatNumber(item.value[0])} · 실행 내 시도 ${item.cycleIndex}\n${metricTooltip(item.rawValue, range.metric, metricMode)}\n${item.candidateId}\nDEV_REUSED · 미채택` : '';
    } },
    ...(main ? { dataZoom: [
      { type: 'inside' as const, start: 0, end: 100, filterMode: 'none' as const, zoomOnMouseWheel: 'ctrl' as const, preventDefaultMouseMove: false },
      { type: 'slider' as const, start: 0, end: 100, filterMode: 'none' as const, height: 17, bottom: 9, realtime: false, brushSelect: false, showDetail: false, borderColor: '#dfe5ee', fillerColor: '#32988f14', handleStyle: { color: '#fff', borderColor: '#85aaa5' } },
    ] } : {}),
    series: [
      ...(range.mode === 'MIN_MAX' ? [
        { id: 'actual-valid-bands', type: 'line' as const, data: bands(false), silent: true, showSymbol: false, connectNulls: false, lineStyle: { color, width: main ? 7 : 3, opacity: .22 } },
        { id: 'actual-gap-bands', type: 'line' as const, data: bands(true), silent: true, showSymbol: false, connectNulls: false, lineStyle: { color: '#bd8b55', width: main ? 7 : 3, opacity: .27 } },
      ] : []),
      { id: 'actual-candidate-line', type: 'line', silent: true, showSymbol: false, connectNulls: false, smooth: false,
        data: line, lineStyle: { color, width: 1.6, opacity: .7 } },
      { id: 'actual-candidate-points', name: '실제 후보', type: 'scatter', itemStyle: { color }, data: sampledPoints(range).map(point => ({
        candidateId: point.trialId, cycleIndex: point.cycleIndex, ...project(point.trialOrdinal, point.value), symbolSize: point.trialId === selectedId ? 11 : main ? 7 : 5,
        itemStyle: point.trialId === selectedId ? { color, borderColor: '#284762', borderWidth: 2 } : { color },
      })) },
      ...(referenceValue === null ? [] : [{
        id: 'actual-external-reference', name: '당시 제품 예보', type: 'line' as const, silent: true, symbol: 'none',
        data: [project(range.fromOrdinal, referenceRawValue), project(Math.max(range.fromOrdinal + 1, range.toOrdinal), referenceRawValue)],
        lineStyle: { color: '#94a3b8', type: 'dashed' as const, width: 1.5 }, itemStyle: { color: '#94a3b8' },
      }]),
    ],
  };
}
