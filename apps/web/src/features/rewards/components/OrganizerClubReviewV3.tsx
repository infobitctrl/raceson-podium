import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/I18nContext";
import { clubEvidenceFields, clubReviewAddress, clubReviewHash, clubReviewReasons, type ClubReviewReason } from "../model/organizerClubs";
import { rewardUuid } from "../model/athleteRewards";
import { clubObservationInputV3, observeOrganizerClubV3, makeClubReviewCommandV3, makeClubRevocationCommandV3,
  saveOrganizerClubReviewV3, type ClubObservationV3, type ClubReviewCommandV3 } from "../data/organizerClubReviewV3";
import type { OrganizerClubSelectionV3, OrganizerClubReadinessV3 } from "../data/organizerClubPreparationV3";
const empty = () => ({ authorityEvidenceRef: "", controlEvidenceRef: "", recoveryEvidenceRef: "", executionHistoryEvidenceRef: "" });
export default function OrganizerClubReviewV3({ selection, readiness, onDone }: {
  selection: OrganizerClubSelectionV3; readiness: OrganizerClubReadinessV3; onDone: () => void;
}) {
  const { t } = useI18n(), id = useId(), epoch = useRef(0), flight = useRef(false);
  const pending = useRef<ClubReviewCommandV3 | null>(null);
  const [factory,setFactory] = useState(""), [transaction,setTransaction] = useState("");
  const [refs,setRefs] = useState(empty), [attested,setAttested] = useState(false), [confirmed,setConfirmed] = useState(false);
  const [reason,setReason] = useState<ClubReviewReason | "">(""), [preview,setPreview] = useState<ClubObservationV3 | null>(null);
  const [busy,setBusy] = useState(false), [failed,setFailed] = useState(false), [uncertain,setUncertain] = useState(false);
  const [saved,setSaved] = useState<Awaited<ReturnType<typeof saveOrganizerClubReviewV3>> | null>(null);
  useEffect(() => { const v = ++epoch.current; return () => { epoch.current = v + 1; pending.current = null; }; }, []);
  const held = !readiness.sourceCurrent || ["source_hold","identity_hold","request_withdrawn"].includes(readiness.state);
  function invalidate() { setPreview(null); setRefs(empty()); setAttested(false); setFailed(false); }
  async function observe() {
    if (flight.current || held || pending.current || !clubReviewAddress(factory) || !clubReviewHash(transaction)) return;
    const v = epoch.current; flight.current = true; setBusy(true); invalidate();
    try { const p = await observeOrganizerClubV3(selection,clubObservationInputV3(selection,readiness,factory,transaction));
      if (v === epoch.current) setPreview(p);
    } catch { if (v === epoch.current) setFailed(true); }
    finally { if (v === epoch.current) { flight.current = false; setBusy(false); } }
  }
  async function save(revoke = false) {
    if (flight.current || saved) return;
    if (!pending.current && (revoke ? !confirmed || !reason : !preview || !attested || !clubEvidenceFields.every(k => rewardUuid(refs[k])))) return;
    const v = epoch.current; flight.current = true; setBusy(true); setFailed(false);
    try {
      pending.current ??= revoke ? makeClubRevocationCommandV3(selection,readiness,reason as ClubReviewReason)
        : makeClubReviewCommandV3(selection,preview!,refs,crypto.randomUUID());
      const r = await saveOrganizerClubReviewV3(pending.current);
      if (v === epoch.current) { setSaved(r); setUncertain(false); setPreview(null); setRefs(empty()); setAttested(false); }
    } catch { if (v === epoch.current) { setFailed(true); setUncertain(pending.current !== null); } }
    finally { if (v === epoch.current) { flight.current = false; setBusy(false); } }
  }
  const locked = busy || uncertain || saved !== null;
  return <section className="min-w-0 space-y-4 rounded-lg border p-3" aria-label={t("rewards.clubReview.reviewTitle")}>
    <h5 className="font-semibold">{t("rewards.clubReview.reviewTitle")} · V3</h5>
    <p className="text-sm">{t("rewards.clubReview.notice")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t(uncertain ? "rewards.organizer.uncertain" : "rewards.historical.error")}</p> : null}
    {uncertain ? <Button disabled={busy} onClick={() => void save()}>{t("rewards.organizer.retryDecision")}</Button> : null}
    {saved ? <div role="status" className="space-y-2"><p>{t(saved.revokedAt ? "rewards.organizer.revokedSaved" : "rewards.clubReview.saved")}</p>
      <p className="break-all font-mono text-xs">{saved.reviewId}</p><Button onClick={onDone}>{t("rewards.organizer.reloadReview")}</Button></div> : null}
    {!saved && !held ? <fieldset disabled={locked} className="space-y-3">
      <legend>{t("rewards.clubReview.chainTitle")}</legend><p className="text-sm">{t("rewards.clubReview.chainHelp")}</p>
      <label className="block text-sm" htmlFor={`${id}-factory`}>{t("rewards.clubReview.factory")}</label>
      <Input id={`${id}-factory`} autoComplete="off" spellCheck={false} maxLength={42} value={factory} onChange={e => {setFactory(e.target.value.trim().toLowerCase());invalidate();}} />
      <label className="block text-sm" htmlFor={`${id}-tx`}>{t("rewards.clubReview.transaction")}</label>
      <Input id={`${id}-tx`} autoComplete="off" spellCheck={false} maxLength={66} value={transaction} onChange={e => {setTransaction(e.target.value.trim().toLowerCase());invalidate();}} />
      <Button variant="outline" disabled={!clubReviewAddress(factory) || !clubReviewHash(transaction)} onClick={() => void observe()}>{t("rewards.clubReview.observe")}</Button>
      {preview ? <div className="space-y-3">
        <p role="status">{t("rewards.clubReview.observed")}</p><p className="text-sm">{t("rewards.clubReview.historyWarning")}</p>
        <dl className="space-y-2 text-xs"><div><dt>{t("rewards.clubReview.deployedBlock")}</dt><dd className="break-all">{preview.deploymentBlock.number} · {preview.deploymentBlock.hash}</dd></div>
          <div><dt>{t("rewards.clubReview.reviewedBlock")}</dt><dd className="break-all">{preview.reviewedBlock.number} · {preview.reviewedBlock.hash}</dd></div>
          {preview.candidate.owners.map((owner,i) => <div key={owner}><dt>{t("rewards.clubReview.owner",{number:i+1})}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.award.chainId} kind="address" value={owner}/></dd></div>)}</dl>
        <p className="text-sm">{t("rewards.organizer.referenceHelp")}</p>
        {clubEvidenceFields.map(k => <div key={k}><label className="text-sm" htmlFor={`${id}-${k}`}>{t(`rewards.clubReview.evidence.${k}`)}</label>
          <Input id={`${id}-${k}`} value={refs[k]} autoComplete="off" spellCheck={false} maxLength={36}
            onChange={e => {setRefs(p => ({...p,[k]:e.target.value.trim().toLowerCase()}));setAttested(false);}} /></div>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />{t("rewards.clubReview.attest")}</label>
        <Button disabled={!attested || !clubEvidenceFields.every(k => rewardUuid(refs[k]))} onClick={() => void save()}>{t("rewards.clubReview.record")}</Button>
      </div> : null}
    </fieldset> : null}
    {!saved && readiness.reviewId && !readiness.revokedAt ? <fieldset disabled={locked} className="space-y-3 border-t pt-3">
      <legend>{t("rewards.organizer.revokeTitle")}</legend>
      <label className="block text-sm" htmlFor={`${id}-reason`}>{t("rewards.organizer.reason")}</label>
      <select className="w-full rounded border bg-background p-2" id={`${id}-reason`} value={reason} onChange={e => {setReason(e.target.value as ClubReviewReason);setConfirmed(false);}}>
        <option value="">{t("rewards.organizer.chooseReason")}</option>{clubReviewReasons.map(r => <option key={r} value={r}>{t(`rewards.clubReview.reason.${r}`)}</option>)}</select>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("rewards.organizer.confirmRevoke")}</label>
      <Button variant="destructive" disabled={!reason || !confirmed} onClick={() => void save(true)}>{t("rewards.organizer.revoke")}</Button>
    </fieldset> : null}
  </section>;
}
