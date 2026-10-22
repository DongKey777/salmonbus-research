import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {verifyV2} from './observer-contract';
import type {V2Snapshot} from './observer-contract';
import type {ConnectionState} from './connection';
import {siteUrl} from './site/env.ts';

export function useObserver(){
 const [online,setOnline]=useState(navigator.onLine),[state,setState]=useState<ConnectionState>('connecting'),[revision,setRevision]=useState(0);
 const latest=useRef<V2Snapshot|null>(null),tries=useRef(0),high=useRef(0);const qc=useQueryClient();
 useEffect(()=>{const yes=()=>setOnline(true),no=()=>setOnline(false);window.addEventListener('online',yes);window.addEventListener('offline',no);return()=>{window.removeEventListener('online',yes);window.removeEventListener('offline',no);};},[]);
 const query=useQuery({queryKey:['observer-v2'],queryFn:async({signal})=>{
  const response=await fetch(siteUrl('api/v2/monitor/snapshot'),{signal,cache:'no-store'});if(!response.ok)throw Error(`OBSERVER_HTTP_${response.status}`);
  const next=verifyV2(await response.json());if(latest.current?.generationId===next.generationId&&next.cursor<latest.current.cursor)throw Error('OBSERVER_CURSOR_ROLLBACK');latest.current=next;return next;
 },staleTime:Infinity,retry:false,refetchOnWindowFocus:false});
 const generation=query.data?.generationId;
 useEffect(()=>{
  if(!online){setState('offline');return;}
  if(query.error?.message==='OBSERVER_CONTRACT_MISMATCH'||query.error?.message==='OBSERVER_CURSOR_ROLLBACK'){setState('offline');return;}
  let closed=false,stream:EventSource|undefined,retry:ReturnType<typeof setTimeout>|undefined,flush:ReturnType<typeof setTimeout>|undefined;
  const reconnect=()=>{if(closed)return;stream?.close();setState(query.data?'reconnecting':'offline');clearTimeout(retry);retry=setTimeout(async()=>{try{await qc.fetchQuery({queryKey:['observer-v2'],staleTime:0});}catch{}if(!closed)setRevision(v=>v+1);},Math.min(15000,1000*2**Math.min(tries.current++,4)));};
  if(!query.data){if(query.isError)reconnect();else setState('connecting');return()=>{closed=true;clearTimeout(retry);};}
  high.current=query.data.cursor;setState('connecting');stream=new EventSource(siteUrl(`api/v2/monitor/events?after=${query.data.cursor}&generationId=${encodeURIComponent(query.data.generationId)}`));
  stream.onopen=()=>{if(!closed){setState('connected');tries.current=0;}};
  stream.addEventListener('research.event.v2',event=>{if(closed)return;try{
   const e=JSON.parse((event as MessageEvent).data);if(e.type!=='JOURNAL_COMMITTED'||!Number.isSafeInteger(e.serverSeq)||e.serverSeq<1||String(e.serverSeq)!==(event as MessageEvent).lastEventId||typeof e.runId!=='string'||!/^[0-9a-f]{64}$/.test(e.sourceId))throw Error('STREAM_CONTRACT');
   if(e.serverSeq<=high.current)return;high.current=e.serverSeq;if(!flush)flush=setTimeout(()=>{flush=undefined;void qc.invalidateQueries({queryKey:['observer-v2']});},160);
  }catch{reconnect();}});stream.onerror=reconnect;
  return()=>{closed=true;stream?.close();clearTimeout(retry);clearTimeout(flush);};
 },[generation,online,revision,query.isError]);
 return {...query,connection:state,reconnect:()=>{tries.current=0;void query.refetch().then(()=>setRevision(v=>v+1));}};
}
