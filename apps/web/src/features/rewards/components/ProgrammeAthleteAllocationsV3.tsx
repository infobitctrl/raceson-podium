import { rewardOrigin } from "../model/rewardOrigin";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./RewardWorkspace.module.css";
import { roundedRewardAmount } from "../model/rewardDisplayAmount";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import RewardExplorerLink from "./RewardExplorerLink";
import { athleteUxCopy } from "../model/athleteUxCopy";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AthleteConsentRecordV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import RewardAmount from "./RewardAmount";
import RewardAwardBreakdownV3 from "./RewardAwardBreakdownV3";
import type { RewardClaimSelection } from "./ProgrammeAthleteClaimsV3";
import RewardAwardActivity from "./RewardAwardActivity";
import { productCopy } from "../model/productCopy";

export default function ProgrammeAthleteAllocationsV3({ items, pending, hasMore = false, claims, claimsComplete = false, onRefresh = () => {}, onAccessLost = () => {}, rememberedClaim, onSelectClaim, onObservation }: {
  onObservation?: (award: AthleteAllocationV3, binding: string, paid: boolean | null) => void;
  rememberedClaim?: RewardClaimSelection | null; onSelectClaim?: (selection: RewardClaimSelection | null) => void;
  claims?: AthleteConsentRecordV3[]; claimsComplete?: boolean; onRefresh?: () => void; onAccessLost?: (error: unknown) => void;
  items: AthleteAllocationV3[]; pending: boolean; hasMore?: boolean;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale);
  // The API's entitlement order is a pagination contract, not race order.
  // Sort a copy for presentation; never mutate query pages or their cursors.
  const [sort, setSort] = useState("programme");
  const orderedItems = [...items].sort((a, b) => {
    let compared = 0;
    if (sort === "highest" || sort === "lowest") {
      const left = BigInt(a.amountWei), right = BigInt(b.amountWei);
      compared = left === right ? 0 : left < right ? -1 : 1;
      if (sort === "highest") compared *= -1;
    } else if (sort === "newest") compared = Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
    return compared || a.draftId.localeCompare(b.draftId) || a.slot - b.slot
      || a.athleteProfileId.localeCompare(b.athleteProfileId) || a.entitlementId.localeCompare(b.entitlementId);
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(rememberedClaim ? items.filter(a => claims?.some(c => c.claimId === rememberedClaim.claimId && c.entitlementId === a.entitlementId)).map(a => a.entitlementId) : []));
  const toggle = (id: string) => setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <section className={styles.rewardLedger} aria-labelledby="programme-athlete-allocations-title">
    <div className={styles.sectionHeading}><h2 id="programme-athlete-allocations-title">{locale === "hr" ? "Moje nagrade" : "Your rewards"}</h2><div className={styles.ledgerControls}><span className={styles.muted}>test MON</span>{items.length > 1 ? <label className={styles.ledgerSort}>{locale === "hr" ? "Poredaj nagrade" : "Sort rewards"}<select value={sort} onChange={event => setSort(event.target.value)}>
      <option value="programme">{locale === "hr" ? "Program i kolo" : "Programme and round"}</option>
      <option value="highest">{locale === "hr" ? "Najveći iznos" : "Amount: high to low"}</option>
      <option value="lowest">{locale === "hr" ? "Najmanji iznos" : "Amount: low to high"}</option>
      <option value="newest">{locale === "hr" ? "Najnovije dodijeljene" : "Newest awarded"}</option>
    </select></label> : null}</div></div>
    {hasMore && items.length > 1 ? <p className={styles.smallNote}>{locale === "hr" ? "Poredak uključuje učitane nagrade. Učitajte još za potpuni pregled." : "Sorting includes loaded rewards. Load more for the complete list."}</p> : null}
    {pending ? <p role="status">{t("rewards.loading")}</p> : items.length === 0
      ? <p className={styles.ledgerEmpty}>{t("rewards.athleteV3.empty")}</p>
      : <ul>{orderedItems.map(award => {
        const open = expanded.has(award.entitlementId), amount = roundedRewardAmount(award.amountWei, locale);
        const origin = rewardOrigin(award, locale);
        const title = origin.event ?? t(award.slot === 6 ? "rewards.claimV3.league" : "rewards.athleteV3.round", { round: award.slot });
        return <li key={award.entitlementId} className={styles.awardRow} data-pot={award.slot === 6 ? "league" : "race"}>
          <button className={styles.awardToggle} aria-expanded={open} onClick={() => toggle(award.entitlementId)} aria-label={`${title} · ${locale === "hr" ? "Detalji" : "Details"}`}>
            <span className={styles.awardLabel}><span className={styles.awardIndex}>{award.slot === 6 ? "L" : String(award.slot).padStart(2, "0")}</span><span className={styles.awardOrigin}><span>{title}</span><small>{origin.programme} · {origin.pot}</small>{origin.synthetic ? <small>{locale === "hr" ? "Testna raspodjela" : "Test distribution"}</small> : null}</span></span>
            <strong>{amount.approximate && !amount.text.startsWith("<") ? "≈ " : ""}{amount.text}</strong><ChevronDown size={17} className={open ? styles.rotated : undefined} aria-hidden="true" />
          </button>
          {claims ? <RewardAwardActivity compact expanded={open} onObservation={onObservation} rememberedClaim={rememberedClaim} onSelectClaim={onSelectClaim} award={award} claims={claims.filter(c => c.entitlementId === award.entitlementId && c.chainId === award.chainId && c.amountWei === award.amountWei)} complete={claimsComplete} onRefresh={onRefresh} onAccessLost={onAccessLost} /> : <p className={styles.rowStatus}>{t("rewards.athleteV3.recorded")}</p>}
          <div hidden={!open} className={styles.awardDetails}>
            <dl className={styles.originDetails} aria-label={locale === "hr" ? "Izvor nagrade" : "Reward origin"}>
              <div><dt>{locale === "hr" ? "Program" : "Programme"}</dt><dd>{origin.programme}</dd></div>
              <div><dt>{locale === "hr" ? "Fond" : "Pot"}</dt><dd>{origin.pot}</dd></div>
              {origin.host ? <div><dt>{locale === "hr" ? "Organizator" : "Host"}</dt><dd>{origin.host}</dd></div> : null}
              {origin.event ? <div><dt>{locale === "hr" ? "Događaj" : "Event"}</dt><dd>{origin.event}{origin.date ? ` · ${origin.date}` : ""}</dd></div> : null}
              {!origin.event && award.slot !== 6 ? <div><dt>{locale === "hr" ? "Događaj" : "Event"}</dt><dd>{origin.synthetic ? (locale === "hr" ? "Testno kolo" : "Synthetic test round") : (locale === "hr" ? "Naziv događaja nije spremljen uz odobrenje." : "Event name was not captured with this approval.")}</dd></div> : null}
            </dl>
            <RewardAmount wei={award.amountWei} className="text-xl font-semibold" />
            {award.sourceKind === "synthetic_rehearsal" || award.ageStatus === "synthetic_test" || award.breakdown?.sourceKind === "synthetic_rehearsal" ? <p className={styles.smallNote}>{t("rewards.athleteV3.synthetic")}</p> : null}
            {award.breakdown ? <RewardAwardBreakdownV3 breakdown={award.breakdown} /> : null}
            {!claims ? <p className={styles.muted}>{t("rewards.athleteV3.notPayable")} {t(award.ageStatus === "synthetic_test" ? "rewards.hold.syntheticTest" : award.ageStatus === "minor" ? "rewards.hold.minor" : award.ageStatus === "unknown" ? "rewards.hold.unknownAge" : "rewards.hold.ageReview")}</p> : null}
            {claims && (award.ageStatus === "minor" || award.ageStatus === "unknown") ? <p className="text-sm">{t(award.ageStatus === "minor" ? "rewards.hold.minor" : "rewards.hold.unknownAge")}</p> : null}
            <details className={styles.disclosure}><summary>{athleteUxCopy(locale).rewardDetails}</summary><dl className="mt-3 space-y-2 text-xs">
              <div><dt>{locale === "hr" ? "ID programa" : "Programme ID"}</dt><dd className="break-all font-mono">{award.draftId}</dd></div>
              <div><dt>{copy.profile}</dt><dd className="break-all font-mono">{award.athleteProfileId}</dd></div>
              <div><dt>{copy.source}</dt><dd>{award.breakdown ? copy.sourceApproved : copy.sourceUnavailable}</dd></div>
              <div><dt>{t("rewards.athleteV3.vault")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={award.chainId} kind="address" value={award.campaignAddress}/></dd></div>
              <div><dt>{t("rewards.athleteV3.allocation")}</dt><dd className="break-all font-mono">{award.entitlementId}</dd></div>
              <div><dt>{t("rewards.athleteV3.approval")}</dt><dd className="break-all font-mono">{award.approvalId}</dd></div>
            </dl></details>
          </div>
        </li>;
      })}</ul>}
  </section>;
}
