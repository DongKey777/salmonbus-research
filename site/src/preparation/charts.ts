/** Pure ECharts configuration: no fetching, clocks, DOM or acceptance decisions. */
import type {EChartsOption} from 'echarts';
import type {PreparationJob} from './types';
import {PREPARATION_COLORS as C,number} from './presentation.ts';

const grid={left:57,right:28,top:32,bottom:47};
const tooltip={trigger:'axis' as const,renderMode:'richText' as const,confine:true};
const shortTime=(value:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(value);
const xAxis={type:'time' as const,name:'보고 수신 시각 (KST)',nameLocation:'middle' as const,nameGap:31,axisLabel:{hideOverlap:true,formatter:shortTime}};
type SampleKey='freeGiB'|'currentRssMiB'|'peakRssMiB'|'reportedRssMiB'|'algorithmVisits';
function points(job:PreparationJob,key:SampleKey){
 return job.samples.filter(s=>s.receivedAt!==null).map(s=>[Date.parse(s.receivedAt!),s[key]]);
}
function line(job:PreparationJob,key:SampleKey,name:string,color:string,scatter=false){
 return {id:key,name,type:scatter?'scatter':'line',data:points(job,key),smooth:false,connectNulls:false,
  showSymbol:true,symbolSize:7,lineStyle:{width:1.8,color},itemStyle:{color}};
}
export function sampleCount(job:PreparationJob,key:SampleKey){return job.samples.filter(s=>s.receivedAt!==null&&s[key]!==null).length;}

export function memoryOption(job:PreparationJob):EChartsOption{
 const series=[line(job,'currentRssMiB','현재 RSS',C.blue),line(job,'peakRssMiB','최고 RSS',C.teal),line(job,'reportedRssMiB','측정 종류 미확인',C.muted,true)];
 const values=job.samples.flatMap(s=>[s.currentRssMiB,s.peakRssMiB,s.reportedRssMiB]).filter((x):x is number=>x!==null);
 return {animation:false,grid:{...grid,top:50},tooltip,legend:{top:0,left:44,selectedMode:false,itemWidth:12,itemHeight:5,textStyle:{fontSize:10}},xAxis,
  yAxis:{type:'value',min:0,max:Math.ceil(Math.max(job.limits.rssMiB??0,...values,1)/100)*100,name:'MiB',nameGap:8,axisLabel:{hideOverlap:true}},
  series:series.map((s,i)=>({...s,...(i===0&&job.limits.rssMiB!==null?{markLine:{symbol:'none',silent:true,label:{position:'insideEndTop',formatter:`상한 ${number(job.limits.rssMiB)} MiB`,fontSize:10},lineStyle:{type:'dashed',color:'#c6aa86'},data:[{yAxis:job.limits.rssMiB}]}}:{})}))} as EChartsOption;
}
export function diskOption(job:PreparationJob):EChartsOption{
 return {animation:false,grid,tooltip,xAxis,yAxis:{type:'value',min:0,name:'남은 GiB',axisLabel:{hideOverlap:true}},
  series:[{...line(job,'freeGiB','디스크 여유',C.teal),areaStyle:{color:'#d4e8e5',opacity:.35},
   ...(job.limits.minimumFreeGiB!==null?{markLine:{symbol:'none',silent:true,label:{position:'insideEndTop',formatter:`최소 ${number(job.limits.minimumFreeGiB)} GiB`,fontSize:10},lineStyle:{type:'dashed',color:C.amber},data:[{yAxis:job.limits.minimumFreeGiB}]}}:{})}]} as EChartsOption;
}
export function timelineOption(job:PreparationJob):EChartsOption{
 const timed=job.milestones.filter(m=>m.reportReceivedAt!==null);
 const labels=[...new Set(timed.map(m=>m.label))];
 return {animation:false,grid:{left:127,right:42,top:26,bottom:63},
  xAxis,
  yAxis:{type:'category',data:labels,inverse:true,axisLabel:{fontSize:11,width:115,overflow:'truncate'},splitLine:{show:true,lineStyle:{color:C.grid}}},
  tooltip:{renderMode:'richText',confine:true,formatter:raw=>{const p=raw as {dataIndex:number};const m=timed[p.dataIndex];return m?`${m.label}\n보고 수신 ${shortTime(Date.parse(m.reportReceivedAt!))} KST\n단계 소요 시간 아님`:'';}},
  dataZoom:[{type:'inside',filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseMove:false},{type:'slider',height:10,bottom:5,showDetail:false,borderColor:C.grid}],
  series:[{id:'milestones',name:'단계 보고',type:'scatter',symbolSize:11,data:timed.map(m=>({value:[Date.parse(m.reportReceivedAt!),labels.indexOf(m.label)],itemStyle:{color:m.state==='STOPPED'?C.rose:m.state==='COMPLETED'?C.teal:C.blue}}))}]} as EChartsOption;
}
export function workloadOption(job:PreparationJob):EChartsOption{
 return {animation:false,grid,tooltip,xAxis,yAxis:{type:'value',name:'알고리즘 방문 수',min:0,axisLabel:{formatter:v=>`${number(v/1e6,0)}M`,hideOverlap:true}},series:[line(job,'algorithmVisits','기록된 누적 방문 수',C.blue)]} as EChartsOption;
}
export function referenceOption(job:PreparationJob):EChartsOption{
 const counts=job.counts;
 const rows=[{name:'관측 키 연결',value:counts?.matched??null,color:C.teal},{name:'수집 상한 밖',value:counts?.aboveHighwater??null,color:C.amber},{name:'도착 참조 NULL',value:counts?.nullRows??null,color:C.muted}];
 return {animation:false,grid:{left:106,right:25,top:15,bottom:37},tooltip:{...tooltip,trigger:'item',valueFormatter:v=>typeof v==='number'?`${number(v)}행`:String(v)},
  xAxis:{type:'value',name:'행',axisLabel:{formatter:v=>`${number(v/1e6,0)}M`,hideOverlap:true}},
  yAxis:{type:'category',inverse:true,data:rows.map(r=>r.name),axisLabel:{fontSize:11}},
  series:[{id:'references',type:'bar',barMaxWidth:19,data:rows.map(r=>({value:r.value,itemStyle:{color:r.color,opacity:job.countScope==='INTERMEDIATE'?.55:1}}))}]} as EChartsOption;
}
