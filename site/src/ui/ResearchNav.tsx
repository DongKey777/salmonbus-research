import './research-nav.css';
import {useEffect,useRef} from 'react';
import {Activity,Database,GitBranch,Lock,Repeat,Route} from 'lucide-react';
import {PUBLIC_SITE} from '../site/env.ts';
import {RESEARCH_SECTIONS} from './sections.ts';
import type {ResearchSection} from './sections.ts';

export type {ResearchSection};
const ICONS={autoloop:Repeat,'route-map':Route,'actual-cycles':Activity,real:Database,history:GitBranch,preparation:Database} as const;

export function ResearchNav({active}:{active:ResearchSection}){
 const nav=useRef<HTMLElement>(null);
 // On narrow screens the row scrolls sideways; keep the current section visible without moving the page.
 useEffect(()=>{const el=nav.current,current=el?.querySelector<HTMLElement>('a.current');if(el&&current&&el.scrollWidth>el.clientWidth)el.scrollLeft=current.offsetLeft-el.offsetLeft-12;},[active]);
 return <nav ref={nav} className="research-nav" aria-label="주 화면">{RESEARCH_SECTIONS.map(({id,label,href,localOnly})=>{const Icon=ICONS[id];return(
  <a key={id} href={href} className={id===active?'current':''} aria-current={id===active?'page':undefined}>
   <Icon size={14} aria-hidden="true"/>{label}{PUBLIC_SITE&&localOnly&&<><Lock size={11} className="research-nav-lock" aria-hidden="true"/><span className="sr-only">(로컬 전용)</span></>}
  </a>);})}</nav>;
}
