import {Link} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
import {useI18n} from '@/shared/i18n/I18nContext';
import {usePublicDirectory} from '../data/publicDirectory';
import PodiumDirectoryStatus from '../components/PodiumDirectoryStatus';
import PodiumCampaigns from '../components/PodiumCampaigns';
import {DirectoryNotice} from './PodiumHome';
import s from '../components/Podium.module.css';
import d from '../components/CampaignDirectory.module.css';
export default function PodiumCampaignDirectory(){
 const {locale}=useI18n(),hr=locale==='hr',q=usePublicDirectory();
 return <article className={s.page}>
  <header className={`${s.heading} ${d.heading}`}>
   <div><span className={s.eyebrow} translate="no">RacesOn Podium</span><h1>{hr?'Kampanje':'Campaigns'}</h1>
    <p>{hr?'Otkrijte nagrade koje financiraju sponzori i pratite put od fonda nagrada do potvrđenih isplata.':'Discover sponsor-funded rewards and follow the journey from prize pool to confirmed payouts.'}</p>
   </div>
   <Link className={s.primary} to="/rewards/events">{hr?'Sponzoriraj događaj':'Sponsor an event'}<ArrowRight size={18}/></Link>
  </header>
  {q.data?<>
   <PodiumCampaigns items={q.data.items} directory/>
   <div className={d.verification}><PodiumDirectoryStatus data={q.data} fetching={q.isFetching} error={q.isError} onRefresh={()=>void q.refetch()}/></div>
   <details className={`${s.history} ${d.about}`}><summary>{hr?'O kampanjama':'About campaigns'}</summary><p className={s.muted}>{hr?'Nacrti su privatni. Završene kampanje imaju zatvorene i podmirene fondove.':'Drafts remain private. Finished campaigns have closed and settled prize pots.'}</p></details>
  </>:<DirectoryNotice loading={q.isPending} error={q.isError} retry={()=>void q.refetch()}/>}
 </article>;
}
