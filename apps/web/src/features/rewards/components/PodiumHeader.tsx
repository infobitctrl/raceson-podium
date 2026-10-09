import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,useLocation} from 'react-router-dom';
import {ChevronDown,Menu,UserRound} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import {usePodiumNavigation} from '../data/usePodiumNavigation';
import s from './PodiumHeader.module.css';
import PodiumBrand from './PodiumBrand';
import DemoAccountSwitcher, {DemoAccountPhoneNavigation} from './DemoAccountSwitcher';
import {useDemoAccountSwitch} from '../data/demoAccountSwitchContext';

export default function PodiumHeader(){
 const auth=useAuth(),{locale}=useI18n(),hr=locale==='hr',{pathname,search}=useLocation();
 const demoSwitch=useDemoAccountSwitch();
 const {account,role,href,hasAthleteAccess,hasClubAccess,error:navigationError,retry}=usePodiumNavigation();
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const menu=useRef<HTMLDetailsElement>(null),mobile=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(menu.current)menu.current.open=false;if(mobile.current)mobile.current.open=false;},[pathname,search,auth.user?.id]);
 const privateCampaign=/^\/rewards\/campaigns\/[^/]+\/?$/.test(pathname);
 const next=`/auth?next=${encodeURIComponent(pathname+search)}`;
 const labels={admin:hr?'Administracija':'Admin',reviewer:hr?'Pregled':'Review',club:hr?'Klupske nagrade':'Club rewards',athlete:hr?'Moje nagrade':'My rewards',sponsor:hr?'Moje kampanje':'My campaigns'};
 const roleActive=href&&(pathname===href||pathname.startsWith(href+'/')||role==='sponsor'&&privateCampaign||role==='reviewer'&&pathname.startsWith('/rewards/manage/campaigns/'));
 const links=<><NavLink to="/rewards" end>{hr?'Početna':'Home'}</NavLink><NavLink to="/rewards/events">{hr?'Događaji':'Events'}</NavLink><NavLink to="/rewards/campaigns" end={privateCampaign}>{hr?'Kampanje':'Campaigns'}</NavLink>{role&&href?<Link to={href} aria-current={roleActive?'page':undefined}>{labels[role]}</Link>:null}{hasAthleteAccess&&role!=='athlete'?<NavLink to="/athlete/rewards">{labels.athlete}</NavLink>:null}{hasClubAccess&&role!=='club'?<NavLink to="/club/rewards">{labels.club}</NavLink>:null}</>;
 async function leave(){setBusy(true);setError(false);demoSwitch?.forget();try{await auth.signOut();}catch{setError(true);}finally{setBusy(false);}}
 return <header className={s.header}><div className={s.inner}>
  <Link className={s.brand} to="/rewards" aria-label="RacesOn Podium" translate="no"><PodiumBrand/></Link>
  <nav className={s.nav} aria-label={hr?'Glavna navigacija':'Main navigation'}>{links}</nav>
  <div className={s.utilities}>
   <DemoAccountSwitcher disabled={busy}/>
   <details ref={mobile} onToggle={e=>{if(e.currentTarget.open&&menu.current)menu.current.open=false;}} className={`${s.account} ${s.mobileNavigation}`}><summary aria-label={hr?'Navigacija':'Navigation'}><Menu size={20}/></summary><nav className={`${s.menu} ${s.mobileNav}`} aria-label={hr?'Mobilna navigacija':'Mobile navigation'}>{links}</nav></details>
   {auth.user?<details ref={menu} onToggle={e=>{if(e.currentTarget.open&&mobile.current)mobile.current.open=false;}} className={s.account}><summary aria-label={hr?'Izbornik računa':'Account menu'}><UserRound className={s.mobileIcon} size={18}/><span>{account?.loginUsername??(hr?'Račun':'Account')}</span><ChevronDown className={s.desktopIcon} size={13}/></summary><div className={s.menu}>
    <Link to="/rewards/profile">{hr?'Profil':'Profile'}</Link><Link to="/rewards/wallet">{hr?'Novčanik':'Wallet'}</Link><button disabled={busy||demoSwitch?.busy} onClick={()=>void leave()}>{hr?'Odjava':'Sign out'}</button>
   </div></details>:<Link className={s.signOut} to={next}>{hr?'Prijava':'Sign in'}</Link>}
  </div>
 </div><DemoAccountPhoneNavigation/>{error?<p role="alert">{hr?'Odjava nije uspjela. Pokušajte ponovno.':'Sign out failed. Please retry.'}</p>:null}{navigationError?<p role="alert">{hr?'Navigacija računa trenutačno nije dostupna.':'Account navigation is temporarily unavailable.'} <button onClick={()=>void retry()}>{hr?'Pokušaj ponovno':'Try again'}</button></p>:null}</header>;
}
