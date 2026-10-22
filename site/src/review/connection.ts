import {useQuery} from '@tanstack/react-query';
import {REVIEW_CATALOG} from './catalog';
import {verifyReview} from './contract';
import {siteUrl} from '../site/env.ts';
export function useSavedReview(enabled:boolean){
  return useQuery({queryKey:['saved-controller-review',REVIEW_CATALOG.sha256],enabled,staleTime:Infinity,retry:false,queryFn:async({signal})=>{
    const response=await fetch(siteUrl(REVIEW_CATALOG.url),{signal,cache:'no-store'});
    if(!response.ok)throw Error('SAVED_REVIEW_UNAVAILABLE');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==REVIEW_CATALOG.bytes)throw Error('SAVED_REVIEW_BYTES_CHANGED');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==REVIEW_CATALOG.sha256)throw Error('SAVED_REVIEW_PIN_MISMATCH');
    return verifyReview(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }});
}
