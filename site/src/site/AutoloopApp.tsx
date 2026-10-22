import {AutoloopPanel} from '../autoloop/AutoloopPanel';
import {SiteTopbar} from './SiteChrome';
import {PUBLIC_SITE,siteUrl} from './env.ts';
import '../full-learning-batch/full-learning-batch.css';
import '../actualcycles/actualcycles.css';

const STEPS=[
 ['운행 점검','정지 조건과 예산을 먼저 봅니다.'],
 ['실험 설계','플래너가 장부를 읽고 다음 실험을 정합니다.'],
 ['GPU 실행','사전 시험을 통과한 꾸러미만 Pod에서 돕니다.'],
 ['판정·게시','DEV-S에서 판정하고 결과를 이 화면에 남깁니다.'],
] as const;

/** Landing view for the autonomous loop: route sign, the four legs of one round, then the live (or saved) panel. */
export default function AutoloopApp(){
 return <div className="actual-app autoloop-app">
  <a className="skip" href="#autoloop-workbench">자율 루프 현황으로 이동</a>
  <SiteTopbar active="autoloop"/>
  <main id="autoloop-workbench" className="autoloop-view">
   <section className="autoloop-sign" aria-labelledby="autoloop-title">
    <div className="autoloop-sign-no" aria-hidden="true">순환</div>
    <div className="autoloop-sign-name">
     <p>AUTONOMOUS IMPROVEMENT LOOP</p>
     <h1 id="autoloop-title">좌석 예보 자율 개선 루프</h1>
     <span>실험은 플래너가 정하고, 사람은 정책(목표·금지·예산·정지 조건)만 정합니다.{PUBLIC_SITE?' 이 페이지는 배포 시점의 사본입니다.':''}</span>
    </div>
    <a className="autoloop-sign-map" href={siteUrl('autoloop-route.html')}>노선도 보기<span aria-hidden="true"> →</span></a>
   </section>
   <ol className="autoloop-legs" aria-label="한 바퀴의 순서">{STEPS.map(([name,what],i)=><li key={name}><b>{String(i+1).padStart(2,'0')}</b><strong>{name}</strong><small>{what}</small></li>)}</ol>
   <AutoloopPanel/>
  </main>
 </div>;
}
