import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EChartsType } from 'echarts';
import { ChartFrame } from '../../ui/ChartFrame';
import { windowFromZoom } from '../project.ts';
import type { OrdinalWindow } from '../types.ts';
import { actualRangeOption } from './charts.ts';
import type { ActualRange, ActualReference } from './types.ts';
import { useMetricMode } from '../../metrics/MetricPresentation';
import { metricSpec } from '../../metrics/display.ts';

export function ActualRangeChart({ range, reference, selectedId, main = false, onSelect, onWindow }: {
  range: ActualRange; reference: ActualReference | undefined; selectedId: string | null; main?: boolean;
  onSelect: (id: string) => void; onWindow?: (window: OrdinalWindow) => void;
}) {
  const { mode: metricMode } = useMetricMode();
  const latest = useRef({ range, onWindow }); latest.current = { range, onWindow };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attached = useRef<{ chart: EChartsType; handler: (event: unknown) => void } | null>(null);
  const option = useMemo(() => actualRangeOption(range, selectedId, reference, main, metricMode), [range, selectedId, reference, main, metricMode]);
  const onInstance = useCallback((_id: string, chart: EChartsType | null) => {
    if (attached.current) attached.current.chart.off('datazoom', attached.current.handler);
    attached.current = null;
    if (!chart || !main) return;
    const handler = (event: unknown) => {
      clearTimeout(timer.current);
      const next = windowFromZoom(event as Parameters<typeof windowFromZoom>[0], latest.current.range);
      if (next && latest.current.onWindow) timer.current = setTimeout(() => latest.current.onWindow?.(next), 250);
    };
    chart.on('datazoom', handler); attached.current = { chart, handler };
  }, [main]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const spec = metricSpec(range.metric, metricMode);
  return <ChartFrame id={`actual-history-${range.metric.toLowerCase()}`} label={`실제 연구 이력 ${spec.label} · ${spec.unit || '원값'} · ${range.mode === 'RAW' ? '개별 평가점' : 'min–max 요약'}`}
    option={option} renderer="canvas" onPick={onSelect} onInstance={onInstance}/>;
}
