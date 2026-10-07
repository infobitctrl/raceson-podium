import {publicEnv} from "@/lib/public-env";
import {useEffect,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {Archive,ArchiveRestore,Trash2} from "lucide-react";
import type {SavedRewardSetup} from "@raceson/domain/rewards/distribution-setup";
import type {DirectoryCampaign} from "@raceson/domain/rewards/public-directory";
import {savedCampaignHref,savedCampaignStatus,savedCampaignNext,savedCampaignAction} from "../model/savedCampaignPresentation";
import {sponsorSelectedEventName} from "../model/sponsorOpportunities";
import {ApiError} from "@/lib/api";
import {archiveRewardSetup,deleteRewardDraft} from "../data/distributionSetups";
import SavedBudgetGraphic from './SavedBudgetGraphic';
import {CampaignSponsor} from './CampaignSponsor';
import OfficialSourceLinks from './OfficialSourceLinks';
import {officialSource} from '../model/officialSource';
import s from "./SavedCampaignCard.module.css";

export default function SavedCampaignCard({record,hr,finished=false,live,onDeleted,onArchived}:{record:SavedRewardSetup;hr:boolean;finished?:boolean;live?:DirectoryCampaign;onDeleted:(id:string)=>void;onArchived?:(record:SavedRewardSetup)=>void}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const active=useRef(true),pending=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const c=record.configuration,draft=record.lifecycle?.canDelete===true;
 const state=record.lifecycle?.state,archived=record.lifecycle?.archived===true;
 const canArchive=!draft&&record.lifecycle?.archived===false&&state!=="funded";
 const deleteLabel=state==="saved"?(hr?"Izbriši kampanju":"Delete campaign"):(hr?"Izbriši nacrt":"Delete draft");
 const archiveLabel=archived?(hr?"Vrati kampanju":"Restore campaign"):(hr?"Arhiviraj kampanju":"Archive campaign");
 const status=savedCampaignStatus(record,hr,finished,live);
 const next=`${savedCampaignAction(record,hr,live)} →`;
 const event=c.event?.name??sponsorSelectedEventName(c.sponsorSelection)??c.context?.eventName??(c.sponsorSelection?(hr?"Odabrani događaj · izvor još nije povezan":"Selected event · source not linked yet"):null)??(c.programmeKind==="league"?(hr?"Program lige · izvor rezultata nije povezan":"League programme · results source not linked"):(hr?"Događaj još nije odabran":"Event not selected yet"));
 const href=savedCampaignHref(record),source=officialSource(c.sponsorSelection);
 async function remove(){
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{await deleteRewardDraft(record.id,record.revision);if(active.current)onDeleted(record.id);}
  catch(e){if(active.current)setError(e instanceof ApiError&&e.code==="reward_setup_not_deletable"
   ?(hr?"Izrada ugovora je zatražena. Kampanja nije izbrisana. Osvježite njezino stanje.":"Contract creation was requested. This campaign was not deleted. Refresh its status.")
   :e instanceof ApiError&&(e.code==="reward_setup_conflict"||e.code==="reward_setup_not_found")
   ?(hr?"Kampanja je promijenjena. Osvježite stranicu prije nastavka.":"This campaign changed. Refresh the page before continuing.")
   :(hr?"Brisanje nije potvrđeno. Pokušajte ponovno.":"Deletion could not be confirmed. Try again."));}
  finally{pending.current=false;if(active.current)setBusy(false);}
 }
 async function changeArchive(){
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{const updated=await archiveRewardSetup(record.id,record.revision,!archived);if(active.current){setConfirm(false);onArchived?.(updated);}}
  catch(e){if(active.current)setError(e instanceof ApiError&&e.code==="reward_setup_not_archivable"
   ?(hr?"Uplata je potvrđena. Kampanja nije arhivirana. Osvježite stranicu.":"Funding has been confirmed. This campaign was not archived. Refresh the page.")
   :e instanceof ApiError&&(e.code==="reward_setup_conflict"||e.code==="reward_setup_not_found")
   ?(hr?"Kampanja je promijenjena. Osvježite stranicu prije nastavka.":"This campaign changed. Refresh the page before continuing.")
   :(hr?"Promjena nije potvrđena. Pokušajte ponovno.":"This change could not be confirmed. Try again."));}
  finally{pending.current=false;if(active.current)setBusy(false);}
 }
 return <article className={s.card} aria-label={c.name}>
  {source?<Link className={s.photo} to={href} tabIndex={-1} aria-hidden="true"><img src={source.image} alt="" loading="lazy"/></Link>:null}
  <div className={s.identity}><CampaignSponsor id={record.id} hr={hr}/><OfficialSourceLinks selection={c.sponsorSelection} hr={hr}/></div>
  <Link className={s.content} to={href}><span className={s.badge} data-funded={state==="funded"||finished}>{status}</span><h2>{c.name}</h2><p>{source?.name??event}</p><small>{c.event?.date}</small><div className={s.budget}><small>{hr?"Planirani fond":"Planned budget"}</small><strong>{c.budgetMon} <span>test MON</span></strong></div><p>{savedCampaignNext(record,hr,live)}</p>{live?<small>{hr?"Zadnja provjera":"Last checked"} {new Date(Number(live.campaign.blockTimestamp)*1000).toLocaleString(hr?"hr-HR":"en-GB")}</small>:null}<p className={s.next}>{next}</p></Link>
  <SavedBudgetGraphic configuration={c} hr={hr}/>
  {state==="saved"&&draft?<p className={s.footer}>{hr?"Pravila su spremljena. Otvorite kampanju za stanje pokretanja i novčanik za uplatu.":"Rules saved. Open the campaign for launch status and your funding wallet."}</p>:null}
  {!publicEnv.hostedCopy&&draft&&!archived?<div className={s.footer}>{confirm?<div role="group" aria-label={hr?"Potvrda brisanja":"Confirm deletion"}>
   <p className={s.question}>{`${deleteLabel} “${c.name}”?`}</p>
   <p>{hr?"Uklonit će se iz Mojih kampanja. Povijest ostaje sačuvana.":"It will be removed from My campaigns. Its history is retained."}</p>
   <div className={s.actions}><button disabled={busy} onClick={()=>{setConfirm(false);setError("");}}>{hr?"Odustani":"Cancel"}</button><button className={s.confirm} disabled={busy} onClick={()=>void remove()}>{busy?(hr?"Brisanje…":"Deleting…"):deleteLabel}</button></div>
   {error?<p role="alert">{error}</p>:null}
  </div>:<button className={s.delete} aria-label={`${deleteLabel}: ${c.name}`} onClick={()=>setConfirm(true)}><Trash2 size={15} aria-hidden="true"/>{deleteLabel}</button>}</div>:null}
  {!draft&&!archived&&(state==="saved"||state==="deposit")?<p className={s.footer}>{hr?"Zahtjev za izradu ugovora čuva se s poviješću transakcija. Otvorite kampanju za provjeru stanja.":"The contract creation request and transaction history are retained. Open the campaign to check its status."}</p>:null}
  {!publicEnv.hostedCopy&&(canArchive||archived)?<div className={s.footer}>{confirm&&!archived?<div role="group" aria-label={hr?"Potvrda arhiviranja":"Confirm campaign archive"}>
   <p className={s.question}>{hr?`Arhivirati kampanju „${c.name}”?`:`Archive campaign “${c.name}”?`}</p>
   <p>{hr?"Premješta kampanju u Arhivirane. Ne otkazuje ugovor ili transakcije i ne vraća sredstva. Pristup ugovoru i potvrdama ostaje dostupan; kampanju možete vratiti.":"Moves this campaign to Archived. It does not cancel its contract or transactions or refund funds. Contract and receipt access remain available; you can restore it."}</p>
   <div className={s.actions}><button disabled={busy} onClick={()=>{setConfirm(false);setError("");}}>{hr?"Odustani":"Cancel"}</button><button disabled={busy} onClick={()=>void changeArchive()}>{busy?(hr?"Arhiviranje…":"Archiving…"):archiveLabel}</button></div>
  </div>:<button className={s.delete} disabled={busy} aria-label={`${archiveLabel}: ${c.name}`} onClick={()=>{if(archived)void changeArchive();else setConfirm(true);}}>{archived?<ArchiveRestore size={15} aria-hidden="true"/>:<Archive size={15} aria-hidden="true"/>}{busy?(hr?"Vraćanje…":"Restoring…"):archiveLabel}</button>}
  {error?<p role="alert">{error}</p>:null}</div>:null}
 </article>;
}
