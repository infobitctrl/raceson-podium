import {useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '@/lib/auth';
import s from './Podium.module.css';

/** Explicit account switch through normal auth; preserves this reward destination. */
export default function RewardAccountSwitch({hr,label}:{hr:boolean;label:string}){
 const auth=useAuth(),location=useLocation(),navigate=useNavigate();
 const flight=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function changeAccount(){
  if(flight.current)return;
  flight.current=true;setBusy(true);setError(false);
  const next=`${location.pathname}${location.search}${location.hash}`;
  try{await auth.signOut();navigate(`/auth?next=${encodeURIComponent(next)}`);}
  catch{setError(true);}
  finally{flight.current=false;setBusy(false);}
 }
 return <div><button className={s.primary} disabled={busy} onClick={()=>void changeAccount()}>{busy?(hr?'Odjava…':'Signing out…'):label}</button>{error?<p role="alert">{hr?'Odjava nije uspjela. Pokušajte ponovno.':'Could not sign out. Please try again.'}</p>:null}<p className={s.muted}>{hr?'Odjavljuje ovaj račun i vraća vas ovdje nakon prijave.':'Signs out this account and brings you back here after sign-in.'}</p></div>;
}
