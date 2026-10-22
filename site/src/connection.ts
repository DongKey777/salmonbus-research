import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {verifySnapshot} from './domain';
import type {Mode, MonitorSnapshot} from './domain';
import {siteUrl} from './site/env.ts';
export type ConnectionState='archive'|'connecting'|'connected'|'reconnecting'|'offline';
export function useMonitor(mode:Mode){
 const [online,setOnline]=useState(navigator.onLine);
 useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
 const qc=useQueryClient();const [connection,setConnection]=useState<ConnectionState>('archive');const [reconnect,setReconnect]=useState(0);const high=useRef(0);const retry=useRef(0);
 const query=useQuery<MonitorSnapshot>({queryKey:['monitor',mode],queryFn:async({signal})=>{const r=await fetch(siteUrl(mode==='live'?'api/v1/monitor/snapshot':'archive.json'),{signal,cache:'no-store'});if(!r.ok)throw new Error(`SNAPSHOT_HTTP_${r.status}`);return verifySnapshot(await r.json());},retry:false,refetchOnWindowFocus:false,staleTime:Infinity});
 const generation=query.data?.generationId;
 useEffect(()=>{
  if(mode==='archive'){setConnection('archive');return;}
  if(!online){setConnection('offline');return;}
  if(query.error?.message==='MONITOR_CONTRACT_MISMATCH'){setConnection('offline');return;}
  let closed=false,stream:EventSource|undefined,timer:ReturnType<typeof setTimeout>|undefined,flush:ReturnType<typeof setTimeout>|undefined;
  const scheduleReconnect=()=>{if(closed)return;stream?.close();setConnection(query.data?'reconnecting':'offline');clearTimeout(timer);const ms=Math.min(15000,1000*2**Math.min(retry.current++,4));timer=setTimeout(async()=>{try{await qc.fetchQuery({queryKey:['monitor',mode],staleTime:0});}catch{}if(!closed)setReconnect(v=>v+1);},ms);};
  if(!query.data){if(query.isError)scheduleReconnect();else setConnection('connecting');return()=>{closed=true;clearTimeout(timer);};}
  const current=query.data;high.current=current.cursor;setConnection('connecting');
  stream=new EventSource(siteUrl(`api/v1/monitor/events?after=${current.cursor}&generationId=${encodeURIComponent(current.generationId)}`));
  stream.onopen=()=>{if(!closed){setConnection('connected');retry.current=0;}};
  stream.addEventListener('research.event',(event)=>{if(closed)return;try{const e=JSON.parse((event as MessageEvent).data);if(!Number.isSafeInteger(e.serverSeq)||e.serverSeq<1||e.serverSeq>138||!['SOURCE_REGISTERED','SOURCE_EVENT','CANDIDATE_REPORT','REPLAY_COMPLETED'].includes(e.type)||String(e.serverSeq)!==(event as MessageEvent).lastEventId)throw Error('EVENT_ID');if(e.serverSeq<=high.current)return;high.current=e.serverSeq;if(!flush)flush=setTimeout(()=>{flush=undefined;void qc.invalidateQueries({queryKey:['monitor','live']});},160);}catch{scheduleReconnect();}});
  stream.onerror=scheduleReconnect;
  return()=>{closed=true;stream?.close();clearTimeout(timer);clearTimeout(flush);};
 // Cursor advances do not tear down a healthy stream. A new generation starts a new one.
 },[mode,generation,reconnect,query.isError,online]);
 return {...query,connection,reconnect:()=>{retry.current=0;void query.refetch().then(()=>setReconnect(v=>v+1));}};
}
