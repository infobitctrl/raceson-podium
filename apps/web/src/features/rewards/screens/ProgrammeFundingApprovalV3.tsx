import { useEffect, useRef, useState } from "react";
import { decodeProgrammeFundingTermsV3, programmeApprovalMissingSlotsV3, type ProgrammeApprovalViewV3 } from "@raceson/domain/rewards/programme-approval-v3";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { programmeApprovalV3 } from "../data/programmeApprovalV3";
type Request={requestId:string;expectedApprovalId:string|null;contextHash:string;terms:ReturnType<typeof decodeProgrammeFundingTermsV3>};
export default function ProgrammeFundingApprovalV3({record}:{record:SavedRewardPlanningDraft}) {
  const {t,formatDate}=useI18n(),epoch=useRef(0),inFlight=useRef(false);
  const [open,setOpen]=useState(false),[view,setView]=useState<ProgrammeApprovalViewV3|null>(null),[busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false),[pending,setPending]=useState<Request|null>(null),[confirmed,setConfirmed]=useState(false);
  const [funder,setFunder]=useState(""),[operator,setOperator]=useState(""),[hours,setHours]=useState(()=>Array(6).fill("24") as string[]);
  useEffect(()=>()=>{epoch.current++},[]);
  async function load() {
    if(inFlight.current)return;inFlight.current=true;
    const n=++epoch.current;setOpen(true);setBusy(true);setFailed(false);setView(null);setPending(null);setConfirmed(false);
    try {const next=await programmeApprovalV3(record);if(epoch.current!==n)return;
      setView(next);setFunder(next.approval?.terms.funderAddress??"");setOperator(next.approval?.terms.operatorAddress??"");
      setHours(next.approval?.terms.reviewPeriods.map(s=>String(s/3600))??Array(6).fill("24"));
    }catch{if(epoch.current===n)setFailed(true)}finally{if(epoch.current===n){setBusy(false);inFlight.current=false}}
  }
  const current=view?.record.draftId===record.draftId&&view.record.revision===record.revision?view:null;
  let missing:number[]=[1,2,3,4,5],terms:Request["terms"]|null=null;
  try {if(current)missing=programmeApprovalMissingSlotsV3(current.workspace)}catch{/* Invalid mapping is never approvable. */}
  try {if(hours.some(v=>v.trim()===""))throw new Error();terms=decodeProgrammeFundingTermsV3({funderAddress:funder,operatorAddress:operator,
    reviewPeriods:hours.map(h=>Number(h)*3600)})}catch{/* No address/clock coercion into an approvable value. */}
  async function approve() {
    if(inFlight.current||!current||(!pending&&(!terms||missing.length||!confirmed)))return;inFlight.current=true;
    const request=pending??{requestId:crypto.randomUUID(),expectedApprovalId:current.approval?.id??null,contextHash:current.contextHash,terms:terms!};
    const n=++epoch.current;setPending(request);setBusy(true);setFailed(false);
    try {const saved=await programmeApprovalV3(record,request);if(epoch.current!==n)return;setView(saved);setPending(null);setConfirmed(false)}
    catch{if(epoch.current===n)setFailed(true)}finally{if(epoch.current===n){setBusy(false);inFlight.current=false}}
  }
  const label=(slot:number)=>slot===5?t("rewards.fundingV3.league"):t("rewards.fundingV3.round",{round:slot+1});
  return <div id="programme-funding-approval" className="scroll-mt-48 space-y-4 border-t pt-4 sm:scroll-mt-24">
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{t("rewards.approvalV3.title")}</h3>
      <button type="button" className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void load()}>
        {t(open?"rewards.approvalV3.reload":"rewards.approvalV3.open")}</button></div>
    {open?<>
      <p className="text-sm text-muted-foreground">{t("rewards.approvalV3.help")}</p>
      {busy?<p role="status">{t("rewards.loading")}</p>:null}
      {failed?<p role="alert" className="rounded-md border border-destructive p-3 text-sm">{t(pending?"rewards.approvalV3.uncertain":"rewards.approvalV3.error")}</p>:null}
      {current?<>
        <p className="text-sm">{t("rewards.approvalV3.revisions",{rules:current.record.revision,mapping:current.workspace.revision})}</p>
        <ol className="grid gap-2 text-sm sm:grid-cols-2">{current.workspace.mapping.rounds.map(r=><li key={r.slot}>
          {label(r.slot-1)}: {current.workspace.catalogue.rounds.find(c=>c.id===r.roundId)?.name??t("rewards.approvalV3.unmapped")}</li>)}</ol>
        {missing.length?<p className="rounded-md border p-3 text-sm">{t("rewards.approvalV3.missing",{rounds:missing.join(", ")})}</p>:null}
        {current.approval?<div className="rounded-md border p-3 text-sm">
          <p className="font-medium">{t(current.approval.current?"rewards.approvalV3.saved":"rewards.approvalV3.stale")}</p>
          <p className="break-all font-mono text-xs">{current.approval.id}</p>
          <p><time dateTime={current.approval.approvedAt}>{formatDate(current.approval.approvedAt,
            {year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short"})}</time></p></div>:null}
        <fieldset disabled={busy||!!pending} className="space-y-4 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">{t("rewards.approvalV3.funder")}<input value={funder} autoComplete="off" spellCheck={false} onChange={e=>{setFunder(e.target.value);setConfirmed(false)}} className="mt-1 block w-full min-w-0 rounded-md border bg-background p-2 font-mono text-xs"/></label>
            <label className="text-sm">{t("rewards.approvalV3.operator")}<input value={operator} autoComplete="off" spellCheck={false} onChange={e=>{setOperator(e.target.value);setConfirmed(false)}} className="mt-1 block w-full min-w-0 rounded-md border bg-background p-2 font-mono text-xs"/></label>
          </div>
          <p className="text-sm text-muted-foreground">{t("rewards.approvalV3.rolesHelp")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{hours.map((h,slot)=><label key={slot} className="text-sm">{t("rewards.approvalV3.review",{pot:label(slot)})}
            <input type="number" min="0" max="720" step="1" value={h} onChange={e=>{setHours(values=>values.map((v,i)=>i===slot?e.target.value:v));setConfirmed(false)}} className="mt-1 block w-full rounded-md border bg-background p-2"/></label>)}</div>
          <p className="text-sm text-muted-foreground">{t("rewards.approvalV3.reviewHelp")}</p>
          {hours.some(h=>h.trim()!==""&&Number(h)===0)?<p className="rounded-md border p-3 text-sm">{t("rewards.approvalV3.zero")}</p>:null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/>{t("rewards.approvalV3.confirm")}</label>
        </fieldset>
        <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={busy||(!pending&&(!terms||missing.length>0||!confirmed))} onClick={()=>void approve()}>
          {t(pending?"rewards.approvalV3.retry":"rewards.approvalV3.approve")}</button>
      </>:null}
    </>:null}
  </div>;
}
