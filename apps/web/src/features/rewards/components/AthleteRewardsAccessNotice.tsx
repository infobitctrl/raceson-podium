import RewardAccountSwitch from './RewardAccountSwitch';
import {Link} from 'react-router-dom';
import {useI18n} from '@/shared/i18n/I18nContext';
import s from './Podium.module.css';

/** ProtectedWorkspace guards athlete access; recovery uses normal account sign-in. */
export default function AthleteRewardsAccessNotice(){
 const {locale}=useI18n(),hr=locale==='hr',t=(en:string,local:string)=>hr?local:en;
 return <article className={`${s.page} ${s.workspace}`}>
  <header className={s.heading}><div><span className={s.eyebrow} translate="no">RacesOn Podium</span><h1>{t('My rewards','Moje nagrade')}</h1></div><Link className={s.secondary} to="/rewards/campaigns">{t('Explore campaigns','Istraži kampanje')}</Link></header>
  <section className={s.empty} aria-labelledby="athlete-access-title"><span className={s.badge}>{t('Athlete access required','Potreban pristup sportaša')}</span><h2 id="athlete-access-title">{t('Use your athlete account to view rewards','Za pregled nagrada koristite račun sportaša')}</h2><p>{t('Sign in with the RacesOn athlete account linked to your race results.','Prijavite se RacesOn računom sportaša povezanim s vašim rezultatima.')}</p><RewardAccountSwitch hr={hr} label={t("Sign in with your athlete account","Prijavite se računom sportaša")}/></section>
 </article>;
}
