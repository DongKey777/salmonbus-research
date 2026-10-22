import {useRef} from 'react';
import {useQuery} from '@tanstack/react-query';
import {verifyExtension,verifyRuntime} from './contract';
import type {RuntimeSnapshot} from './contract';
import {projectRuntime} from './project';
import {siteUrl} from '../site/env.ts';

export function useRuntime(){
 const accepted=useRef<RuntimeSnapshot|null>(null);
 return useQuery({queryKey:['runtime-monitor-v4'],queryFn:async({signal})=>{
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,5000);
  try{
   const response=await fetch(siteUrl('api/v4/runtime/snapshot'),{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error(`RUNTIME_HTTP_${response.status}`);
   const body=await response.text();if(body.length>2*1024*1024)throw Error('RUNTIME_RESPONSE_LIMIT');
   const wire=verifyRuntime(JSON.parse(body));if(accepted.current)verifyExtension(accepted.current,wire);
   accepted.current=wire;return {view:projectRuntime(wire),observedAt:performance.now()};
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
 },retry:false,refetchInterval:1000,refetchIntervalInBackground:false,refetchOnWindowFocus:false});
}
