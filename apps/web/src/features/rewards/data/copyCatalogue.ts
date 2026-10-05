import {useQuery} from '@tanstack/react-query';
import {decodeCopyCatalogue} from '@raceson/domain/rewards/copy-catalogue';
import {publicEnv,assertPublicEnvironmentOrigin} from '@/lib/public-env';
import {buildSponsorCatalogue,sponsorCatalogue,sponsorLeague} from '../model/sponsorCatalogue';

export function useSponsorCatalogue(){
 const query=useQuery({queryKey:['podium-copy-catalogue'],enabled:publicEnv.hostedCopy===true,staleTime:30000,retry:false,queryFn:async({signal})=>{
  assertPublicEnvironmentOrigin();
  const response=await fetch(`${publicEnv.apiBaseUrl}/v1/rewards/demo-copy/catalogue`,{signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response.ok)throw Error('copy_catalogue_unavailable');
  return decodeCopyCatalogue((await response.json()).data);
 }});
 const copy=publicEnv.hostedCopy?query.data:undefined;
 return {copy,items:publicEnv.hostedCopy?(copy?buildSponsorCatalogue(copy):[]):sponsorCatalogue,
  league:copy?{...sponsorLeague,id:copy.sourceLeagueId,name:copy.name,categories:copy.categories,roundCount:copy.rounds.length,trackCount:copy.rounds.reduce((n,r)=>n+r.tracks.length,0)}:sponsorLeague,
  loading:publicEnv.hostedCopy&&query.isPending,error:publicEnv.hostedCopy&&query.isError,retry:query.refetch};
}
