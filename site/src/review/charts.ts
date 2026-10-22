import type {EChartsOption} from 'echarts';
import type {ProposalFrame} from './types';
export function frontierOption(frame:ProposalFrame,labels:Record<string,string>):EChartsOption{
  return {animation:false,grid:{left:124,right:34,top:25,bottom:45},
    xAxis:{type:'value',min:0,max:frame.sourceGeneration+2,minInterval:1,name:'원 장부 순번',nameLocation:'middle',nameGap:29},
    yAxis:{type:'category',inverse:true,data:frame.registeredPrefix.map(r=>labels[r.candidateId]??r.candidateId),axisLabel:{width:110,overflow:'truncate'},splitLine:{show:true,lineStyle:{color:'#edf1f6'}}},
    tooltip:{renderMode:'richText',confine:true,formatter:raw=>{const p=raw as {dataIndex:number};const r=frame.registeredPrefix[p.dataIndex];return r?`${labels[r.candidateId]??r.candidateId}\n등록 #${r.registeredGeneration}\n보고 ${r.reportHash.slice(0,12)}`:'';}},
    series:[{id:'registered-prefix',name:'입력에 포함된 보고',type:'scatter',symbolSize:10,
      data:frame.registeredPrefix.map((r,i)=>({value:[r.registeredGeneration,i],itemStyle:{color:r.candidateId===frame.reference.candidateId?'#8291a8':'#587cc2'}})),
      markLine:{silent:true,symbol:'none',lineStyle:{type:'dashed',color:'#a8b7ca'},label:{position:'insideEndTop',formatter:`초안 시점 #${frame.sourceGeneration}`,fontSize:10},data:[{xAxis:frame.sourceGeneration}]}}]};
}
