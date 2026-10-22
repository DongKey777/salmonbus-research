import type {EChartsOption} from 'echarts';
import {MODEL_COLORS} from '../ui/chart-theme.ts';
import type {CycleChartGroup,Metric,CyclePoint} from './types.ts';

const titles:Record<Metric,string>={Brier:'Brier',NRPS:'NRPS',MAE:'좌석 MAE',ECE:'ECE10'};
const color:Record<Metric,string>={Brier:MODEL_COLORS[3],NRPS:MODEL_COLORS[4],MAE:MODEL_COLORS[1],ECE:MODEL_COLORS[2]};
export function metricTrend(group:CycleChartGroup,metric:Metric,selected:number|null):EChartsOption{
 const points=group.baseline?[group.baseline,...group.points]:group.points;
 const x=points.map(p=>p.index);
 const base=group.baseline?.metrics[metric]??null;
 return {
  animation:false,
  grid:{left:62,right:24,top:36,bottom:54},
  tooltip:{trigger:'axis',renderMode:'richText',confine:true,valueFormatter:(value)=>typeof value==='number'?value.toFixed(5):'미산출'},
  legend:{top:0,right:16,data:['새 후보','고정 기준']},
  xAxis:{type:'category',data:x,axisLabel:{formatter:(v)=>v==='0'?'기준':`#${v}`},name:'개선 시도',nameLocation:'middle',nameGap:32},
  yAxis:{type:'value',scale:true,name:metric==='MAE'?'좌석':titles[metric],nameTextStyle:{align:'right'},axisLabel:{hideOverlap:true,formatter:(n:number)=>n.toFixed(metric==='MAE'?2:metric==='NRPS'?5:3)}},
  series:[
   {id:`candidate-${metric}`,name:'새 후보',type:'line',connectNulls:false,smooth:false,showSymbol:true,showAllSymbol:true,symbol:'circle',symbolSize:8,
    data:points.map(p=>({candidateId:'cycle:'+p.index,value:p.metrics[metric],itemStyle:{color:color[metric],borderColor:p.index===selected?'#26384c':'#fff',borderWidth:p.index===selected?3:2},symbolSize:p.index===selected?12:8})),
    lineStyle:{color:color[metric],width:2.5},itemStyle:{color:color[metric]},emphasis:{focus:'series'},areaStyle:{color:color[metric],opacity:.035}},
   {id:`baseline-${metric}`,name:'고정 기준',type:'line',data:points.map(()=>base),symbol:'none',silent:true,
    lineStyle:{type:'dashed',color:'#97a3b3',width:1.5}}
  ]
 };
}
/** One point is one completed registered experiment, never an epoch or forecast. */
export function deltaTrend(group:CycleChartGroup):EChartsOption{
 const baseline=group.baseline?.metrics.Brier;
 return {
  animation:false,
  grid:{left:62,right:24,top:22,bottom:48},
  tooltip:{trigger:'axis',renderMode:'richText',valueFormatter:(v)=>typeof v==='number'?v.toFixed(5):'미산출'},
  xAxis:{type:'category',data:group.points.map(p=>`#${p.index}`),name:'개선 시도',nameLocation:'middle',nameGap:30},
  yAxis:{type:'value',name:'기준 − 후보',axisLabel:{hideOverlap:true}},
  series:[{name:'Brier 차이',type:'bar',barMaxWidth:35,data:group.points.map(p=>{
   const value=baseline===null||baseline===undefined||p.metrics.Brier===null?null:baseline-p.metrics.Brier;
   return {value,itemStyle:{color:value!==null&&value>=0?'#32988f':'#cf725b',borderRadius:[3,3,0,0]}};
  }),markLine:{silent:true,symbol:'none',lineStyle:{color:'#a7b3c3',type:'solid'},data:[{yAxis:0}]}}]
 };
}
export function resourcesTrend(points:CyclePoint[]):EChartsOption{
 return {
  animation:false,
  grid:{left:58,right:48,top:28,bottom:45},tooltip:{trigger:'axis',renderMode:'richText'},
  legend:{top:0,data:['벽시계 시간','최고 RSS']},
  xAxis:{type:'category',data:points.map(p=>p.index===0?'기준':`#${p.index}`)},
  yAxis:[{type:'value',name:'초',min:0},{type:'value',name:'MiB',min:0,splitLine:{show:false}}],
  series:[
   {name:'벽시계 시간',type:'bar',data:points.map(p=>p.wallSeconds),barMaxWidth:24,itemStyle:{color:'#dce5ef'}},
   {name:'최고 RSS',type:'line',yAxisIndex:1,connectNulls:false,data:points.map(p=>p.peakRssBytes===null?null:p.peakRssBytes/1048576),itemStyle:{color:'#8b72be'},symbolSize:6}
  ]
 };
}
