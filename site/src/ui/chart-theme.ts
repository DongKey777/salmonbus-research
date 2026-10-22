/** Shared chart appearance only; no data, metrics, network or React dependencies. */
export const MODEL_COLORS=['#8291a8','#cf725b','#8b72be','#32988f','#4d8fb8','#b38a42'];
export const THEME={
 color:MODEL_COLORS,
 backgroundColor:'transparent',
 textStyle:{fontFamily:'Helvetica Neue, Apple SD Gothic Neo, sans-serif',color:'#6a7b90',fontSize:10},
 categoryAxis:{axisLine:{lineStyle:{color:'#dce3ed'}},axisTick:{show:false},axisLabel:{color:'#738299',fontSize:10},splitLine:{show:false}},
 valueAxis:{axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#738299',fontSize:10,hideOverlap:true},splitLine:{lineStyle:{color:'#edf1f6'}}},
 tooltip:{backgroundColor:'#fff',borderColor:'#d6e0ed',borderWidth:1,textStyle:{color:'#26384c',fontSize:11}},
 legend:{textStyle:{color:'#64748b',fontSize:10}},
};
