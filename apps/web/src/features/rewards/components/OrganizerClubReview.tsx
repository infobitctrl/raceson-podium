import RewardExplorerLink from "./RewardExplorerLink";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOperatorClubContext, observeOperatorClub, recordOperatorClub, revokeOperatorClub } from "../data/organizerClubs";
import { organizerAccessLost, organizerErrorKey, organizerUuid } from "../model/organizerRewards";
import { clubEvidenceFields, clubReviewReasons, clubReviewAddress, clubReviewHash, makeClubReviewInput,
  type OperatorClubContext, type OperatorClubSelection, type OperatorClubReview, type ClubReviewObservation, type ClubReviewInput, type ClubReviewReason } from "../model/organizerClubs";
type Command={kind:"record";input:ClubReviewInput}|{kind:"revoke";reviewId:string;reason:ClubReviewReason};
type View={phase:"loading"|"observing"}|{phase:"error";error:unknown}|{phase:"ready";context:OperatorClubContext;preview:ClubReviewObservation|null}
  |{phase:"writing";command:Command}|{phase:"uncertain";command:Command;error:unknown}|{phase:"recorded";review:OperatorClubReview};
const emptyRefs=()=>({authorityEvidenceRef:"",controlEvidenceRef:"",recoveryEvidenceRef:"",executionHistoryEvidenceRef:""});
export default function OrganizerClubReview({selection,onBack,onAccessLost}:{selection:OperatorClubSelection;onBack:()=>void;onAccessLost:(error:unknown)=>void}) {
  const {t,locale}=useI18n(),formId=useId(),[view,setView]=useState<View>({phase:"loading"});
  const [factory,setFactory]=useState(""),[transaction,setTransaction]=useState(""),[refs,setRefs]=useState(emptyRefs);
  const [attested,setAttested]=useState(false),[reason,setReason]=useState<ClubReviewReason|"">(""),[confirmed,setConfirmed]=useState(false);
  const epoch=useRef(0),flight=useRef(false),lost=useRef(onAccessLost),region=useRef<HTMLElement|null>(null);lost.current=onAccessLost;
  const load=useCallback(async()=>{
    if(flight.current)return;const ticket=++epoch.current;flight.current=true;setView({phase:"loading"});
    setFactory("");setTransaction("");setRefs(emptyRefs());setAttested(false);setReason("");setConfirmed(false);
    try{const context=await getOperatorClubContext(selection);if(ticket===epoch.current)setView({phase:"ready",context,preview:null});}
    catch(error){if(ticket===epoch.current){setView({phase:"error",error});if(organizerAccessLost(error))lost.current(error);}}
    finally{if(ticket===epoch.current)flight.current=false;}
  },[selection]);
  useEffect(()=>{region.current?.focus();void load();return()=>{epoch.current++;flight.current=false;};},[load]);
  async function observe(context:OperatorClubContext) {
    if(flight.current||!clubReviewAddress(factory)||!clubReviewHash(transaction))return;
    const ticket=++epoch.current;flight.current=true;setAttested(false);setRefs(emptyRefs());setView({phase:"observing"});
    try{const preview=await observeOperatorClub(selection,{expectedIdentityFingerprintSha256:context.identityFingerprintSha256,expectedRevision:context.latestReview?.revision??0,
      factoryAddress:factory,deploymentTransactionHash:transaction});if(ticket===epoch.current)setView({phase:"ready",context,preview});}
    catch(error){if(ticket===epoch.current){setView({phase:"error",error});if(organizerAccessLost(error))lost.current(error);}}
    finally{if(ticket===epoch.current)flight.current=false;}
  }
  async function execute(command:Command) {
    if(flight.current)return;const ticket=++epoch.current;flight.current=true;setView({phase:"writing",command});
    try{const review=command.kind==="record"?await recordOperatorClub(selection,command.input):await revokeOperatorClub(selection,command.reviewId,command.reason);
      if(ticket===epoch.current)setView({phase:"recorded",review});}
    catch(error){if(ticket===epoch.current){setView({phase:"uncertain",command,error});if(organizerAccessLost(error))lost.current(error);}}
    finally{if(ticket===epoch.current)flight.current=false;}
  }
  const context=view.phase==="ready"?view.context:null,preview=view.phase==="ready"?view.preview:null;
  const held=!context||["identity_hold","request_withdrawn"].includes(context.reviewState),busy=["loading","observing","writing"].includes(view.phase);
  const canObserve=!held&&(context?.latestReview?.revision??0)<=2147483645&&clubReviewAddress(factory)&&clubReviewHash(transaction);
  const canRecord=!!preview&&attested&&clubEvidenceFields.every(k=>organizerUuid(refs[k]));
  const utc=(value:string)=>new Intl.DateTimeFormat(locale==="hr"?"hr-HR":"en-GB",{dateStyle:"medium",timeStyle:"medium",timeZone:"UTC"}).format(new Date(value));
  const resetPreview=()=>{setAttested(false);setRefs(emptyRefs());if(view.phase==="ready")setView({...view,preview:null});};
  return <section ref={region} tabIndex={-1} aria-labelledby={`${formId}-title`} className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={`${formId}-title`} className="text-xl font-semibold">{t("rewards.clubReview.reviewTitle")}</h2>
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>void load()}>{t("rewards.organizer.reloadReview")}</Button></div>
    <p className="rounded-lg bg-secondary/60 p-3 text-sm">{t("rewards.clubReview.notice")}</p>
    <dl className="space-y-2 text-sm"><div><dt>{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={selection.address}/></dd></div>
      <div><dt>{t("rewards.claim.network")}</dt><dd>{t(selection.chainId===31337?"rewards.simulation":"rewards.testnet")} · {selection.chainId}</dd></div></dl>
    {busy?<p role="status">{t(view.phase==="observing"?"rewards.clubReview.observing":view.phase==="writing"?"rewards.organizer.saving":"rewards.loading")}</p>:null}
    {view.phase==="error"||view.phase==="uncertain"?<div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm">
      <p>{t(organizerErrorKey(view.error))}</p>{view.phase==="uncertain"?<><p>{t("rewards.organizer.uncertain")}</p>
        <Button variant="outline" className="h-auto whitespace-normal" onClick={()=>void execute(view.command)}>{t("rewards.organizer.retryDecision")}</Button></>:null}</div>:null}
    {view.phase==="recorded"?<div role="status" className="space-y-2 rounded-lg border border-primary/30 p-4"><h3 className="font-semibold">{t(view.review.revokedAt?"rewards.organizer.revokedSaved":"rewards.clubReview.saved")}</h3>
      <p className="text-sm">{t("rewards.organizer.savedHelp")}</p><p className="text-sm">{t("rewards.organizer.revision",{revision:view.review.revision})} · {utc(view.review.revokedAt??view.review.reviewedAt)} UTC</p>
      <p className="break-all font-mono text-xs">{view.review.reviewId}</p></div>:null}
    {context?<><h3 className="break-words text-lg font-semibold">{context.clubName??t("rewards.clubReview.fallback")}</h3>
      <p className="break-words text-sm">{t("rewards.clubReview.nominee")} {context.ownerName??t("rewards.organizer.unknown")}</p>
      <div role="status" className="rounded-lg bg-secondary/60 p-4"><p className="font-semibold">{t(`rewards.clubReview.state.${context.reviewState}`)}</p>
        <p className="mt-2 text-sm">{t(held?"rewards.clubReview.hold":"rewards.clubReview.evidenceHelp")}</p></div>
      <details className="rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">{t("rewards.clubReview.configuration")}</summary>
        <dl className="mt-3 space-y-3"><div><dt>{t("rewards.club.field.singletonAddress")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={context.candidate.singletonAddress}/></dd></div>
          <div><dt>{t("rewards.club.field.fallbackHandlerAddress")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={context.candidate.fallbackHandlerAddress}/></dd></div>
          {context.candidate.owners.map((owner,i)=><div key={owner}><dt>{t("rewards.clubReview.owner",{number:i+1})}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={owner}/></dd></div>)}</dl></details>
      {!held?<form className="space-y-4 border-t border-border pt-5" onSubmit={e=>{e.preventDefault();if(canObserve)void observe(context);}}>
        <h3 className="font-semibold">{t("rewards.clubReview.chainTitle")}</h3><p className="text-sm text-muted-foreground">{t("rewards.clubReview.chainHelp")}</p>
        <div className="space-y-2"><label htmlFor={`${formId}-factory`} className="text-sm font-medium">{t("rewards.clubReview.factory")}</label>
          <Input id={`${formId}-factory`} autoComplete="off" spellCheck={false} maxLength={42} value={factory} onChange={e=>{setFactory(e.target.value.trim().toLowerCase());resetPreview();}} required/></div>
        <div className="space-y-2"><label htmlFor={`${formId}-transaction`} className="text-sm font-medium">{t("rewards.clubReview.transaction")}</label>
          <Input id={`${formId}-transaction`} autoComplete="off" spellCheck={false} maxLength={66} value={transaction} onChange={e=>{setTransaction(e.target.value.trim().toLowerCase());resetPreview();}} required/></div>
        <Button type="submit" variant="outline" disabled={!canObserve}>{t("rewards.clubReview.observe")}</Button></form>:null}
      {preview?<form className="space-y-4 border-t border-border pt-5" onSubmit={e=>{e.preventDefault();if(canRecord)void execute({kind:"record",input:makeClubReviewInput(selection,preview,refs,crypto.randomUUID())});}}>
        <h3 className="font-semibold">{t("rewards.clubReview.observed")}</h3><p className="text-sm text-muted-foreground">{t("rewards.clubReview.historyWarning")}</p>
        <dl className="space-y-3 text-xs"><div><dt>{t("rewards.clubReview.deployedBlock")}</dt><dd className="break-all font-mono">{preview.deploymentBlock.number} · {preview.deploymentBlock.hash}</dd></div>
          <div><dt>{t("rewards.clubReview.reviewedBlock")}</dt><dd className="break-all font-mono">{preview.reviewedBlock.number} · {preview.reviewedBlock.hash}</dd></div></dl>
        <p className="text-sm text-muted-foreground">{t("rewards.organizer.referenceHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">{clubEvidenceFields.map(field=><div key={field} className="space-y-2"><label className="text-sm font-medium" htmlFor={`${formId}-${field}`}>{t(`rewards.clubReview.evidence.${field}`)}</label>
          <Input id={`${formId}-${field}`} autoComplete="off" maxLength={36} spellCheck={false} required value={refs[field]} onChange={e=>setRefs(prev=>({...prev,[field]:e.target.value.trim().toLowerCase()}))}/></div>)}</div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={attested} onChange={e=>setAttested(e.target.checked)}/><span>{t("rewards.clubReview.attest")}</span></label>
        <Button type="submit" className="h-auto whitespace-normal" disabled={!canRecord}>{t("rewards.clubReview.record")}</Button></form>:null}
      {context.latestReview&&context.latestReview.revokedAt===null?<form className="space-y-4 border-t border-border pt-5" onSubmit={e=>{e.preventDefault();if(reason&&confirmed&&context.latestReview)void execute({kind:"revoke",reviewId:context.latestReview.reviewId,reason});}}>
        <h3 className="font-semibold">{t("rewards.organizer.revokeTitle")}</h3><p className="text-sm text-muted-foreground">{t("rewards.organizer.revokeHelp")}</p>
        <label className="block text-sm font-medium" htmlFor={`${formId}-reason`}>{t("rewards.organizer.reason")}</label>
        <select id={`${formId}-reason`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={reason} onChange={e=>setReason(e.target.value as ClubReviewReason|"")} required>
          <option value="">{t("rewards.organizer.chooseReason")}</option>{clubReviewReasons.map(r=><option key={r} value={r}>{t(`rewards.clubReview.reason.${r}`)}</option>)}</select>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{t("rewards.organizer.confirmRevoke")}</span></label>
        <Button type="submit" variant="destructive" className="h-auto whitespace-normal" disabled={!reason||!confirmed}>{t("rewards.organizer.revoke")}</Button></form>:null}
    </>:null}
    <Button variant="ghost" className="h-auto whitespace-normal" onClick={onBack}>{t("rewards.clubReview.back")}</Button>
    {view.phase==="uncertain"||view.phase==="writing"?<p className="text-xs text-muted-foreground">{t("rewards.organizer.leaveHelp")}</p>:null}
  </section>;
}
