import {useQuery} from '@tanstack/react-query';
import {decodePublicDirectory} from '@raceson/domain/rewards/public-directory';
import {assertPublicEnvironmentOrigin,publicEnv} from '@/lib/public-env';
export async function readPublicDirectory(signal?:AbortSignal){
 assertPublicEnvironmentOrigin();const demo=publicEnv.rewardDemo;if(!demo)throw Error('demo_required');
 const signals=[AbortSignal.timeout(90000),...(signal?[signal]:[])];
 const response=await fetch(`${demo.apiBaseUrl}/v1/rewards/public-campaigns`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any(signals),headers:{Accept:'application/json'}});
 if(!response.ok)throw Error('directory_unavailable');
 const value=decodePublicDirectory((await response.json()).data);
 if(value.chainId!==demo.chainId)throw Error('directory_chain_mismatch');return value;
}
export function usePublicDirectory(){return useQuery({queryKey:['podium-public-directory',publicEnv.rewardDemo?.chainId],queryFn:({signal})=>readPublicDirectory(signal),staleTime:30000,retry:false,refetchInterval:query=>query.state.status!=='error'&&query.state.data?.refreshStatus==='refreshing'?2000:false});}
