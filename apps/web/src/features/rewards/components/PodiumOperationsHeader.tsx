import {useRef,useState} from 'react';
import {ChevronDown,Menu,UserRound} from 'lucide-react';
import PodiumBrand from './PodiumBrand';
import s from './PodiumHeader.module.css';

export type OperationsAccount={label:string;onSignOut:()=>Promise<void>};
// Native controller authentication stays separate from the ordinary account.
export default function PodiumOperationsHeader({account}:{account?:OperationsAccount}){
 const menu=useRef<HTMLDetailsElement>(null),mobile=useRef<HTMLDetailsElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const links=<><a href="/rewards">Home</a><a href="/rewards/events">Events</a><a href="/rewards/campaigns">Campaigns</a><a href="/rewards/control" aria-current="page">Review</a></>;
 async function leave(){setBusy(true);setError(false);try{await account?.onSignOut();}catch{setError(true);}finally{setBusy(false);}}
 function close(){if(menu.current)menu.current.open=false;}
 function openWallet(){close();const wallet=document.getElementById('controller-wallet');if(wallet instanceof HTMLDetailsElement)wallet.open=true;}
 return <header className={s.header}><div className={s.inner}>
  <a className={s.brand} href="/rewards" aria-label="RacesOn Podium" translate="no"><PodiumBrand/></a>
  <nav className={s.nav} aria-label="Main navigation">{links}</nav>
  <div className={s.utilities}>
   <details ref={mobile} onToggle={e=>{if(e.currentTarget.open&&menu.current)menu.current.open=false;}} className={`${s.account} ${s.mobileNavigation}`}><summary aria-label="Navigation"><Menu size={20}/></summary><nav className={`${s.menu} ${s.mobileNav}`} aria-label="Mobile navigation">{links}</nav></details>
   {account?<details ref={menu} onToggle={e=>{if(e.currentTarget.open&&mobile.current)mobile.current.open=false;}} className={s.account}><summary aria-label="Account menu"><UserRound className={s.mobileIcon} size={18}/><span>{account.label}</span><ChevronDown className={s.desktopIcon} size={13}/></summary><div className={s.menu}>
    <a href="#controller-profile" onClick={close}>Profile</a><a href="#controller-wallet" onClick={openWallet}>Wallet</a><button disabled={busy} onClick={()=>void leave()}>Sign out</button>
   </div></details>:<span>Operations</span>}
  </div>
 </div>{error?<p role="alert">Sign out failed. Please retry.</p>:null}</header>;
}
