import {useState} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {useAuth} from '@/lib/auth';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {getHostedClaimReviews,requestHostedClaimReview} from '../data/hostedClaimReviews';
import {ClaimDetail} from '../components/SponsorClaims';
import RewardClaimDialog from '../components/RewardClaimDialog';
import {setupAmount} from '../model/setupAmount';
import p from '../components/Podium.module.css';
function ReviewQueue({approvalId,hr,viewKey}:{approvalId:string;hr:boolean;viewKey:string}){
 const [selected,setSelected]=useState<string|null>(null),[accessError,setAccessError]=useState(false);
 const q=useInfiniteQuery({queryKey:['hosted-copy-claim-reviews',approvalId,viewKey],initialPageParam:null as string|null,
  queryFn:({pageParam})=>getHostedClaimReviews(approvalId,pageParam),getNextPageParam:page=>page.nextCursor??undefined,retry:false,staleTime:0,gcTime:0});
 const failed=q.isError||accessError,items=failed?[]:q.data?.pages.flatMap(page=>page.items)??[];
 const t=(en:string,local:string)=>hr?local:en;
 return <section className={p.panel} aria-label={t('Athlete verification','Provjera sportaša')}>
  <h3>{t('Athlete verification','Provjera sportaša')}</h3>
  <p>{t('Check each athlete’s eligibility and wallet ownership before their claim can proceed.','Provjerite uvjete za nagradu i vlasništvo novčanika svakog sportaša prije nastavka preuzimanja.')}</p>
  <button type="button" className={p.secondary} disabled={q.isFetching} onClick={()=>{setSelected(null);void q.refetch().then(r=>{if(r.isSuccess)setAccessError(false);});}}>{t('Refresh athlete requests','Osvježi zahtjeve sportaša')}</button>
  {failed?<p role="alert">{t('Private claim requests could not be verified. Refresh before continuing.','Privatne zahtjeve nije moguće provjeriti. Osvježite prije nastavka.')}</p>:q.isPending?<p role="status">{t('Loading requests…','Učitavanje zahtjeva…')}</p>:!items.length?<p>{t('No athlete requests yet. Requests appear when an athlete requests a claim from My rewards.','Još nema zahtjeva sportaša. Zahtjev se pojavljuje kada sportaš zatraži preuzimanje u Mojim nagradama.')}</p>:<ul>{items.map(item=><li key={item.id}>
   <strong>{setupAmount(BigInt(item.amountWei),hr)} test MON</strong> · <span style={{overflowWrap:'anywhere'}}>{item.address}</span>{' '}
   <button type="button" className={p.secondary} onClick={()=>setSelected(item.id)}>{item.paid?t('View payment','Pregledaj isplatu'):t('Review athlete request','Pregledaj zahtjev sportaša')}</button>
  </li>)}</ul>}
  {!failed&&q.hasNextPage?<button type="button" className={p.secondary} disabled={q.isFetching} onClick={()=>void q.fetchNextPage()}>{t('Load more requests','Učitaj još zahtjeva')}</button>:null}
  {selected&&!failed?<RewardClaimDialog hr={hr} onClose={()=>{setSelected(null);void q.refetch();}}>{onBusy=><ClaimDetail key={selected} id={selected} role="operator" chainId={10143} hr={hr}
   claimRequest={requestHostedClaimReview} reviewerOnly onBusy={onBusy} onAccessError={()=>{setSelected(null);setAccessError(true);}}/>}</RewardClaimDialog>:null}
 </section>;
}
export default function HostedClaimReviews({approvalId,hr}:{approvalId:string;hr:boolean}){
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session);
 if(!auth.user||!auth.session||auth.account?.userId!==auth.user.id)return null;
 const key=`${auth.user.id}:${epoch}:${approvalId}`;
 return <ReviewQueue key={key} viewKey={key} approvalId={approvalId} hr={hr}/>;
}
