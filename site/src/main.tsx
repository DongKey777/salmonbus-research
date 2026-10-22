import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MetricPresentationProvider} from './metrics/MetricPresentation';
const ActualCyclesApp=React.lazy(()=>import('./actualcycles/ActualCyclesApp'));
const RealApp=React.lazy(()=>import('./real/RealApp'));
const HistoryApp=React.lazy(()=>import('./history/HistoryApp'));
const PreparationApp=React.lazy(()=>import('./preparation/PreparationApp'));
const AutoloopApp=React.lazy(()=>import('./site/AutoloopApp'));
import {PUBLIC_SITE} from './site/env.ts';
import {LocalOnlyView,PublicNotice} from './site/SiteChrome';
const params=new URLSearchParams(location.search);
const view=params.get('view')??'actual-cycles';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import './site/site.css';
const client:QueryClient=import.meta.hot?.data.queryClient??new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
const root:ReturnType<typeof createRoot>=import.meta.hot?.data.reactRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot){
 import.meta.hot.data.reactRoot=root;
 import.meta.hot.data.queryClient=client;
 import.meta.hot.accept();
 import.meta.hot.prune(()=>root.unmount());
}
const historyLocalOnly=<LocalOnlyView active="history" title="전체 연구 이력" reason="전체 이력은 로컬 이력 서버가 시도·모델·구간을 그때그때 조회해 보여 주는 화면이라 정적 사본으로 옮기지 않았습니다."/>;
root.render(<React.StrictMode><QueryClientProvider client={client}><MetricPresentationProvider><PublicNotice/>{view==='autoloop'?<React.Suspense fallback={<div className="plot-empty">자율 루프 현황을 준비합니다.</div>}><AutoloopApp/></React.Suspense>:view==='history'&&PUBLIC_SITE?historyLocalOnly:view==='real'?<React.Suspense fallback={<div className="plot-empty">실제 관측 평가를 준비합니다.</div>}><RealApp/></React.Suspense>:view==='history'?<React.Suspense fallback={<div className="plot-empty">전체 연구 이력을 준비합니다.</div>}><HistoryApp/></React.Suspense>:view==='preparation'?<React.Suspense fallback={<div className="plot-empty">자료 검증을 준비합니다.</div>}><PreparationApp/></React.Suspense>:<React.Suspense fallback={<div className="plot-empty">실자료 반복 연구를 준비합니다.</div>}><ActualCyclesApp/></React.Suspense>}</MetricPresentationProvider></QueryClientProvider></React.StrictMode>);
