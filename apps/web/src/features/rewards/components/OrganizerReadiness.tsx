import RewardExplorerLink from "./RewardExplorerLink";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOrganizerReadiness, recordOrganizerReview, revokeOrganizerReview } from "../data/organizerRewards";
import { evidenceFields, organizerAccessLost, organizerErrorKey, organizerUuid, reviewDate, revocationReasons,
  type OrganizerReadiness as Context, type OrganizerReview, type OrganizerReviewInput,
  type OrganizerSelection, type RevocationReason } from "../model/organizerRewards";

type Command = { kind: "record"; input: OrganizerReviewInput } | { kind: "revoke"; reviewId: string; reason: RevocationReason };
type View = { phase: "loading" } | { phase: "error"; error: unknown }
  | { phase: "ready"; context: Context } | { phase: "writing"; command: Command }
  | { phase: "uncertain"; command: Command; error: unknown } | { phase: "recorded"; review: OrganizerReview };

export default function OrganizerReadiness({ selection, athleteName, onBack, onAccessLost }: {
  selection: OrganizerSelection; athleteName: string | null; onBack: () => void; onAccessLost: (error: unknown) => void;
}) {
  const { t, locale } = useI18n(), formId = useId();
  const [view, setView] = useState<View>({ phase: "loading" });
  const [dob, setDob] = useState(""), [attested, setAttested] = useState(false), [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [references, setReferences] = useState<Record<typeof evidenceFields[number], string>>({
    identityEvidenceRef: "", adultEvidenceRef: "", walletMfaEvidenceRef: "", walletRecoveryEvidenceRef: "",
  });
  const [reason, setReason] = useState<RevocationReason | "">("");
  const epoch = useRef(0), flight = useRef(false), region = useRef<HTMLElement | null>(null);
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost;
  const load = useCallback(async () => {
    if (flight.current) return;
    const ticket = ++epoch.current; flight.current = true; setView({ phase: "loading" });
    setAttested(false); setDob(""); setRevokeConfirmed(false); setReason("");
    setReferences({ identityEvidenceRef: "", adultEvidenceRef: "", walletMfaEvidenceRef: "", walletRecoveryEvidenceRef: "" });
    try { const context = await getOrganizerReadiness(selection); if (ticket === epoch.current) setView({ phase: "ready", context }); }
    catch (error) { if (ticket === epoch.current) { setView({ phase: "error", error }); if (organizerAccessLost(error)) accessLost.current(error); } }
    finally { if (ticket === epoch.current) flight.current = false; }
  }, [selection]);
  useEffect(() => {
    region.current?.focus(); void load();
    return () => { epoch.current += 1; flight.current = false; };
  }, [load]);
  async function execute(command: Command) {
    if (flight.current) return;
    const ticket = ++epoch.current; flight.current = true; setView({ phase: "writing", command });
    try {
      const review = command.kind === "record" ? await recordOrganizerReview(selection, command.input)
        : await revokeOrganizerReview(selection, command.reviewId, command.reason);
      if (ticket === epoch.current) setView({ phase: "recorded", review });
    } catch (error) { if (ticket === epoch.current) {
      setView({ phase: "uncertain", command, error }); if (organizerAccessLost(error)) accessLost.current(error);
    } } finally { if (ticket === epoch.current) flight.current = false; }
  }
  const context = view.phase === "ready" ? view.context : null;
  const held = !context || ["identity_hold", "age_hold", "request_withdrawn"].includes(context.reviewState);
  const canRecord = !held && context !== null && (context.latestReview?.revision ?? 0) <= 2147483645
    && attested && reviewDate(dob) && dob === context.dateOfBirth && evidenceFields.every(field => organizerUuid(references[field].trim().toLowerCase()));
  const busy = view.phase === "loading" || view.phase === "writing";
  const utc = (value: string) => new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value));
  return <section ref={region} tabIndex={-1} aria-labelledby={`${formId}-title`} className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={`${formId}-title`} className="text-xl font-semibold">{t("rewards.organizer.reviewTitle")}</h2>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{t("rewards.organizer.reloadReview")}</Button>
    </div>
    <p className="break-words text-lg font-medium">{athleteName ?? t("rewards.organizer.athleteFallback")}</p>
    <p className="rounded-lg bg-secondary/60 p-3 text-sm">{t("rewards.organizer.reviewNotice")}</p>
    <dl className="space-y-2 text-sm">
      <div><dt className="text-muted-foreground">{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={selection.address}/></dd></div>
      <div><dt className="text-muted-foreground">{t("rewards.claim.network")}</dt><dd>{t(selection.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")} · {selection.chainId}</dd></div>
    </dl>
    {view.phase === "loading" || view.phase === "writing" ? <p role="status">{t(view.phase === "loading" ? "rewards.loading" : "rewards.organizer.saving")}</p> : null}
    {view.phase === "error" || view.phase === "uncertain" ? <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm">
      <p>{t(organizerErrorKey(view.error))}</p>
      {view.phase === "uncertain" ? <><p>{t("rewards.organizer.uncertain")}</p>
        <Button variant="outline" className="h-auto whitespace-normal" onClick={() => void execute(view.command)}>{t("rewards.organizer.retryDecision")}</Button></> : null}
    </div> : null}
    {view.phase === "recorded" ? <div role="status" className="space-y-2 rounded-lg border border-primary/30 p-4">
      <h3 className="font-semibold">{t(view.review.revokedAt ? "rewards.organizer.revokedSaved" : "rewards.organizer.reviewSaved")}</h3>
      <p className="text-sm">{t("rewards.organizer.savedHelp")}</p>
      <p className="text-sm">{t("rewards.organizer.revision", { revision: view.review.revision })} · {utc(view.review.revokedAt ?? view.review.reviewedAt)} UTC</p>
      <p className="break-all font-mono text-xs">{view.review.reviewId}</p>
    </div> : null}
    {context ? <>
      <div role="status" className="space-y-2 rounded-lg bg-secondary/60 p-4">
        <h3 className="font-semibold">{t(`rewards.organizer.state.${context.reviewState}`)}</h3>
        <p className="text-sm">{t(held ? "rewards.organizer.holdHelp" : "rewards.organizer.evidenceHelp")}</p>
      </div>
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted-foreground">{t("rewards.organizer.profileDob")}</dt><dd>{context.dateOfBirth ?? t("rewards.organizer.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("rewards.organizer.profileYear")}</dt><dd>{context.birthYear ?? t("rewards.organizer.unknown")}</dd></div>
        {context.latestReview ? <div><dt className="text-muted-foreground">{t("rewards.organizer.lastReview")}</dt>
          <dd>{t("rewards.organizer.revision", { revision: context.latestReview.revision })} · {utc(context.latestReview.reviewedAt)} UTC</dd></div> : null}
      </dl>
      {!held ? <form className="space-y-4 border-t border-border pt-5" onSubmit={e => {
        e.preventDefault(); if (!canRecord) return;
        void execute({ kind: "record", input: { expectedProfileFingerprintSha256: context.profileFingerprintSha256,
          expectedRevision: context.latestReview?.revision ?? 0, idempotencyKey: crypto.randomUUID(),
          attestation: { schemaVersion: 1, policy: "operator-observed-external-wallet-v1", verifiedDateOfBirth: dob,
            identityEvidenceRef: references.identityEvidenceRef.trim().toLowerCase(), adultEvidenceRef: references.adultEvidenceRef.trim().toLowerCase(),
            walletMfaEvidenceRef: references.walletMfaEvidenceRef.trim().toLowerCase(), walletRecoveryEvidenceRef: references.walletRecoveryEvidenceRef.trim().toLowerCase() } } });
      }}>
        <h3 className="font-semibold">{t("rewards.organizer.recordTitle")}</h3>
        <div className="space-y-2"><label className="text-sm font-medium" htmlFor={`${formId}-dob`}>{t("rewards.organizer.verifiedDob")}</label>
          <Input id={`${formId}-dob`} type="date" required value={dob} onChange={e => setDob(e.target.value)} />
          {dob && dob !== context.dateOfBirth ? <p className="text-sm text-destructive">{t("rewards.organizer.dobMismatch")}</p> : null}</div>
        <p className="text-sm text-muted-foreground">{t("rewards.organizer.referenceHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">{evidenceFields.map(field => <div key={field} className="min-w-0 space-y-2">
          <label className="text-sm font-medium" htmlFor={`${formId}-${field}`}>{t(`rewards.organizer.evidence.${field}`)}</label>
          <Input id={`${formId}-${field}`} autoComplete="off" required maxLength={36} spellCheck={false} value={references[field]}
            onChange={e => setReferences(prev => ({ ...prev, [field]: e.target.value }))} />
        </div>)}</div>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0 accent-primary" type="checkbox"
          checked={attested} onChange={e => setAttested(e.target.checked)} /><span>{t("rewards.organizer.attest")}</span></label>
        <Button type="submit" className="h-auto whitespace-normal" disabled={!canRecord}>{t("rewards.organizer.record")}</Button>
      </form> : null}
      {context.latestReview && context.latestReview.revokedAt === null ? <form className="space-y-4 border-t border-border pt-5" onSubmit={e => {
        e.preventDefault(); if (!reason || !revokeConfirmed || !context.latestReview) return;
        void execute({ kind: "revoke", reviewId: context.latestReview.reviewId, reason });
      }}>
        <h3 className="font-semibold">{t("rewards.organizer.revokeTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("rewards.organizer.revokeHelp")}</p>
        <div className="space-y-2"><label className="text-sm font-medium" htmlFor={`${formId}-reason`}>{t("rewards.organizer.reason")}</label>
          <select id={`${formId}-reason`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={reason}
            onChange={e => setReason(e.target.value as RevocationReason | "")} required>
            <option value="">{t("rewards.organizer.chooseReason")}</option>
            {revocationReasons.map(reason => <option key={reason} value={reason}>{t(`rewards.organizer.reason.${reason}`)}</option>)}
          </select></div>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0 accent-primary" type="checkbox"
          checked={revokeConfirmed} onChange={e => setRevokeConfirmed(e.target.checked)} /><span>{t("rewards.organizer.confirmRevoke")}</span></label>
        <Button type="submit" variant="destructive" className="h-auto whitespace-normal" disabled={!reason || !revokeConfirmed}>{t("rewards.organizer.revoke")}</Button>
      </form> : null}
    </> : null}
    <details className="rounded-lg border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">{t("rewards.organizer.identifiers")}</summary>
      <dl className="mt-3 space-y-2 break-all font-mono">
        <div><dt>{t("rewards.organizer.programmeId")}</dt><dd>{selection.programmeId}</dd></div>
        <div><dt>{t("rewards.organizer.requestId")}</dt><dd>{selection.requestId}</dd></div>
        <div><dt>{t("rewards.organizer.profileId")}</dt><dd>{selection.athleteProfileId}</dd></div>
      </dl>
    </details>
    <Button variant="ghost" className="h-auto whitespace-normal" onClick={onBack}>{t("rewards.organizer.backRequests")}</Button>
    {view.phase === "writing" || view.phase === "uncertain" ? <p className="text-xs text-muted-foreground">{t("rewards.organizer.leaveHelp")}</p> : null}
  </section>;
}
