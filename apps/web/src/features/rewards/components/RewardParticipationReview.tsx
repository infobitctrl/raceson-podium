import {useEffect,useRef,useState} from "react";
import {canonicalParticipationValue as canonical,decodeParticipationReviewChange,type ParticipationReviewChange,type ParticipationReviewWorkspace} from "@raceson/domain/rewards/participation-review";
import type {ParticipationReview} from "@raceson/domain/rewards/participation-awards";
import {ApiError} from "@/lib/api";
import {requestParticipationReview} from "../data/participationReview";
import type {SetupEventSelection} from "./RewardSetupEvent";
import s from "./RewardSetup.module.css";
import m from "./RewardLeagueMetrics.module.css";

type Props={selection:SetupEventSelection;sourceHash:string;hr:boolean;onUnsavedChange?:(value:boolean)=>void};
function ReviewPanel({selection,sourceHash,hr,onUnsavedChange}:Props) {
  const [view,setView]=useState<ParticipationReviewWorkspace|null>(null),[draft,setDraft]=useState<ParticipationReview|null>(null);
  const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[pending,setPending]=useState<ParticipationReviewChange|null>(null);
  const [error,setError]=useState<"load"|"unknown"|"conflict"|"invalid"|null>(null),[saved,setSaved]=useState(false);
  const [search,setSearch]=useState(""),[page,setPage]=useState(0);
  const generation=useRef(0),inFlight=useRef(false);
  useEffect(()=>()=>{generation.current++;},[]);
  const empty:ParticipationReview={version:1,sourceHash,duplicates:[],confirmedUnaffiliatedResultIds:[]};
  const baseline=view?.review?.current?view.review.review:empty;
  const dirty=!!draft&&(canonical(draft)!==canonical(baseline)||!!reason);
  useEffect(()=>{onUnsavedChange?.(dirty||!!pending);return()=>onUnsavedChange?.(false);},[dirty,pending,onUnsavedChange]);
  useEffect(()=>{if(!dirty&&!pending)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty,pending]);
  const apply=(data:ParticipationReviewWorkspace)=>{setView(data);setDraft(structuredClone(data.review?.current?data.review.review:empty));setReason("");setPage(0);setSearch("");};
  async function load() {
    if(inFlight.current||pending)return;inFlight.current=true;const n=++generation.current;setBusy(true);setError(null);setSaved(false);
    try {const data=await requestParticipationReview(selection,sourceHash);if(n===generation.current)apply(data);}
    catch {if(n===generation.current)setError("load");}
    finally {inFlight.current=false;if(n===generation.current)setBusy(false);}
  }
  async function save() {
    if(inFlight.current||!draft)return;
    let change=pending;
    if(!change) {try {change=decodeParticipationReviewChange({requestId:crypto.randomUUID(),expectedReviewId:view?.review?.id??null,review:draft,reason});}
      catch {setError("invalid");return;}}
    inFlight.current=true;setPending(change);setBusy(true);setError(null);setSaved(false);const n=++generation.current;
    try {const data=await requestParticipationReview(selection,sourceHash,change);if(n===generation.current){
      const changed=data.sourceHash!==sourceHash||canonical(data.record)!==canonical(selection.record)||canonical(data.workspace)!==canonical(selection.workspace);
      if(changed){setView(null);setDraft(null);setReason("");setError("conflict");}else apply(data);
      setPending(null);setSaved(true);
    }}
    catch(e) {if(n===generation.current){if(e instanceof ApiError&&[400,401,403,404,409].includes(e.status)){setPending(null);setError(e.status===400?"invalid":"conflict");}else setError("unknown");}}
    finally {inFlight.current=false;if(n===generation.current)setBusy(false);}
  }
  const locked=busy||!!pending||error==="conflict"||error==="load";
  const duplicates=view?.metrics?.issues.filter(i=>i.code==="duplicate_athlete_round")??[];
  const unaffiliated=(view?.metrics?.contributions??[]).filter(c=>c.clubId===null);
  const rows=unaffiliated.filter(c=>`${c.athleteName??""} ${c.athleteId} ${c.raceName}`.toLowerCase().includes(search.toLowerCase()));
  const confirm=(id:string,checked:boolean)=>{if(!draft)return;setSaved(false);setDraft({...draft,confirmedUnaffiliatedResultIds:checked?[...draft.confirmedUnaffiliatedResultIds,id]:draft.confirmedUnaffiliatedResultIds.filter(r=>r!==id)});};
  return <section className={m.selected} aria-label={hr?"Provjera doprinosa":"Contribution review"}>
    <div className={m.header}><div><h3>{hr?"Provjerite doprinose":"Review contributions"}</h3>
      <p className={s.small}>{hr?"Razriješite višestruke rezultate i potvrdite neovisne nastupe. Ova provjera ne odobrava nagrade.":"Resolve duplicate results and confirm unaffiliated participation. This review does not approve rewards."}</p></div>
      <button className={s.button} disabled={busy||!!pending||(dirty&&error!=="conflict")} onClick={()=>void load()}>{view?(hr?"Ponovno učitaj provjeru":"Reload review"):(hr?"Otvori provjeru":"Open review")}</button></div>
    {error?<p role="alert" className={s.notice}>{error==="unknown"?(hr?"Spremanje nije potvrđeno. Ponovite isti zahtjev prije drugih izmjena.":"Save is unconfirmed. Retry the same request before making further changes."):error==="conflict"?(hr?"Provjera, izvor ili pristup su se promijenili. Ponovno učitajte prije nastavka.":"Review, source or access changed. Reload before continuing."):error==="invalid"?(hr?"Dodajte razlog svake odluke i razlog spremanja.":"Provide a reason for each decision and for saving this revision."):(hr?"Provjeru nije moguće učitati. Osvježite podatke programa i pokušajte opet.":"Could not load the review. Refresh programme data and try again.")}</p>:null}
    {saved?<p role="status">{view?(hr?"Provjera je spremljena. Prikazana je najnovija revizija.":"Review saved. The latest revision is shown."):(hr?"Provjera je spremljena. Osvježite podatke programa prije nastavka.":"Review saved. Refresh programme data before continuing.")}</p>:null}
    {view&&draft?<>
      <p className={s.small}>{view.review?(hr?`Spremljena revizija ${view.review.revision}`:`Saved revision ${view.review.revision}`):(hr?"Još nema spremljene provjere.":"No saved review yet.")}</p>
      {view.review&&!view.review.current?<p className={s.notice}>{hr?"Izvor se promijenio. Prethodne odluke ostaju u povijesti; provjerite nove podatke.":"Source changed. Previous decisions remain in history; review the new evidence."}</p>:null}
      <fieldset disabled={locked} className={m.reviewFields}>
        <legend>{hr?"Više rezultata u istom kolu":"Multiple results in one round"} · {duplicates.length}</legend>
        {!duplicates.length?<p>{hr?"Nema višestrukih rezultata.":"No duplicate results."}</p>:null}
        {duplicates.map(issue=>{const key=`${issue.round}:${issue.athleteId}`,decision=draft.duplicates.find(d=>d.round===issue.round&&d.athleteId===issue.athleteId);
          const sourceRows=view.snapshot?.results.filter(r=>issue.resultIds.includes(r.id))??[];
          const update=(keepResultId:string|null|undefined,why=decision?.reason??"")=>{setSaved(false);setDraft({...draft,duplicates:[...draft.duplicates.filter(d=>!(d.round===issue.round&&d.athleteId===issue.athleteId)),...(keepResultId===undefined?[]:[{...issue,keepResultId,reason:why}].map(({round,athleteId,resultIds,keepResultId,reason})=>({round,athleteId,resultIds,keepResultId,reason})))]});};
          return <div className={m.selected} key={key}><h4>{issue.round}. {sourceRows[0]?.athleteName??issue.athleteId}</h4>
            <label className={s.field}>{hr?"Rezultat koji se računa":"Result to count"}<select aria-label={`${hr?"Rezultat koji se računa":"Result to count"} · ${key}`} value={decision?decision.keepResultId??"none":"unresolved"} onChange={e=>update(e.target.value==="unresolved"?undefined:e.target.value==="none"?null:e.target.value)}>
              <option value="unresolved">{hr?"Još nije razriješeno":"Unresolved"}</option><option value="none">{hr?"Ne računaj nijedan":"Count none"}</option>
              {sourceRows.map(r=>{const race=view.metrics?.rounds.flatMap(r=>r.races).find(c=>c.id===r.raceId);return <option key={r.id} value={r.id}>{race?.name} · {r.participationStatus??"?"} · {race?.metres===null?"?":Number(race?.metres??0)/1000} km · {r.clubName??r.clubId??(hr?"Klub nije naveden":"Club not recorded")} · {r.id.slice(-6)}</option>;})}
            </select></label>
            <details className={m.details}><summary>{hr?"Usporedi izvorne zapise":"Compare source records"}</summary>
              <p className={s.small}>{hr?"Ova odluka utječe na broj završetaka te kilometre sportaša i kluba.":"This decision affects finish count, athlete kilometres and club kilometres."}</p>
              {sourceRows.map(r=><p key={r.id} className={m.hash}><strong>{r.participationStatus??(hr?"Nepoznat status":"Unknown outcome")}</strong> · {r.finishTimeMs===null?"—":`${r.finishTimeMs/1000} s`}<br/>{r.clubName??r.clubId??(hr?"Klub nije naveden":"Club not recorded")}<br/>{r.id}</p>)}
            </details>
            {decision?<label className={s.field}>{hr?"Razlog odluke":"Decision reason"}<input maxLength={500} value={decision.reason} onChange={e=>update(decision.keepResultId,e.target.value)}/></label>:null}
          </div>;})}
      </fieldset>
      <fieldset disabled={locked} className={m.reviewFields}><legend>{hr?"Nastupi bez navedenog kluba":"Finishes without a recorded club"} · {unaffiliated.length}</legend>
        <p className={s.small}>{hr?"Potvrdite samo stvarno neovisne nastupe. Netočan klub ispravite u službenom izvoru; ovdje ne dodjeljujemo klub.":"Confirm only genuinely unaffiliated finishes. Correct a wrong club in the official source; this screen does not assign clubs."}</p>
        <label className={s.field}>{hr?"Pretraži završetke":"Search finishes"}<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
        <div className={s.tableWrap}><table className={s.table}><thead><tr><th>{hr?"Sportaš / kolo":"Athlete / round"}</th><th>km</th><th>{hr?"Potvrđen neovisan nastup":"Confirmed unaffiliated"}</th></tr></thead><tbody>
          {rows.slice(page*25,(page+1)*25).map(row=><tr key={row.resultId}><td>{row.athleteName??row.athleteId}<br/>{row.round}. {row.raceName}</td><td>{row.metres===null?"—":Number(row.metres)/1000}</td><td><input type="checkbox" aria-label={`${hr?"Neovisan nastup":"Unaffiliated"} · ${row.athleteName??row.athleteId} · ${row.round} · ${row.resultId.slice(-6)}`} checked={draft.confirmedUnaffiliatedResultIds.includes(row.resultId)} onChange={e=>confirm(row.resultId,e.target.checked)}/></td></tr>)}
          {!rows.length?<tr><td colSpan={3}>{hr?"Nema podudaranja.":"No matching finishes."}</td></tr>:null}
        </tbody></table></div>
        {rows.length>25?<div className={m.pagination}><button className={s.button} disabled={page===0} onClick={()=>setPage(p=>p-1)}>{hr?"Prethodno":"Previous"}</button><span>{page+1} / {Math.ceil(rows.length/25)}</span><button className={s.button} disabled={(page+1)*25>=rows.length} onClick={()=>setPage(p=>p+1)}>{hr?"Sljedeće":"Next"}</button></div>:null}
        <p>{draft.confirmedUnaffiliatedResultIds.length} {hr?"potvrđenih nastupa. Nepotvrđeni ostaju za provjeru.":"finishes confirmed. Unconfirmed entries remain unresolved."}</p>
      </fieldset>
      <label className={s.field}>{hr?"Razlog spremanja / ispravka":"Reason for saving / correction"}<input disabled={locked} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setSaved(false);}}/></label>
      {dirty&&!pending?<button className={s.button} disabled={busy} onClick={()=>{setDraft(structuredClone(baseline));setReason("");setSaved(false);}}>{hr?"Odbaci nespremljene izmjene":"Discard unsaved changes"}</button>:null}
      <button className={s.primary} disabled={busy||(!pending&&(locked||!reason.trim()))} onClick={()=>void save()}>{busy?(hr?"Spremanje…":"Saving…"):pending?(hr?"Ponovi isto spremanje":"Retry same save"):(hr?"Spremi provjeru":"Save review")}</button>
      <p className={s.small}>{hr?"Možete spremiti djelomičnu provjeru. Nedostajuće udaljenosti i statusi ispravljaju se u izvornim rezultatima.":"You can save a partial review. Missing distances and outcomes must be corrected in the source results."}</p>
      {view.history.length?<details className={m.details}><summary>{hr?"Povijest provjere · zadnjih 10 revizija":"Review history · latest 10 revisions"}</summary><ol>{view.history.map(r=><li key={r.id}><strong>{hr?"Revizija":"Revision"} {r.revision}</strong> · {new Date(r.reviewedAt).toLocaleString(hr?"hr":"en")}<p>{r.reason}</p><p className={s.small}>{r.review.duplicates.length} {hr?"odluka o rezultatima":"result decisions"} · {r.review.confirmedUnaffiliatedResultIds.length} {hr?"neovisnih nastupa":"unaffiliated finishes"}</p><details><summary>{hr?"Dokazi":"Evidence"}</summary><p className={m.hash}>{r.review.sourceHash}</p><p className={s.small}>{hr?"Račun pregledavatelja":"Reviewer account"}: {r.reviewedByUserId}</p>{r.review.confirmedUnaffiliatedResultIds.length?<p className={m.hash}>{hr?"Potvrđeni neovisni rezultati":"Confirmed unaffiliated result IDs"}: {r.review.confirmedUnaffiliatedResultIds.join(", ")}</p>:null}{r.review.duplicates.map(d=><p key={`${d.round}:${d.athleteId}`}>{d.round} · {d.keepResultId??(hr?"Ne računaj nijedan":"Count none")} · {d.reason}</p>)}</details></li>)}</ol></details>:null}
    </>:null}
  </section>;
}
export default function RewardParticipationReview(props:Props) {
  return <ReviewPanel key={`${JSON.stringify(props.selection)}:${props.sourceHash}`} {...props}/>;
}
