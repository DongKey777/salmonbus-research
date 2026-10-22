import type { EChartsOption } from 'echarts';
import type { ComparedMetric, ComparisonPoint, RealPilotSummary } from './types.ts';
import { comparedPoints, diagnosticPoints } from './project.ts';
import { displayValue, formatDisplayNumber, formatMetric, metricSpec, metricTooltip } from '../metrics/display.ts';
import type { MetricMode } from '../metrics/display.ts';

type PilotChartMetric = ComparedMetric | 'NRPS';

function barChart(points: ComparisonPoint[], metric: PilotChartMetric, mode: MetricMode, small: boolean): EChartsOption {
  const spec = metricSpec(metric, mode);
  const axisName = `${spec.label}${spec.unit ? ` · ${spec.unit}` : ''}`;
  return {
    animation: false,
    aria: { enabled: true, description: `저장된 실제 관측 T8/V8 소형 연결 점검. ${axisName}. ${spec.explanation} ${points.map(point => `${point.label} ${formatMetric(point.value, metric, mode, true)}`).join(', ')}. 일반화나 채택 판단 없음.` },
    grid: { left: small ? 81 : 93, right: small ? 62 : 85, top: small ? 21 : 28, bottom: 44 },
    xAxis: {
      type: 'value', min: 0, max: metric === 'NRPS' ? mode === 'readable' ? 100 : 1 : undefined, splitNumber: small ? 3 : 5,
      name: axisName, nameLocation: 'middle', nameGap: 28,
      axisLabel: { hideOverlap: true, formatter: (value: number) => formatDisplayNumber(value) },
      splitLine: { lineStyle: { color: '#edf1f6', type: 'dashed' } },
    },
    yAxis: {
      type: 'category', inverse: true, data: points.map(point => point.label),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#627b98', fontSize: 10 },
    },
    tooltip: {
      trigger: 'item', renderMode: 'richText', confine: true,
      formatter: item => {
        const value = Array.isArray(item) ? item[0] : item;
        const point = points[value.dataIndex];
        return `${value.name}\n${point ? metricTooltip(point.value, metric, mode) : '미제공'}\nV8 · 저장된 실제 관측 평가`;
      },
    },
    series: [{
      name: axisName, type: 'bar', barMaxWidth: small ? 17 : 24,
      // Transform the plotted value itself so RMSE has the correct bar geometry.
      data: points.map(point => ({ value: displayValue(point.value, metric, mode), itemStyle: { color: point.color, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', distance: 9, color: '#5a718f', fontFamily: 'Menlo, Consolas, monospace', fontSize: small ? 10 : 12, formatter: item => {
        const point = points[item.dataIndex];
        return point ? formatMetric(point.value, metric, mode) : typeof item.value === 'number' ? formatDisplayNumber(item.value) : '미제공';
      } },
      emphasis: { itemStyle: { opacity: .85 } },
    }],
  };
}
export function comparisonOption(summary: RealPilotSummary, metric: ComparedMetric, mode: MetricMode = 'readable'): EChartsOption {
  return barChart(comparedPoints(summary, metric), metric, mode, metric !== 'Brier');
}
export function nrpsDiagnosticOption(summary: RealPilotSummary, mode: MetricMode = 'readable'): EChartsOption {
  return barChart(diagnosticPoints(summary), 'NRPS', mode, true);
}
