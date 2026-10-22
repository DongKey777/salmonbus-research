import {useQuery} from '@tanstack/react-query';
import {verifyPreparation} from './contract';
import {projectPreparation} from './project';
import {PUBLIC_SITE,SNAPSHOT,siteUrl} from '../site/env.ts';

export function usePreparation(){
 const query=useQuery({queryKey:['preparation-monitor-v3'],queryFn:async({signal})=>{
  const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,5000);
  try{
   const response=await fetch(PUBLIC_SITE?siteUrl(SNAPSHOT.preparation):siteUrl('api/v3/preparation/snapshot'),{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error(`PREPARATION_HTTP_${response.status}`);
   const body=await response.text();if(body.length>262144)throw Error('PREPARATION_RESPONSE_LIMIT');
   return projectPreparation(verifyPreparation(JSON.parse(body)));
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 },retry:false,refetchInterval:PUBLIC_SITE?false:10000,refetchIntervalInBackground:false,refetchOnWindowFocus:false});
 return query;
}
