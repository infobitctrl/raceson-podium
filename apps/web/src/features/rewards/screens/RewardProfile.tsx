import {Link} from 'react-router-dom';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import s from '../components/Podium.module.css';

/** Personal account information is available to every Podium role.
 * Sporting profile editing retains its existing athlete access boundary. */
export default function RewardProfile(){
 const auth=useAuth(),{locale}=useI18n(),hr=locale==='hr';
 const account=auth.user&&auth.account?.userId===auth.user.id?auth.account:null;
 const t=(en:string,local:string)=>hr?local:en;
 return <article className={s.page}><header className={s.heading}><h1>{t('Profile','Profil')}</h1></header>
  {auth.isLoading?<p role="status">{t('Loading account…','Učitavanje računa…')}</p>:!account?<section className={s.panel}><p>{t('Sign in to view your profile.','Prijavite se za pregled profila.')}</p><Link className={s.primary} to="/auth?next=%2Frewards%2Fprofile">{t('Sign in','Prijava')}</Link></section>:<section className={s.panel}>
   <h2>{account.displayName}</h2><dl className={s.profileDetails}>
    <div><dt>{t('Username','Korisničko ime')}</dt><dd>{account.loginUsername??'—'}</dd></div>
    <div><dt>{t('Email','E-pošta')}</dt><dd>{account.email??'—'}</dd></div>
    <div><dt>{t('Email status','Status e-pošte')}</dt><dd>{account.emailVerified?t('Verified','Potvrđena'):t('Not verified','Nije potvrđena')}</dd></div>
   </dl>{account.hasAthleteAccess?<Link className={s.secondary} to="/athlete/account">{t('Edit athlete profile','Uredi sportski profil')}</Link>:null}
  </section>}
 </article>;
}
