import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart,BarChart,ScatterChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,MarkLineComponent,DataZoomComponent,LegendComponent,AriaComponent} from 'echarts/components';
import {SVGRenderer,CanvasRenderer} from 'echarts/renderers';
import type {EChartsOption,EChartsType} from 'echarts';
import {THEME} from './ui/chart-theme';
/** ECharts animates in JS, so the CSS reduced-motion rule does not reach it. */
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const withMotion=(option:EChartsOption):EChartsOption=>reducedMotion()?{...option,animation:false}:option;
echarts.use([LineChart,BarChart,ScatterChart,GridComponent,TooltipComponent,MarkLineComponent,DataZoomComponent,LegendComponent,AriaComponent,SVGRenderer,CanvasRenderer]);echarts.registerTheme('salmon-monitor',THEME);
export function Chart({id,label,option,onPick,onInstance,renderer='svg'}:{id:string;label?:string;option:EChartsOption;onPick?:(id:string)=>void;onInstance?:(id:string,c:EChartsType|null)=>void;renderer?:'svg'|'canvas'}){
 const el=useRef<HTMLDivElement>(null),instance=useRef<EChartsType|null>(null),handler=useRef(onPick),axisSignature=useRef(''),latest=useRef(option);handler.current=onPick;latest.current=option;
 useEffect(()=>{
  if(!el.current)return;const host=el.current;let disposed=false;
  const sync=()=>{
   if(disposed||host.clientWidth===0||host.clientHeight===0)return;
   if(instance.current){instance.current.resize();return;}
   const chart=echarts.init(host,'salmon-monitor',{renderer});axisSignature.current=JSON.stringify(latest.current.xAxis);instance.current=chart;onInstance?.(id,chart);
   chart.on('click',p=>{const item=p.data as {candidateId?:string}|undefined;const candidate=item?.candidateId||p.seriesId;if(candidate)handler.current?.(candidate);});
   chart.setOption(withMotion(latest.current),{notMerge:true,lazyUpdate:false});
  };
  const obs=new ResizeObserver(sync);obs.observe(host);sync();
  return()=>{disposed=true;obs.disconnect();onInstance?.(id,null);instance.current?.dispose();instance.current=null;};
 },[id,renderer]);
 useEffect(()=>{const c=instance.current;if(!c)return;const signature=JSON.stringify(option.xAxis);let next=option;if(signature===axisSignature.current&&Array.isArray(option.dataZoom)){const old=c.getOption()?.dataZoom as {start?:number;end?:number}[]|undefined;if(old?.length)next={...option,dataZoom:option.dataZoom.map((z,i)=>({...z,start:old[i]?.start,end:old[i]?.end}))};}axisSignature.current=signature;c.setOption(withMotion(next),{notMerge:true,lazyUpdate:false});},[option]);
 return <div className="chart" id={id} ref={el} role="img" aria-label={label??(id==='composite-chart'?'종합 예보 개선지수 그래프':id)}/>;
}
