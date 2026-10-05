import RewardExplorerLink from "./RewardExplorerLink";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { OrganizerClubAwardScopeV3, OrganizerClubAwardV3, OrganizerClubAwardsV3 as Page } from "@raceson/domain/rewards/organizer-club-awards-v3";
import { getOrganizerClubAwardsV3 } from "../data/organizerClubAwardsV3";
import { getOrganizerClubReadinessV3, makeOrganizerClubPreparationV3, prepareOrganizerClubClaimV3,
  type OrganizerClubSelectionV3, type OrganizerClubPreparationCommandV3, type OrganizerClubReadinessV3 } from "../data/organizerClubPreparationV3";
import { organizerClubCopyV3 } from "../model/organizerClubCopyV3";
import { formatTestMon } from "../model/athleteRewards";
const OrganizerClubReviewV3 = lazy(() => import("./OrganizerClubReviewV3"));

export default function OrganizerClubAwardsV3(props: { context: OrganizerClubAwardScopeV3; dirty: boolean }) {
  // Enclosing planner also keys by authenticated session. Neither an edited
  // allocation nor a later Auth session may inherit an open preparation.
  return <Workspace key={JSON.stringify([props.context,props.dirty])} {...props} />;
}
function Workspace({ context, dirty }: { context: OrganizerClubAwardScopeV3; dirty: boolean }) {
  const { t, locale } = useI18n(), copy = organizerClubCopyV3(locale);
  const [page,setPage] = useState<Page | null>(null), [busy,setBusy] = useState(false), [failed,setFailed] = useState(false);
  const [opened,setOpened] = useState<OrganizerClubAwardV3 | null>(null), epoch = useRef(0), flight = useRef(false);
  useEffect(() => { const v = ++epoch.current; return () => { epoch.current = v + 1; }; }, []);
  async function load(after: string | null = null) {
    if (dirty || flight.current || opened) return;
    const v = epoch.current; flight.current = true; setBusy(true); setFailed(false); setPage(null);
    try { const next = await getOrganizerClubAwardsV3(context,after); if (v === epoch.current) setPage(next); }
    catch { if (v === epoch.current) setFailed(true); }
    finally { if (v === epoch.current) { flight.current = false; setBusy(false); } }
  }
  return <section className="min-w-0 space-y-3 rounded-xl border p-4" aria-label={copy.title}>
    <h3 className="font-semibold">{copy.title}</h3><p className="text-sm text-muted-foreground">{copy.help}</p>
    <Button variant="outline" disabled={busy || dirty || !!opened} onClick={() => void load()}>{page ? copy.refresh : copy.open}</Button>
    {busy ? <p role="status">{t("rewards.loading")}</p> : failed ? <p role="alert">{copy.error}</p> : null}
    {page && !dirty ? <>
      {page.allocationRevision === "superseded" ? <p role="status">{copy.stale}</p> : null}
      {!page.items.length ? <p>{copy.empty}</p> : <ul className="space-y-3">{page.items.map(a => <li key={a.entitlementId} className="min-w-0 space-y-2 rounded-lg border p-3">
        <h4 className="break-words font-medium">{a.clubName ?? copy.unnamed}</h4><p>{formatTestMon(a.amountWei,locale)} {t("rewards.testMon")}</p>
        {!a.nomination ? <p className="text-sm">{copy.noWallet}</p> : <>
          <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={context.chainId} kind="address" value={a.nomination.address}/></p>
          {a.nomination.status !== "pending_review" ? <p className="text-sm">{a.nomination.status === "withdrawn" ? copy.withdrawn : copy.identityHold}</p> : null}
          <Button variant="outline" size="sm" disabled={!!opened || page.allocationRevision !== "latest" || a.nomination.status !== "pending_review"}
            onClick={() => setOpened(a)}>{copy.select}</Button>
        </>}
        {a.claim ? <p className="text-sm">{a.claim.operatorApproved ? copy.approved : a.claim.recipientConsented ? copy.consent : copy.existing}</p> : null}
      </li>)}</ul>}
      {page.nextCursor ? <Button variant="outline" disabled={busy || !!opened} onClick={() => void load(page.nextCursor)}>{copy.more}</Button> : null}
    </> : null}
    {opened && !dirty ? <Preparation key={opened.entitlementId} context={context} award={opened} onClose={() => { setOpened(null); setPage(null); }} /> : null}
  </section>;
}
function Preparation({ context, award, onClose }: { context: OrganizerClubAwardScopeV3; award: OrganizerClubAwardV3; onClose: () => void }) {
  const { t, locale } = useI18n(), copy = organizerClubCopyV3(locale), region = useRef<HTMLElement>(null);
  const [selection] = useState<OrganizerClubSelectionV3>(() => ({ clubId: award.clubId, slot: context.slot, award: {
    chainId: context.chainId, uploadId: context.uploadId, requestId: award.nomination!.requestId,
    claimId: award.claim?.claimId ?? crypto.randomUUID(), entitlementId: award.entitlementId as `0x${string}`,
    campaignAddress: context.campaignAddress as `0x${string}`, recipientAddress: award.nomination!.address as `0x${string}`,
    amountWei: award.amountWei, pot: context.slot === 6 ? "league" : "race" } }));
  const [readiness,setReadiness] = useState<OrganizerClubReadinessV3 | null>(null), [checked,setChecked] = useState(false);
  const [editing,setEditing] = useState(false), [reload,setReload] = useState(0);
  const [busy,setBusy] = useState(true), [failed,setFailed] = useState(false), [uncertain,setUncertain] = useState(false);
  const [record,setRecord] = useState<Awaited<ReturnType<typeof prepareOrganizerClubClaimV3>> | null>(null);
  const epoch = useRef(0), flight = useRef(false), command = useRef<OrganizerClubPreparationCommandV3 | null>(null);
  useEffect(() => {
    region.current?.focus(); const v = ++epoch.current;
    setBusy(true); setFailed(false); setReadiness(null); setChecked(false);
    void getOrganizerClubReadinessV3(selection).then(r => { if (v === epoch.current) setReadiness(r); })
      .catch(() => { if (v === epoch.current) setFailed(true); }).finally(() => { if (v === epoch.current) setBusy(false); });
    return () => { epoch.current = v + 1; command.current = null; };
  }, [selection,reload]);
  async function prepare() {
    if (busy || flight.current || award.claim || (!command.current && (!checked || readiness?.state !== "reviewed"))) return;
    const v = epoch.current; flight.current = true; setBusy(true); setFailed(false); setChecked(false);
    try {
      command.current ??= makeOrganizerClubPreparationV3(selection,readiness);
      const result = await prepareOrganizerClubClaimV3(command.current);
      if (v === epoch.current) { setRecord(result); setUncertain(false); }
    } catch { if (v === epoch.current) { setFailed(true); setUncertain(command.current !== null); setReadiness(null); } }
    finally { if (v === epoch.current) { flight.current = false; setBusy(false); } }
  }
  return <section ref={region} tabIndex={-1} className="min-w-0 space-y-3 rounded-xl border-2 border-primary/30 p-4" aria-label={copy.review}>
    <h4 className="font-semibold">{award.clubName ?? copy.unnamed} · {copy.review}</h4>
    <dl className="space-y-2 text-sm"><div><dt>{copy.amount}</dt><dd className="break-all font-semibold">{formatTestMon(award.amountWei,locale)} {t("rewards.testMon")}</dd></div>
      <div><dt>{copy.network}</dt><dd>{t(context.chainId === 10143 ? "rewards.testnet" : "rewards.simulation")} · {context.chainId}</dd></div>
      <div><dt>{copy.safe}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={context.chainId} kind="address" value={selection.award.recipientAddress}/></dd></div>
      <div><dt>{copy.campaign}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={context.chainId} kind="address" value={context.campaignAddress}/></dd></div></dl>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{uncertain ? copy.uncertain : copy.error}</p> : null}
    {!editing && (record ? <div role="status"><p>{record.operatorApproved ? copy.approved : record.recipientConsented ? copy.consent : copy.recorded}</p>
      <p className="break-all text-xs">{copy.reference}: {record.claimId}</p></div> : award.claim ? <p>{copy.existing}</p> : <>
      {readiness ? <p role="status">{readiness.state === "reviewed" ? copy.ready : readiness.state === "unreviewed" ? copy.unreviewed : copy.held}</p> : null}
      {uncertain ? <Button disabled={busy} onClick={() => void prepare()}>{copy.retry}</Button> : readiness?.state === "reviewed" ? <>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />{copy.confirm}</label>
        <Button disabled={busy || !checked} onClick={() => void prepare()}>{copy.prepare}</Button>
      </> : null}
    </>)}
    {!record && readiness && !uncertain && !busy ? <>
      <Button variant="outline" disabled={editing} onClick={() => {setChecked(false);setEditing(true);}}>{t("rewards.clubReview.reviewTitle")}</Button>
      {editing ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><OrganizerClubReviewV3 selection={selection} readiness={readiness}
        onDone={() => {setEditing(false);setReadiness(null);setReload(n => n + 1);}} /></Suspense> : null}
    </> : null}
    <p className="text-sm text-muted-foreground">{copy.help}</p>
    <Button variant="ghost" disabled={busy && flight.current} onClick={onClose}>{copy.close}</Button>
  </section>;
}
