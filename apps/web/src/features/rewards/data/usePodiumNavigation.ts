import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/lib/auth';
import {apiRequest} from '@/lib/api';
import {publicEnv} from '@/lib/public-env';
import {decodeRewardOwnedClubs} from '../model/clubTreasuries';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';

/** Navigation follows current account facts, never the URL or a login name.
 * Club ownership is checked by the existing private, read-only endpoint.
 * These links do not replace the destination's authorization checks. */
export function usePodiumNavigation(){
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session);
 const account=auth.user&&auth.account?.userId===auth.user.id?auth.account:null;
 const admin=account?.platformRole==='super_admin';
 const reviewer=account?.hasOrganizerAccess===true;
 const chainId=publicEnv.rewardDemo?.mode==='local'?31337:10143;
 const clubs=useQuery({queryKey:['podium-navigation-clubs',account?.userId,epoch],
  enabled:!!account&&!!auth.session&&!admin&&!reviewer,staleTime:30_000,retry:false,
  queryFn:async()=>{
   try{return decodeRewardOwnedClubs(await apiRequest<unknown>({path:'/v1/athlete/rewards/owned-clubs',accessToken:auth.session?.access_token,cache:'no-store'}),chainId,null);}
   catch(error){
    // This exact response is a verified absence of club ownership. Authentication,
    // transport and other permission failures must still withhold private links.
    if(error&&typeof error==='object'&&'status' in error&&error.status===403&&'code' in error&&error.code==='reward_club_owner_required')return {items:[],nextCursor:null};
    throw error;
   }
  },
 });
 const role=!account?null:admin?'admin':reviewer?'reviewer':!auth.session?null:clubs.isSuccess?(clubs.data.items.length?'club':account.hasAthleteAccess?'athlete':'sponsor'):null;
 const destinations={admin:'/rewards/admin/wallets',reviewer:'/rewards/review',club:'/club/rewards',athlete:'/athlete/rewards',sponsor:'/rewards/manage'};
 return {account,role,href:role?destinations[role]:null,error:!!account&&!admin&&!reviewer&&clubs.isError,retry:clubs.refetch};
}
