import { rewardLifecycle, lifecycleCopy } from "../model/rewardLifecycle";
import styles from "./RewardWorkspace.module.css";
import { useEffect, useState } from "react";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import type { AthleteConsentRecordV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getAthletePaymentStatusV3 } from "../data/athletePaymentStatusV3";
import type { AthletePaymentStatusV3 } from "../model/athletePaymentStatusV3";
import { productCopy } from "../model/productCopy";
import ProgrammeAthleteClaimsV3, { type RewardClaimSelection } from "./ProgrammeAthleteClaimsV3";
import RewardExplorerLink from "./RewardExplorerLink";
import { athleteUxCopy } from "../model/athleteUxCopy";

export default function RewardAwardActivity({ award, claims, complete, onRefresh, onAccessLost, rememberedClaim, onSelectClaim, onObservation, compact = false, expanded = true }: {
  compact?: boolean; expanded?: boolean;
  onObservation?: (award: AthleteAllocationV3, binding: string, paid: boolean | null) => void;
  rememberedClaim?: RewardClaimSelection | null; onSelectClaim?: (selection: RewardClaimSelection | null) => void;
  award: AthleteAllocationV3; claims: AthleteConsentRecordV3[]; complete: boolean;
  onRefresh: () => void; onAccessLost: (error: unknown) => void;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale), ux = athleteUxCopy(locale);
  const [observation, setObservation] = useState<{ binding: string; statuses: AthletePaymentStatusV3[] } | null>(null);
  const [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  // Any changed scope or claim history retires every previous observation.
  const binding = JSON.stringify(claims);
  const statuses = observation?.binding === binding ? observation.statuses : null;
  useEffect(() => {
    let active = true; setObservation(null); setFailed(false);
    const fixed = JSON.parse(binding) as AthleteConsentRecordV3[];
    void Promise.all(fixed.map(getAthletePaymentStatusV3)).then(values => { if (active) setObservation({ binding, statuses: values }); })
      .catch(error => { if (active) { setFailed(true); if (error?.status === 401) onAccessLost(error); } });
    return () => { active = false; };
  }, [binding, reload, onAccessLost]);
  const paid = statuses?.find(s => s.confirmed);
  const observedPaid = !failed && statuses ? Boolean(paid) : null;
  useEffect(() => { onObservation?.(award, binding, observedPaid); }, [award, binding, observedPaid, onObservation]);
  const progress = rewardLifecycle(claims, complete, statuses, failed), labels = lifecycleCopy(locale);
  return <div className={compact ? styles.awardActivity : "space-y-3 border-t pt-3"}>
    <div className={compact ? styles.rowStatus : undefined}>
    <dl className={styles.lifecycle} aria-label={locale === "hr" ? "Status nagrade" : "Reward status"}>
      <div><dt>{labels.allocation}</dt><dd>{labels.awarded}</dd></div>
      <div><dt>{labels.claim}</dt><dd>{labels[progress.claim]}</dd></div>
      <div><dt>{labels.payment}</dt><dd data-paid={progress.payment === "paid"}>{labels[progress.payment]}</dd></div>
    </dl>
    {paid?.transactionHash ? <RewardExplorerLink chainId={award.chainId} kind="tx" value={paid.transactionHash}>{ux.viewReceipt}</RewardExplorerLink> : null}
    </div>
    <div hidden={!expanded} className={compact ? styles.awardDetails : "space-y-3"}>
    {paid ? <details className="text-xs"><summary className="cursor-pointer">{t("rewards.payment.title")}</summary>
      <dl className="mt-2 space-y-2"><div><dt>{t("rewards.payment.transaction")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={award.chainId} kind="tx" value={paid.transactionHash}/></dd></div>
        <div><dt>{t("rewards.payment.paymentBlock")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={award.chainId} kind="block" value={paid.blockNumber}/> · <RewardExplorerLink chainId={award.chainId} kind="block" value={paid.blockNumber}>{paid.blockHash}</RewardExplorerLink></dd></div></dl>
      <p className="mt-2">{t("rewards.payment.historical")}</p>
    </details> : null}
    {failed ? <p role="alert" className="text-sm">{copy.unknown}</p> : null}
    {failed ? <Button size="sm" variant="outline" onClick={() => setReload(n => n + 1)}>{copy.retry}</Button> : null}
    {!claims.length ? <p className="text-sm text-muted-foreground">{ux.pendingHelp}</p> : <details open={!paid || rememberedClaim && claims.some(c => c.claimId === rememberedClaim.claimId) ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium">{ux.claimHistory} ({claims.length})</summary>
      {!complete ? <p className="text-sm">{copy.attemptsIncomplete}</p> : null}
      <ProgrammeAthleteClaimsV3 rememberedClaim={rememberedClaim} onSelectClaim={onSelectClaim} embedded allowConsent={complete && !!statuses && !paid && !statuses.some(s => s.readinessHeld || s.state !== "not_prepared")}
        items={claims} awards={[award]} pending={false} refreshing={!statuses && !failed} hasMore={false}
        onRefresh={() => { setReload(n => n + 1); onRefresh(); }} onMore={() => {}} onAccessLost={onAccessLost} />
    </details>}
    </div>
  </div>;
}
