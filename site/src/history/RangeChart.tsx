import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EChartsType } from 'echarts';
import { ChartFrame } from '../ui/ChartFrame';
import type { HistoryRange, OrdinalWindow } from './types.ts';
import { historyTimelineOption } from './charts.ts';
import { windowFromZoom } from './project.ts';
import { metricInfo } from './presentation.ts';

export function RangeChart({ range, selectedId, main = false, onSelect, onWindow }: {
  range: HistoryRange;
  selectedId: string | null;
  main?: boolean;
  onSelect: (trialId: string) => void;
  onWindow?: (window: OrdinalWindow) => void;
}) {
  const latest = useRef({ range, onWindow });
  latest.current = { range, onWindow };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attached = useRef<{ chart: EChartsType; handler: (event: unknown) => void } | null>(null);
  const option = useMemo(() => historyTimelineOption(range, selectedId, main), [range, selectedId, main]);
  const onInstance = useCallback((_id: string, chart: EChartsType | null) => {
    if (attached.current) attached.current.chart.off('datazoom', attached.current.handler);
    attached.current = null;
    if (!chart || !main) return;
    const handler = (event: unknown) => {
      clearTimeout(timer.current);
      const { range: current, onWindow: change } = latest.current;
      const next = windowFromZoom(event as Parameters<typeof windowFromZoom>[0], current);
      if (next && change) timer.current = setTimeout(() => change(next), 250);
    };
    chart.on('datazoom', handler);
    attached.current = { chart, handler };
  }, [main]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <ChartFrame
    id={`history-${range.metric.toLowerCase()}`}
    label={`${metricInfo[range.metric].label} 개선 기록 그래프 · ${range.mode}`}
    option={option} renderer="canvas" onPick={onSelect} onInstance={onInstance}
  />;
}
