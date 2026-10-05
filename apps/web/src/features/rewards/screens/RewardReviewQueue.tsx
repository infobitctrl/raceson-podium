import {Link} from 'react-router-dom';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import {usePublicDirectory} from '../data/publicDirectory';
import {campaignStatus} from '@raceson/domain/rewards/public-directory';
import {statusLabel} from '../model/podiumDirectory';
import {setupAmount} from '../model/setupAmount';
import {CampaignSponsor,CampaignSponsorProvider} from '../components/CampaignSponsor';
import p from '../components/Podium.module.css';
import s from './RewardReviewQueue.module.css';
function Queue(){
 const {locale}=useI18n(),hr=locale==='hr',{data,isPending,isError,refetch}=usePublicDirectory();
 if(isPending)return <p role="status">{hr?'Učitavanje kampanja…':'Loading campaigns…'}</p>;
 if(isError||!data)return <section className={p.empty}><p role="alert">{hr?'Red za pregled nije dostupan. Osvježite za trenutne kampanje.':'The review queue is unavailable. Refresh to load current campaigns.'}</p><button className={p.secondary} onClick={()=>void refetch()}>{hr?'Pokušaj ponovno':'Retry'}</button></section>;
 const campaigns=data.items.filter(item=>!['finished','cancelled'].includes(campaignStatus(item)));
 return <CampaignSponsorProvider><div className={s.queue}>{campaigns.map(item=><div key={item.campaign.id} className={s.row}><div><Link className={s.title} to={`/rewards/manage/campaigns/${item.campaign.id}${item.campaign.pots[0]?`?pot=${item.campaign.pots[0].slot}`:""}`}>{item.campaign.name}</Link><CampaignSponsor id={item.campaign.id} hr={hr} compact/></div><strong>{setupAmount(BigInt(item.campaign.budgetWei),hr)} <small>test MON</small></strong><span className={p.badge} data-state={campaignStatus(item)}>{statusLabel(item,hr)}</span></div>)}{!campaigns.length?<p className={p.empty}>{hr?'Nema objavljenih kampanja za pregled.':'No published campaigns are available for review.'}</p>:null}</div></CampaignSponsorProvider>;
}
export default function RewardReviewQueue(){
 const auth=useAuth(),{locale}=useI18n(),hr=locale==='hr';
 const allowed=!!auth.user&&auth.account?.userId===auth.user.id&&(auth.account?.hasOrganizerAccess||auth.account?.platformRole==='super_admin');
 return <article className={`${p.page} ${p.workspace}`}><header className={p.heading}><div><span className={p.eyebrow}>{hr?'Pregled':'Review'}</span><h1>{hr?'Red za pregled nagrada':'Award review queue'}</h1><p>{hr?'Pregledajte službene rezultate i točne iznose nagrada.':'Review official results and exact award allocations.'}</p></div>{allowed?<a className={p.secondary} href="/rewards/control">{hr?'Otvori kontrolu':'Open controller workspace'}</a>:null}</header>{auth.isLoading?<p role="status">{hr?'Provjera pristupa…':'Checking access…'}</p>:allowed?<Queue/>:<section className={p.empty}><p role="alert">{hr?'Potreban je račun tima za rezultate ili glavnog administratora.':'A results-team or master-administrator account is required.'}</p><Link className={p.primary} to="/auth?next=%2Frewards%2Freview">{hr?'Prijava':'Sign in'}</Link></section>}</article>;
}
