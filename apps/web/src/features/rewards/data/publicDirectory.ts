import {useIsFetching,useQuery} from '@tanstack/react-query';
import {decodePublicDirectory,mergePublicDirectory,publicDirectoryIsFresh,PUBLIC_DIRECTORY_FRESH_MS,type PublicDirectory} from '@raceson/domain/rewards/public-directory';
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
/** Private consumers keep the live-only contract. Browsing preloads shared public
 * summaries and polls them while a separate request owns full verification. */
export function usePublicDirectory(mode:'live'|'browse'|'published'='live'){
 const browseKey=['podium-browse-directory',publicEnv.rewardDemo?.chainId];
 const browsingRefresh=useIsFetching({queryKey:browseKey})>0;
 const snapshot=useQuery({queryKey:['podium-published-directory',publicEnv.rewardDemo?.chainId],enabled:mode!=='live',
  queryFn:({signal})=>readPublicDirectory(signal,true),staleTime:30000,retry:false,
  structuralSharing:(previous,next)=>mergePublicDirectory(next as PublicDirectory,previous as PublicDirectory|undefined),
  refetchInterval:mode==='browse'?(browsingRefresh?4000:PUBLIC_DIRECTORY_FRESH_MS):false});
 const live=useQuery({queryKey:mode==='browse'?browseKey:['podium-public-directory',publicEnv.rewardDemo?.chainId],
  enabled:mode==='live'||mode==='browse'&&!snapshot.isPending&&!publicDirectoryIsFresh(snapshot.data),
  queryFn:({signal})=>readPublicDirectory(signal,false,mode==='browse'?95000:90000),staleTime:30000,retry:false,
  structuralSharing:mode==='browse'?(previous,next)=>mergePublicDirectory(next as PublicDirectory,previous as PublicDirectory|undefined):undefined,
  refetchInterval:query=>query.state.status!=='error'&&query.state.data?.refreshStatus==='refreshing'?2000:mode==='browse'?PUBLIC_DIRECTORY_FRESH_MS:false});
 if(mode==='live')return live;
 if(mode==='published')return snapshot;
 // Membership comes from the latest publication; merge each campaign separately
 // so a partial update survives an older full response or a failed refresh.
 const data=snapshot.data?{...mergePublicDirectory(snapshot.data,live.data),refreshStatus:live.data?.refreshStatus??snapshot.data.refreshStatus}:live.data;
 return {...live,data,isPending:!data&&(snapshot.isPending||live.isPending),
  isError:live.isError&&(!data?snapshot.isError:true),isFetching:snapshot.isFetching||live.isFetching,
  refetch:()=>{void snapshot.refetch();return live.refetch();}};
}
