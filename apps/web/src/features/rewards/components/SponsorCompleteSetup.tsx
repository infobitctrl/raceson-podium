import {useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {completeSponsorSetup,publicCampaignPath} from '../data/publicCampaign';
import s from './SponsorLaunch.module.css';

export default function SponsorCompleteSetup({id,hr,compact=false,published=false}:{id:string;hr:boolean;compact?:boolean;published?:boolean}) {
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),flight=useRef(false);
 async function complete(){
  if(flight.current)return;
  flight.current=true;setBusy(true);setFailed(false);
  try{await completeSponsorSetup(id);location.assign(publicCampaignPath(id));}
  catch{setFailed(true);setBusy(false);flight.current=false;}
 }
 if(published)return <section className={compact?s.completionAction:s.card} aria-label={hr?"Javna kampanja":"Published campaign"}><a className={s.primary} href={publicCampaignPath(id)}>{hr?"Otvori javnu kampanju":"View public campaign"}<ArrowRight size={17}/></a></section>;
 return <section className={compact?s.completionAction:s.card} aria-label={hr?'Dovršite postavljanje':'Complete campaign setup'}>
  {!compact ? <><span className={s.eyebrow}>{hr?'Sve je spremno':'You’re all set'}</span>
  <h2>{hr?'Vaša kampanja je financirana':'Your campaign is funded'}</h2>
  <p>{hr?'Dovršite postavljanje i otvorite javnu stranicu kampanje. Ondje možete dijeliti kampanju te pratiti rezultate, nagrade i isplate.':'Complete setup to open your campaign’s public page. Share the campaign and follow results, awards and payouts there.'}</p></> : null}
  <button className={s.primary} disabled={busy} onClick={()=>void complete()}>{busy?(hr?'Dovršavanje…':'Completing setup…'):(hr?'Dovrši postavljanje':'Complete setup')}<ArrowRight size={17}/></button>
  {busy?<p role="status">{hr?'Potvrđujemo uplatu i pripremamo javnu stranicu…':'Confirming your deposit and preparing the public page…'}</p>:null}
  {failed?<p role="alert">{hr?'Nismo uspjeli otvoriti javnu stranicu. Pokušajte ponovno; potvrđena uplata ostaje spremljena.':'We couldn’t open the public page. Please try again; your confirmed deposit is still saved.'}</p>:null}
 </section>;
}
