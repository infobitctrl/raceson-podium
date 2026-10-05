import editorial from "./RewardEditorial.module.css";
import { lazy, Suspense, useMemo, useState } from "react";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import type { AthleteConsentRecordV3, AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { athleteUxCopy } from "../model/athleteUxCopy";
import RewardExplorerLink from "./RewardExplorerLink";

export type RewardClaimSelection = { claimId: string; mode: "consent" | "payment" };
const Detail = lazy(() => import("./ProgrammeAthleteClaimDetailV3"));
export default function ProgrammeAthleteClaimsV3({ items, awards, pending, refreshing, hasMore, onRefresh, onMore, onAccessLost, embedded = false, allowConsent = true, rememberedClaim, onSelectClaim }: {
  rememberedClaim?: RewardClaimSelection | null; onSelectClaim?: (selection: RewardClaimSelection | null) => void;
  embedded?: boolean; allowConsent?: boolean;
  items: AthleteConsentRecordV3[]; awards: AthleteAllocationV3[]; pending: boolean; refreshing: boolean; hasMore: boolean;
  onRefresh: () => void; onMore: () => void; onAccessLost: (error: unknown) => void;
}) {
  const { t, locale } = useI18n(), copy = athleteUxCopy(locale);
  const [localOpened, setLocalOpened] = useState<RewardClaimSelection | null>(null);
  const opened = rememberedClaim === undefined ? localOpened : rememberedClaim;
  const setOpened = (value: RewardClaimSelection | null) => { setLocalOpened(value); onSelectClaim?.(value); };
  const byAward = useMemo(() => new Map(awards.map(a => [a.entitlementId, a])), [awards]);
  function selection(claim: AthleteConsentRecordV3): AthleteConsentSelectionV3 | null {
    const award = byAward.get(claim.entitlementId);
    const synthetic = award?.ageStatus === "synthetic_test" && award.chainId === 10143
      && award.draftId === "9a000000-0000-4000-8000-000000000052"
      && ["9a000000-0000-4000-8000-000000001060", "9a000000-0000-4000-8000-000000001061"].includes(award.athleteProfileId);
    if (!allowConsent || !award || award.chainId !== claim.chainId || award.amountWei !== claim.amountWei
      || award.ageStatus !== "unverified_adult" && !synthetic) return null;
    return { chainId: claim.chainId, uploadId: claim.uploadId, destinationId: claim.destinationId, claimId: claim.claimId,
      entitlementId: claim.entitlementId, recipientAddress: claim.recipientAddress, amountWei: claim.amountWei,
      campaignAddress: award.campaignAddress as `0x${string}`, pot: award.slot === 6 ? "league" : "race" };
  }
  const claim = opened ? items.find(i => i.claimId === opened.claimId) : undefined;
  const selected = claim ? selection(claim) : null;
  return <section className="space-y-4" aria-label={t("rewards.claimV3.title")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!embedded ? <h2 className="text-lg font-semibold">{t("rewards.claimV3.title")}</h2> : null}
      <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>{t("rewards.claim.refresh")}</Button>
    </div>
    {!embedded ? <p className="text-sm text-muted-foreground">{copy.claimHelp}</p> : null}
    {pending ? <p role="status">{t("rewards.loading")}</p> : items.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm">{t("rewards.claim.empty")}</p>
      : <ul className="space-y-3">{items.map(item => {
        const award = byAward.get(item.entitlementId);
        return <li key={item.claimId} className={`${editorial.claim} space-y-3`}>
          {!embedded ? <p className="font-semibold">{award ? t(award.slot === 6 ? "rewards.claimV3.league" : "rewards.athleteV3.round", { round: award.slot }) : t("rewards.claimV3.title")}</p> : null}
          {!embedded ? <p className={editorial.awardAmount}>{formatTestMon(item.amountWei, locale)} <span className="text-sm">{t("rewards.testMon")}</span></p> : null}
          <p className="text-xs">{t(item.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")}</p>
          <p className="text-sm">{item.recipientConsented ? copy.claimSaved : selection(item) ? copy.claimReady : copy.claimReview}</p>
          <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={item.chainId} kind="address" value={item.recipientAddress}/></p>
          {allowConsent && !selection(item) ? <p className="text-sm text-muted-foreground">{t("rewards.claimV3.unmatched")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {!item.recipientConsented && selection(item) ? <Button size="sm" onClick={() => setOpened({ claimId: item.claimId, mode: "consent" })}>{copy.claim}</Button> : null}
            <Button size="sm" variant="outline" onClick={() => setOpened({ claimId: item.claimId, mode: "payment" })}>{t("rewards.payment.title")}</Button>
          </div>
        </li>;
      })}</ul>}
    {hasMore ? <Button variant="outline" disabled={refreshing} onClick={onMore}>{t("rewards.claim.more")}</Button> : null}
    {claim && opened && (opened.mode === "payment" || selected) ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
      <Detail key={JSON.stringify([claim.claimId, claim.issuedAt, claim.expiresAt, claim.chainId, claim.uploadId, claim.destinationId,
        claim.entitlementId, claim.recipientAddress, claim.amountWei, opened.mode, selected])} claim={claim} selection={selected} mode={opened.mode}
        onRecorded={onRefresh} onAccessLost={onAccessLost} onClose={() => setOpened(null)} />
    </Suspense> : null}
  </section>;
}
