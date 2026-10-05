import RewardExplorerLink from "./RewardExplorerLink";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClubAllocationV3 } from "@raceson/domain/rewards/club-allocations-v3";
import type { ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOwnClubAllocationsV3 } from "../data/clubAllocationsV3";
import { clubAccessLost, clubTreasuryErrorKey } from "../model/clubTreasuries";
import { productCopy } from "../model/productCopy";
import RewardAmount from "./RewardAmount";
const Consent = lazy(() => import("./ClubConsentV3"));

// The parent keys this by club and remounts on every Auth session change.
export default function ProgrammeClubAllocationsV3({ clubId, onAccessLost }: { clubId: string; onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n(), copy = productCopy(locale);
  const [chainId, setChainId] = useState<31337 | 10143 | null>(null), [opened, setOpened] = useState<string | null>(null);
  const [view, setView] = useState<{ items: ClubAllocationV3[]; next: string | null; loading: boolean; error: unknown }>({ items: [], next: null, loading: true, error: null });
  const epoch = useRef(0), flight = useRef(false), lost = useRef(onAccessLost); lost.current = onAccessLost;
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return;
    const ticket = ++epoch.current; flight.current = true;
    setOpened(null);
    setView(old => ({ items: after ? old.items : [], next: null, loading: true, error: null }));
    try {
      const page = await getOwnClubAllocationsV3(clubId, after);
      if (ticket === epoch.current) { setChainId(page.chainId); setView(old => ({ items: after ? [...old.items, ...page.items] : page.items, next: page.nextCursor, loading: false, error: null })); }
    } catch (error) {
      if (ticket === epoch.current) {
        setView({ items: [], next: null, loading: false, error });
        if (clubAccessLost(error)) lost.current(error);
      }
    } finally { if (ticket === epoch.current) flight.current = false; }
  }, [clubId]);
  useEffect(() => { void load(); return () => { epoch.current++; flight.current = false; }; }, [load]);
  const ordered = [...view.items].sort((a, b) => a.draftId.localeCompare(b.draftId) || a.slot - b.slot || a.entitlementId.localeCompare(b.entitlementId));
  function selection(award: ClubAllocationV3): ClubConsentSelectionV3 | null {
    if (!chainId || view.loading || view.error || award.allocationRevision !== "latest" || award.claimAccess !== "available"
      || !award.uploadId || !award.claim || award.claim.recipientConsented || award.payment) return null;
    return { chainId, uploadId: award.uploadId, requestId: award.claim.requestId, claimId: award.claim.claimId,
      entitlementId: award.entitlementId as `0x${string}`, campaignAddress: award.campaignAddress as `0x${string}`,
      recipientAddress: award.claim.recipientAddress as `0x${string}`, amountWei: award.amountWei, pot: award.slot === 6 ? "league" : "race" };
  }
  const selectedAward = view.items.find(a => a.entitlementId === opened), active = selectedAward ? selection(selectedAward) : null;
  return <section className="space-y-3" aria-label={copy.clubProgrammeAwards}>
    <p className="text-sm text-muted-foreground">{copy.clubProgrammeHelp}</p>
    <Button variant="outline" disabled={view.loading} onClick={() => void load()}>{copy.clubRefresh}</Button>
    {view.loading ? <p role="status">{t("rewards.loading")}</p> : view.error ? <p role="alert">{t(clubTreasuryErrorKey(view.error))}</p>
      : view.items.length === 0 ? <p>{copy.clubNoAwards}</p> : null}
    <ul className="grid gap-3 sm:grid-cols-2">{ordered.map(award => <li key={award.entitlementId} className="min-w-0 space-y-3 rounded-xl border border-border p-4">
      <h4 className="font-semibold">{t(award.slot === 6 ? "rewards.claimV3.league" : "rewards.athleteV3.round", { round: award.slot })}</h4>
      <RewardAmount wei={award.amountWei} className="text-xl font-semibold" />
      <p className="text-sm font-medium">{award.allocationRevision === "superseded" ? copy.clubSuperseded : copy.clubLatest}</p>
      {award.sourceKind === "synthetic_rehearsal" ? <p className="text-xs">{copy.clubSynthetic}</p> : null}
      <p className="text-sm">{award.payment?.confirmed ? copy.clubPaid : award.payment ? `${copy.clubPending}: ${copy.clubPaymentStates[award.payment.state]}` : copy.clubNotPrepared}</p>
      {award.claimAccess === "organizer_required" ? <p className="text-xs">{copy.clubOwnerReview}</p>
        : award.claim?.recipientConsented ? <p className="text-xs">{copy.clubConsentRecorded}</p>
          : <p className="text-xs">{copy.clubConsentNeeded}</p>}
      <details className="text-xs"><summary className="cursor-pointer">{copy.clubEvidence}</summary>
        <dl className="mt-2 space-y-2 break-all font-mono">
          <div><dt>{t("rewards.athleteV3.allocation")}</dt><dd>{award.entitlementId}</dd></div>
          <div><dt>{t("rewards.athleteV3.vault")}</dt><dd><RewardExplorerLink chainId={chainId ?? 0} kind="address" value={award.campaignAddress}/></dd></div>
          {award.payment ? <div><dt>{t("rewards.claim.destination")}</dt><dd><RewardExplorerLink chainId={chainId ?? 0} kind="address" value={award.payment.recipientAddress}/></dd></div> : null}
          {award.payment?.transactionHash ? <div><dt>{t("rewards.payment.transaction")}</dt><dd>{award.payment.transactionHash}</dd></div> : null}
          {award.payment?.confirmed ? <div><dt>{t("rewards.payment.paymentBlock")}</dt><dd>{award.payment.blockNumber} · {award.payment.blockHash}</dd></div> : null}
        </dl>
      </details>
      {selection(award) ? <Button variant="outline" onClick={() => setOpened(award.entitlementId)}>{copy.clubSigning.open}</Button> : null}
    </li>)}</ul>
    {view.next ? <Button variant="outline" disabled={view.loading} onClick={() => void load(view.next)}>{t("rewards.loadMore")}</Button> : null}
    {active ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Consent key={`${clubId}:${JSON.stringify(active)}`} selection={active}
      onAccessLost={onAccessLost} onClose={() => setOpened(null)} onRecorded={() => { setOpened(null); void load(); }} /></Suspense> : null}
  </section>;
}
