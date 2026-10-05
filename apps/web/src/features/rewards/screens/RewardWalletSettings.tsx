import {Link} from 'react-router-dom';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import SponsorWallet from '../components/SponsorWallet';
import d from '../components/SponsorDashboard.module.css';
import s from '../components/SponsorLaunch.module.css';

/** A personal wallet belongs to the authenticated user, not to a workspace role.
 * Creation never assigns an operator, treasury or campaign funding authority. */
export default function RewardWalletSettings(){
 const auth=useAuth(),{locale}=useI18n(),hr=locale==='hr',epoch=useRewardSessionEpoch(auth.session);
 const t=(en:string,local:string)=>hr?local:en;
 const signedIn=!!auth.user&&!!auth.session&&auth.account?.userId===auth.user.id;
 return <article className={d.page}>
  <header className={d.header}><div><span className={d.eyebrow}>{t('Your account','Vaš račun')}</span><h1>{t('Your reward wallet','Vaš novčanik za nagrade')}</h1></div></header>
  {auth.isLoading?<p role="status">{t('Loading account…','Učitavanje računa…')}</p>:!signedIn?<section className={d.card}><p>{t('Sign in to create or reconnect your personal Privy wallet.','Prijavite se za kreiranje ili ponovno povezivanje osobnog Privy novčanika.')}</p><Link className={s.primary} to="/auth?next=%2Frewards%2Fwallet">{t('Sign in','Prijava')}</Link></section>:<>
   <section className={d.card}><p>{t('Use the same RacesOn account to recover this wallet on another device. Wallet creation is your choice.','Koristite isti RacesOn račun za pristup ovom novčaniku na drugom uređaju. Vi birate želite li kreirati novčanik.')}</p><SponsorWallet key={`${auth.user!.id}:${epoch}`} chainId={10143} hr={hr} purpose="recipient" showBalance/></section>
   <p className={d.intro}>{t('A personal wallet does not grant a new role or change the wallet assigned to an existing contract.','Osobni novčanik ne dodjeljuje novu ulogu niti mijenja novčanik postojećeg ugovora.')}</p>
  </>}
 </article>;
}
