import {Component,lazy,Suspense} from 'react';
import type {ReactNode,ComponentProps} from 'react';
import type {Chart as ChartType} from '../Chart';

const LazyChart=lazy(()=>import('../Chart').then(module=>({default:module.Chart})));

class ChartBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  return this.state.failed?<div className="plot-empty" role="alert">그래프를 표시하지 못했습니다. <button onClick={()=>this.setState({failed:false})}>다시 그리기</button></div>:this.props.children;
 }
}

export function ChartFrame(props:ComponentProps<typeof ChartType>){
 return <ChartBoundary><Suspense fallback={<div className="plot-empty">그래프 준비 중</div>}><LazyChart {...props}/></Suspense></ChartBoundary>;
}
