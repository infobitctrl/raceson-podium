import {useQuery} from '@tanstack/react-query';
import {decodePublicDirectory} from '@raceson/domain/rewards/public-directory';
import {assertPublicEnvironmentOrigin,publicEnv} from '@/lib/public-env';
export async function readPublicDirectory(signal?:AbortSignal,snapshot=false,timeoutMs=90000){
 assertPublicEnvironmentOrigin();const demo=publicEnv.rewardDemo;if(!demo)throw Error('demo_required');
 const signals=[AbortSignal.timeout(snapshot?15000:timeoutMs),...(signal?[signal]:[])];
 const response=await fetch(`${demo.apiBaseUrl}/v1/rewards/public-campaigns${snapshot?'/snapshot':''}`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any(signals),headers:{Accept:'application/json'}});
 if(!response.ok)throw Error('directory_unavailable');
 const value=decodePublicDirectory((await response.json()).data);
 if(snapshot&&value.refreshStatus!=='published')throw Error('directory_snapshot_required');
 if(value.chainId!==demo.chainId)throw Error('directory_chain_mismatch');return value;
}
/** Private consumers keep the live-only contract. Public browsing can render dated
 * publications while a separate request owns the bounded live verification. */
export function usePublicDirectory(mode:'live'|'browse'|'published'='live'){
 const snapshot=useQuery({queryKey:['podium-published-directory',publicEnv.rewardDemo?.chainId],enabled:mode!=='live',
  queryFn:({signal})=>readPublicDirectory(signal,true),staleTime:30000,retry:false});
 const live=useQuery({queryKey:['podium-public-directory',publicEnv.rewardDemo?.chainId],
  enabled:mode!=='published'&&(mode==='live'||!snapshot.isPending),
  queryFn:({signal})=>readPublicDirectory(signal,false,mode==='browse'?95000:90000),staleTime:30000,retry:false,
  refetchInterval:query=>query.state.status!=='error'&&query.state.data?.refreshStatus==='refreshing'?2000:false});
 if(mode==='live')return live;
 if(mode==='published')return snapshot;
 // A late or refetched publication must never overwrite a newer live observation.
 const data=live.data??snapshot.data;
 return {...live,data,isPending:!data&&(snapshot.isPending||live.isPending),
  isError:live.isError&&(!data?snapshot.isError:true),isFetching:snapshot.isFetching||live.isFetching,
  refetch:()=>{void snapshot.refetch();return live.refetch();}};
}
