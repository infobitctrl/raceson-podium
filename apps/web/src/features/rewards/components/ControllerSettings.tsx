import {useI18n} from "@/shared/i18n/I18nContext";
import {useEffect,useRef,useState} from 'react';
import {decodeControllerSession,type ControllerSession} from '../data/controller';
import type {ControllerConnection} from '../screens/RewardsControl';
import ControllerWalletCard from './ControllerWalletCard';
import ControllerCreationSetup from './ControllerCreationSetup';
import s from '../screens/RewardsControl.module.css';

/** Mounted only when settings is opened. Provider setup must not block review. */
export default function ControllerSettings({connection,session}:{connection:ControllerConnection;session:ControllerSession}){
 const {locale}=useI18n(),hr=locale==='hr';
 const [settings,setSettings]=useState<ControllerSession|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),live=useRef(true);
 async function refresh(){setBusy(true);setError(false);setSettings(null);try{
  const next=decodeControllerSession(await connection.request('/session'));
  if(!connection.isCurrent()||next.subject!==session.subject||next.wallet!==session.wallet)throw Error('controller_session_changed');
  if(live.current)setSettings(next);
 }catch{if(live.current)setError(true);}finally{if(live.current)setBusy(false);}}
 useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;};},[]); // eslint-disable-line react-hooks/exhaustive-deps
 return <>
  {connection.wallets.includes(session.wallet)?<ControllerWalletCard connection={connection} address={session.wallet}/>:null}
  {busy?<p role="status">{hr?"Provjera postavki usluge stvaranja kampanja… Pregled kampanja i dalje je dostupan iznad.":"Checking deployment service settings\u2026 Campaign review remains available above."}</p>:null}
  {error?<div role="alert"><p>{hr?"Postavke stvaranja kampanja nisu provjerene. Možeš nastaviti pregledavati raspodjele.":"Deployment settings could not be verified. You can continue reviewing distributions."}</p><button className={s.secondary} disabled={busy} onClick={()=>void refresh()}>{hr?"Ponovno provjeri postavke":"Retry settings"}</button></div>:null}
  {settings?.creation?<ControllerCreationSetup connection={connection} session={settings} onRefresh={refresh}/>:null}
 </>;
}
