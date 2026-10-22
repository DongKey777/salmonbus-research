import {Lock} from 'lucide-react';
import {ResearchNav} from '../ui/ResearchNav';
import type {ResearchSection} from '../ui/ResearchNav';
import {PUBLIC_SITE,siteUrl,viewUrl} from './env.ts';

/** Same header as the research views, with the mark telling local and public copies apart. */
export function SiteTopbar({active}:{active:ResearchSection}){
 return <header className="topbar"><div className="wordmark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14h4l3-8 4 13 3-8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active={active}/><SiteMark/></header>;
}

export function SiteMark(){
 return <span className="actual-local site-mark">{PUBLIC_SITE?'PUBLIC SNAPSHOT':'LOCAL RESEARCH'}</span>;
}

/** Shown above every view of the public build: the page is a saved copy, not a live monitor. */
export function PublicNotice(){
 if(!PUBLIC_SITE)return null;
 return <div className="public-notice" role="note"><b>공개 사본</b><span className="long">배포할 때 저장한 정적 자료입니다. 실시간 연결과 실행 조작은 없고, 로컬 서버가 필요한 화면은 로컬 전용으로 표시합니다.</span><span className="short">배포 시점의 정적 자료입니다. 실시간 연결은 없습니다.</span><a className="public-notice-link" href={siteUrl('THIRD-PARTY-LICENSES.txt')}>오픈소스 라이선스</a></div>;
}

/** Replaces a view whose data only exists behind the local API servers. */
export function LocalOnlyView({active,title,reason}:{active:ResearchSection;title:string;reason:string}){
 return <div className="actual-app local-only-app">
  <a className="skip" href="#local-only">안내로 이동</a>
  <SiteTopbar active={active}/>
  <main id="local-only" className="local-only">
   <Lock size={28} aria-hidden="true"/>
   <p className="local-only-kicker">LOCAL ONLY</p>
   <h1>{title} · 로컬 전용</h1>
   <p>{reason}</p>
   <p>공개 사본에는 이 화면의 자료를 싣지 않았습니다. 연구 환경에서 로컬 서버를 켜고 같은 주소(<code>?view={active}</code>)로 열면 볼 수 있습니다.</p>
   <a className="local-only-back" href={viewUrl('autoloop')}>자율 루프 현황으로 가기</a>
  </main>
 </div>;
}
