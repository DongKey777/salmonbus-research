import type { EChartsOption } from 'echarts';
import type { HistoryRange } from './types.ts';
import { bucketLine, isValidPoint, rawLine, sampledPoints } from './project.ts';
import { formatNumber, formatScore, metricInfo } from './presentation.ts';

export function historyTimelineOption(range: HistoryRange, selectedId: string | null, main = false): EChartsOption {
  const { metric, mode } = range;
  const color = metricInfo[metric].color;
  const samples = sampledPoints(range);
  const rangeBands = (gaps: boolean) => range.buckets.flatMap(bucket => {
    if (!isValidPoint(bucket.min) || !isValidPoint(bucket.max) || (bucket.continuity === 'HAS_GAPS') !== gaps) return [];
    const middle = (bucket.fromOrdinal + bucket.toOrdinal) / 2;
    // The vertical band is a display summary; only original samples are clickable.
    return [{ value: [middle, bucket.min.value] }, { value: [middle, bucket.max.value] }, { value: [middle, null] }];
  });
  return {
    animation: false,
    aria: { enabled: true, description: `${metricInfo[metric].label}, 개선 기록 ${range.fromOrdinal}부터 ${range.toOrdinal}, ${mode === 'RAW' ? '원점수' : '최솟값·최댓값 요약'}. 인공 메타데이터 부하 시험.` },
    grid: { left: main ? 69 : 57, right: main ? 28 : 20, top: main ? 22 : 16, bottom: main ? 79 : 38 },
    xAxis: {
      type: 'value', min: range.fromOrdinal, max: Math.max(range.fromOrdinal + 1, range.toOrdinal),
      minInterval: 1, splitNumber: main ? 8 : 4,
      axisLabel: { formatter: (value: number) => formatNumber(value), hideOverlap: true, color: '#78899f' },
      axisLine: { show: true, lineStyle: { color: '#dce3ed' } },
      splitLine: { show: false },
      ...(main ? { name: '개선 기록 순번 · trial ordinal', nameLocation: 'middle' as const, nameGap: 33 } : {}),
    },
    yAxis: {
      type: 'value', scale: true, splitNumber: main ? 5 : 3,
      axisLabel: { formatter: (value: number) => value.toFixed(metric === 'MAE' ? 2 : metric === 'NRPS' ? 5 : 3), hideOverlap: true },
      splitLine: { lineStyle: { color: '#edf1f6', type: 'dashed' } },
    },
    tooltip: {
      trigger: 'item', renderMode: 'richText', confine: true,
      formatter: params => {
        const item = (Array.isArray(params) ? params[0] : params).data as {
          candidateId?: string; value?: [number, number | null]; modelId?: string; evaluationId?: string; runId?: string; cycleIndex?: number;
        } | undefined;
        if (!item?.candidateId || !item.value) return '';
        return `#${formatNumber(item.value[0])}  ${item.candidateId}\n${metricInfo[metric].label}  ${formatScore(item.value[1], metric)}\n${item.runId ?? ''} · 개선 ${formatNumber(item.cycleIndex)}\n${item.evaluationId ?? ''}\n인공 메타데이터 · 클릭하여 선택`;
      },
    },
    ...(main ? {
      dataZoom: [
        { type: 'inside' as const, xAxisIndex: 0, start: 0, end: 100, filterMode: 'none' as const, zoomOnMouseWheel: 'ctrl' as const, moveOnMouseMove: true, preventDefaultMouseMove: false },
        { type: 'slider' as const, xAxisIndex: 0, start: 0, end: 100, filterMode: 'none' as const, height: 17, bottom: 10, borderColor: '#dfe5ee', backgroundColor: '#f6f8fb', fillerColor: '#32988f14', handleStyle: { color: '#fff', borderColor: '#87a8aa' }, textStyle: { fontSize: 9 }, showDetail: false, brushSelect: false, realtime: false, dataBackground: { lineStyle: { color: '#c4d8d7' }, areaStyle: { color: '#e0eceb' } } },
      ],
    } : {}),
    series: [
      ...(mode === 'MIN_MAX' ? [
        { id: `history-band-${metric}`, name: '유효 구간 min–max', type: 'line' as const, data: rangeBands(false), connectNulls: false, showSymbol: false, silent: true, lineStyle: { color, width: main ? 7 : 3, opacity: .22 }, z: 1 },
        { id: `history-gap-band-${metric}`, name: '결측 포함 구간 min–max', type: 'line' as const, data: rangeBands(true), connectNulls: false, showSymbol: false, silent: true, lineStyle: { color: '#bd8b55', width: main ? 7 : 3, opacity: .27 }, z: 1 },
      ] : []),
      {
        id: `history-line-${metric}`, name: mode === 'RAW' ? '원점수' : '연속 유효 구간의 처음·마지막',
        type: 'line', connectNulls: false, smooth: false, showSymbol: false,
        data: mode === 'RAW' ? rawLine(range.points) : bucketLine(range.buckets),
        lineStyle: { color, width: 1.3, opacity: .65 }, silent: true, z: 2,
      },
      {
        id: `history-points-${metric}`, name: mode === 'RAW' ? '유효 원점수' : '실제 표본 · first / last / min / max',
        type: 'scatter', symbolSize: main ? 4.5 : 3, itemStyle: { color, opacity: .8 },
        data: samples.map(point => ({
          candidateId: point.trialId, modelId: point.modelId, evaluationId: point.evaluationId, runId: point.runId, cycleIndex: point.cycleIndex,
          value: [point.trialOrdinal, point.value],
          symbolSize: point.trialId === selectedId ? 11 : main ? 4.5 : 3,
          itemStyle: point.trialId === selectedId ? { color, opacity: 1, borderColor: '#26384c', borderWidth: 2 } : undefined,
        })), z: 3,
      },
    ],
  };
}
