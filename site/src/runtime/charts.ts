/** Pure chart options: measured worker time only, never API response time. */
import type {EChartsOption} from 'echarts';
import type {RuntimeAttempt} from './types';
const blue='#4f72c3',teal='#3d8e8b';
function timeScale(attempt:RuntimeAttempt){const ms=(attempt.elapsedSeconds??0)<1;return {factor:ms?1000:1,axis:{type:'value' as const,min:0,name:`작업 시작 후 경과 (${ms?'ms':'초'})`,nameLocation:'middle' as const,nameGap:28,axisLabel:{hideOverlap:true}}};}
const grid={left:55,right:23,top:38,bottom:44};
export function memoryOption(attempt:RuntimeAttempt):EChartsOption{
 const {factor,axis:xAxis}=timeScale(attempt);
 return {animation:false,grid:{...grid,top:52},tooltip:{trigger:'axis',renderMode:'richText',confine:true},xAxis,
  yAxis:{type:'value',min:0,name:'MiB',nameGap:8,axisLabel:{hideOverlap:true}},legend:{top:0,left:45,selectedMode:false,itemWidth:12,itemHeight:5,textStyle:{fontSize:10}},
  series:([{key:'currentRssMiB',name:'현재 RSS',color:blue},{key:'peakRssMiB',name:'최고 RSS',color:teal}] as const).map(s=>({
   id:s.key,name:s.name,type:'line',smooth:false,connectNulls:false,showSymbol:true,symbolSize:5,
   lineStyle:{width:1.7,color:s.color},itemStyle:{color:s.color},data:attempt.events.map(e=>[e.elapsedSeconds*factor,e[s.key]])
  }))};
}
export function eventsOption(attempt:RuntimeAttempt):EChartsOption{
 const {factor,axis:xAxis}=timeScale(attempt);
 const stages=[...new Set(attempt.events.map(e=>e.stageLabel))];
 return {animation:false,grid:{...grid,left:110,top:25},xAxis,
  yAxis:{type:'category',data:stages,inverse:true,axisLabel:{width:95,overflow:'truncate'},splitLine:{show:true,lineStyle:{color:'#edf1f6'}}},
  tooltip:{renderMode:'richText',confine:true,formatter:raw=>{const p=raw as {dataIndex:number};const e=attempt.events[p.dataIndex];return e?`#${e.seq} · ${e.stageLabel}\n${e.eventLabel}\n작업 경과 ${e.elapsedSeconds.toFixed(2)}초`:'';}},
  series:[{id:'worker-events',name:'작업 사건',type:'scatter',symbolSize:7,itemStyle:{color:blue},data:attempt.events.map(e=>[e.elapsedSeconds*factor,stages.indexOf(e.stageLabel)])}]};
}
export function workOption(attempt:RuntimeAttempt):EChartsOption{
 const {factor,axis:xAxis}=timeScale(attempt);
 const measured=attempt.events.filter(e=>e.done!==null&&e.total!==null&&e.unitLabel!==null);
 return {animation:false,grid:{...grid,top:28},tooltip:{trigger:'axis',renderMode:'richText',confine:true},xAxis,
  yAxis:{type:'value',min:0,name:'완료 단위 수',minInterval:1,axisLabel:{hideOverlap:true}},
  series:[{id:'completed-units',name:'정수 레코드',type:'line',step:'end',showSymbol:true,symbolSize:5,
   lineStyle:{width:1.8,color:blue},itemStyle:{color:blue},areaStyle:{color:'#e6edf9',opacity:.5},data:measured.map(e=>[e.elapsedSeconds*factor,e.done])}]};
}
