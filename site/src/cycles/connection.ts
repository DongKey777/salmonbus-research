import {useEffect,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {verifySnapshot,verifyExtension} from './contract.ts';
import type {Snapshot} from './contract.ts';
import {siteUrl} from '../site/env.ts';
export function useCycles(){
 const prior=useRef<Snapshot|null>(null),client=useQueryClient();
 const query=useQuery({queryKey:['five-cycle-monitor-v1'],queryFn:async({signal})=>{
  const c=new AbortController(),abort=()=>c.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,5000);
  try{
   const r=await fetch(siteUrl('api/v5/cycles/snapshot'),{cache:'no-store',signal:c.signal});if(!r.ok)throw Error(`CYCLE_HTTP_${r.status}`);
   const text=await r.text();if(text.length>4*1024*1024)throw Error('CYCLE_RESPONSE_LIMIT');
   const current=verifySnapshot(JSON.parse(text));if(prior.current)verifyExtension(prior.current,current);prior.current=current;return current;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 },retry:false,refetchInterval:2000,refetchIntervalInBackground:false,refetchOnWindowFocus:false});
 const generation=query.data?.generationId;
 useEffect(()=>{
  if(!generation)return;
  const source=new EventSource(siteUrl('api/v5/cycles/events?')+new URLSearchParams({after:String(prior.current?.cursor??0),generationId:generation}));
  const refresh=()=>void client.invalidateQueries({queryKey:['five-cycle-monitor-v1']});
  source.addEventListener('five-cycle.event.v1',refresh);source.onerror=refresh;
  return()=>{source.removeEventListener('five-cycle.event.v1',refresh);source.close();};
 },[generation,client]);
 return query;
}
