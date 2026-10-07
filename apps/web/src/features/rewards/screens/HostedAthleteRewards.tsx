import {useState} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {getHostedAthleteAwards} from '../data/hostedAthleteAwards';
import {getOwnRewardDestinations} from '../data/athleteDestinations';
import AthleteProfileWallet from '../components/AthleteProfileWallet';
import SponsorClaims from '../components/SponsorClaims';
import RewardAccountSummary from '../components/RewardAccountSummary';
import p from '../components/Podium.module.css';
import a from '../components/AthleteRewards.module.css';

/** Exact copied-source awards only. The parent remounts for account/profile and
 * credential epochs; a failed private refresh retires every previous row. */
export default function HostedAthleteRewards({userId,profileId,viewKey,hr}:{userId:string;profileId:string|null;viewKey:string;hr:boolean}){
 const [accessError,setAccessError]=useState<unknown>(null);
 const awards=useInfiniteQuery({queryKey:['hosted-copy-athlete-awards',userId,viewKey,profileId],initialPageParam:null as string|null,
  queryFn:({pageParam})=>getHostedAthleteAwards(pageParam),getNextPageParam:page=>page.nextCursor??undefined,retry:false,staleTime:0,gcTime:0});
 const loaded=awards.data?.pages.flatMap(page=>page.items)??[];
 const needsDestinations=!loaded.length||loaded.some(award=>award.protocolVersion!==5);
 const destinations=useInfiniteQuery({queryKey:['athlete-reward-destinations',userId,viewKey],initialPageParam:null as string|null,
  queryFn:({pageParam})=>getOwnRewardDestinations(pageParam),enabled:awards.isSuccess&&needsDestinations,getNextPageParam:page=>page.nextCursor??undefined,retry:false,staleTime:0,gcTime:0});
 const failed=!!accessError||awards.isError||needsDestinations&&destinations.isError;
 const items=failed?[]:awards.data?.pages.flatMap(page=>page.items)??[];
 const choices=failed||!needsDestinations?[]:destinations.data?.pages.flatMap(page=>page.items)??[];
 const ready=!failed&&awards.isSuccess&&(!needsDestinations||destinations.isSuccess);
 const refreshing=awards.isFetching||needsDestinations&&destinations.isFetching;
 async function refresh(){
  const results=await Promise.all([awards.refetch(),...(needsDestinations?[destinations.refetch()]:[])]);
  if(results.every(r=>r.isSuccess))setAccessError(null);
  else throw Error('reward_private_refresh_failed');
 }
 const complete=ready&&!awards.hasNextPage;
 const paid=items.filter(a=>a.protocolVersion===5?a.directClaim?.paid:a.claims.some(c=>c.paid)).reduce((sum,a)=>sum+BigInt(a.amountWei),0n);
 const reviewable=items.filter(a=>!a.claims.some(c=>c.paid)&&a.claims.some(c=>c.prepared&&!c.consented)).reduce((sum,a)=>sum+BigInt(a.amountWei),0n);
 const total=items.reduce((sum,a)=>sum+BigInt(a.amountWei),0n);
 const t=(en:string,local:string)=>hr?local:en;
 return <div className={a.workspace}>
  {ready?<div className={a.summaryWrap}><RewardAccountSummary awards={items.map(a=>({entitlementId:a.entitlementId,amountWei:a.amountWei,chainId:10143 as const}))}
   claimReadiness={needsDestinations?{reviewable,waiting:total-paid-reviewable}:undefined} confirmedPaid={complete?paid:null} paymentsComplete={complete}
   complete={complete} hasMore={!!awards.hasNextPage} loading={awards.isFetching} onMore={()=>void awards.fetchNextPage()}/></div>:null}
  <div className={needsDestinations?p.recipientLayout:undefined}>{needsDestinations&&awards.data?<aside className={p.recipientReadiness} aria-label={t('Your reward wallet','Vaš novčanik za nagrade')}>
   <AthleteProfileWallet presentation="athlete" ready={ready&&!refreshing} failed={failed} profiles={profileId?[profileId]:[]} profileId={profileId} onProfile={()=>{}}
    destinations={choices} complete={ready&&!destinations.hasNextPage} refreshing={refreshing}
    onRefresh={()=>refresh().catch(()=>{})} onMore={()=>void destinations.fetchNextPage()}/>
  </aside>:null}<div className={`${p.recipientAwards} ${a.awardColumn}`}>
   {failed?<div role="alert"><p>{t('Your private rewards could not be verified. Refresh to recover the current status.','Vaše privatne nagrade nije moguće provjeriti. Osvježite za trenutno stanje.')}</p>
    <button type="button" disabled={refreshing} onClick={()=>void refresh().catch(()=>{})}>{t('Reload rewards and destinations','Ponovno učitaj nagrade i odredišta')}</button></div>
   :!ready?<p role="status">{t('Loading your rewards…','Učitavanje vaših nagrada…')}</p>
   :<SponsorClaims athletePresentation role="recipient" chainId={10143} hr={hr} shared={{awards:items,destinations:choices,destinationsComplete:!destinations.hasNextPage,refresh}} onAccessError={setAccessError}/>}
   {!failed&&awards.hasNextPage?<button type="button" disabled={awards.isFetching} onClick={()=>void awards.fetchNextPage()}>{t('Load more awards','Učitaj još nagrada')}</button>:null}
   {!failed&&needsDestinations&&destinations.hasNextPage?<button type="button" disabled={destinations.isFetching} onClick={()=>void destinations.fetchNextPage()}>{t('Load more wallet choices','Učitaj još izbora novčanika')}</button>:null}
  </div></div>
 </div>;
}
