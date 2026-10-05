import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CANARY_CONNECTIVITY_TX, contractCanaryPlan, type CanaryStatus } from "@raceson/domain/rewards/canary";
import { finalResultsCanaryPlan, type FinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";
import { publicEnv } from "@/lib/public-env";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getCanaryStatus, getFinalResultsCanaryStatus } from "../data/canaryStatus";
import styles from "./ContractCanary.module.css";

const explorer = "https://testnet.monadvision.com";
const stateKeys = ["funding", "review", "staged", "active", "closed", "cancelled"] as const;
const counterKeys = ["fundedWei", "allocatedWei", "paidWei", "returnedWei", "balanceWei"] as const;

// Keep integer precision and every fractional digit; these are balances, not
// rounded estimates. No wallet/chain runtime is imported into this screen.
function mon(wei: string, localeTag: string) {
  const amount = BigInt(wei), scale = 10n ** 18n;
  const fraction = (amount % scale).toString().padStart(18, "0").replace(/0+$/, "");
  const separator = new Intl.NumberFormat(localeTag).formatToParts(1.1).find(p => p.type === "decimal")?.value ?? ".";
  return `${new Intl.NumberFormat(localeTag).format(amount / scale)}${fraction ? separator + fraction : ""}`;
}

export default function ContractCanary() {
  const [variant, setVariant] = useState<"v3" | "v2">("v3");
  // A version switch remounts the observer, clears all prior values immediately,
  // and aborts its request. Old V2 data cannot appear beneath a V3 heading.
  return <ContractObservation key={variant} variant={variant} onSelect={setVariant} />;
}

function ContractObservation({ variant, onSelect }: { variant: "v3" | "v2"; onSelect: (variant: "v3" | "v2") => void }) {
  const { t, localeTag, formatDate, formatNumber } = useI18n();
  const plan = variant === "v3" ? finalResultsCanaryPlan : contractCanaryPlan;
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<CanaryStatus | FinalResultsCanaryStatus | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const enabled = publicEnv.rewardDemo?.chainId === 10143;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setStatus(null); setPhase("loading");
    // Bound the entire request, including a stalled body read. Abort cleanup also
    // prevents an older response from restoring success after a refresh/unmount.
    const timeout = window.setTimeout(() => { controller.abort(); setStatus(null); setPhase("error"); }, 35_000);
    const read = variant === "v3" ? getFinalResultsCanaryStatus : getCanaryStatus;
    void read(controller.signal).then(value => {
      if (!controller.signal.aborted) { setStatus(value); setPhase("ready"); }
    }).catch(() => {
      if (!controller.signal.aborted) { setStatus(null); setPhase("error"); }
    }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [enabled, revision, variant]);
  const amount = (wei: string) => t("rewards.programme.amount", { amount: mon(wei, localeTag) });
  const plannedAmount = (value: string) => t("rewards.programme.amount", { amount: formatNumber(Number(value), { maximumFractionDigits: 3 }) });
  const date = (seconds: string) => formatDate(Number(seconds) * 1000, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zagreb" });
  const contract = status?.contract;
  return <div className={styles.page}><div className={styles.container}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>{t("rewards.canary.network")}</p>
        <h1>{t("rewards.canary.title")}</h1><p>{t("rewards.canary.intro")}</p></div>
      <button disabled={!enabled || phase === "loading"} onClick={() => { setStatus(null); setPhase("loading"); setRevision(r => r + 1); }}>{t("rewards.canary.refresh")}</button>
    </header>
    <div className={styles.scopeStrip}>
      <div><strong>{t("rewards.visual.live")}</strong><p>{t("rewards.visual.liveHelp")}</p></div>
      <Link to="/rewards">{t("rewards.visual.planLink")}</Link>
    </div>
    <div className={styles.selector} role="group" aria-label={t("rewards.canary.chooseTrial")}>
      {(["v3", "v2"] as const).map(value => <button key={value} aria-pressed={variant === value} onClick={() => onSelect(value)}>
        {t(`rewards.canary.variant.${value}`)}
      </button>)}
    </div>
    <p className={styles.help}>{t(variant === "v3" ? "rewards.canary.v3Policy" : "rewards.canary.v2Policy")}</p>
    {!enabled ? <p role="alert" className={styles.alert}>{t("rewards.canary.wrongMode")}</p> : <>
      <div aria-live="polite" aria-atomic="true" className={styles.observation}>
        {phase === "loading" ? <p role="status">{t("rewards.canary.loading")}</p> : null}
        {phase === "error" ? <p role="alert">{t("rewards.canary.error")}</p> : null}
        {status ? <p>{t("rewards.canary.observed", { block: status.observedBlock.number, date: date(status.observedBlock.timestamp) })}</p> : null}
      </div>
      {status ? <section className={styles.contract} aria-labelledby="canary-contract"><h2 id="canary-contract">{t("rewards.canary.contract")}</h2>
        {!contract ? <><p className={styles.state}>{t(status.deployment === "absent" ? "rewards.canary.absent" : "rewards.canary.unverified")}</p>
          <p className={styles.help}>{t("rewards.canary.noContractHelp")}</p></> : <>
          <p className={styles.state}>{t(`rewards.canary.state.${stateKeys[contract.state]}`)}{contract.paused ? ` · ${t("rewards.canary.paused")}` : ""}</p>
          <dl className={styles.counters}>{counterKeys.map(key => <div key={key}><dt>{t(`rewards.canary.${key}`)}</dt><dd>{amount(contract[key])}</dd></div>)}</dl>
          {"allocationApprovedAt" in contract ? <section aria-label={t("rewards.visual.journey")}>
            <h3>{t("rewards.visual.journey")}</h3>
            <ol className={styles.journey}>{([
              ["published", Boolean(contract.officialPublishedAt)],
              ["approved", Boolean(contract.allocationApprovedAt)],
              ["activated", contract.state === 3 && !contract.paused],
              ["consent", null],
              ["payment", BigInt(contract.paidWei) > 0n],
            ] as const).map(([step, confirmed]) => <li key={step} data-confirmed={confirmed === true}>
              <strong>{t(`rewards.visual.${step}`)}</strong>
              <span>{t(confirmed === null ? "rewards.visual.perRecipient" : confirmed ? "rewards.visual.recorded" : "rewards.visual.notConfirmed")}</span>
            </li>)}</ol>
            <p className={styles.help}>{t("rewards.visual.journeyHelp")}</p>
          </section> : null}
          <p className={styles.help}>{t("rewards.canary.verifiedHelp")}</p>
          <a className={styles.address} href={`${explorer}/address/${contract.address}`} target="_blank" rel="noopener noreferrer">{contract.address}</a>
          <p><a href={`${explorer}/tx/${contract.transactionHash}`} target="_blank" rel="noopener noreferrer">{t("rewards.canary.deploymentReceipt")}</a></p>
          {"reviewDeadline" in contract ? <>
            <p>{contract.reviewDeadline ? t("rewards.canary.reviewWindow", { start: date(contract.reviewStartedAt!), end: date(contract.reviewDeadline) }) : t("rewards.canary.reviewNotStarted")}</p>
            <p className={styles.help}>{t("rewards.canary.reviewHelp")}</p>
          </> : <>
            <p>{contract.allocationApprovedAt ? t("rewards.canary.v3Approved", {
              published: date(contract.officialPublishedAt!), approved: date(contract.allocationApprovedAt),
            }) : t("rewards.canary.v3NotApproved")}</p>
            <p className={styles.help}>{t("rewards.canary.v3Trust")}</p>
          </>}
        </>}
      </section> : null}
      {status ? <section className={styles.walletSection} aria-labelledby="canary-wallets"><h2 id="canary-wallets">{t("rewards.canary.wallets")}</h2>
        <p className={styles.help}>{t("rewards.canary.walletHelp")}</p>
        <div className={styles.wallets}>{status.wallets.map(wallet => <article key={wallet.role} className={styles.card}>
          <h3>{t(`rewards.canary.${wallet.role}`)}</h3><p className={styles.amount}>{amount(wallet.balanceWei)}</p>
          <a className={styles.address} href={`${explorer}/address/${wallet.address}`} target="_blank" rel="noopener noreferrer">{wallet.address}</a>
        </article>)}</div>
      </section> : null}
    </>}
    <div className={styles.plans}>
      <section className={styles.card} aria-labelledby="canary-plan"><p className={styles.eyebrow}>{t("rewards.canary.proposal")}</p>
        <h2 id="canary-plan">{t("rewards.canary.smallTrial", { amount: formatNumber(Number(plan.budgetMON)) })}</h2>
        <p className={styles.help}>{t("rewards.canary.trialHelp")}</p>
        <dl className={styles.split}>
          <div><dt>{t("rewards.canary.claimPlan")}</dt><dd>{plannedAmount(plan.singleClaimMON)}</dd></div>
          <div><dt>{t("rewards.canary.reservePlan")}</dt><dd>{plannedAmount(plan.walletlessReserveMON)}</dd></div>
          <div><dt>{t("rewards.canary.unallocatedPlan")}</dt><dd>{plannedAmount(plan.unallocatedMON)}</dd></div>
        </dl><p className={styles.help}>{t("rewards.canary.executionBoundary")}</p>
      </section>
      <section className={styles.card} aria-labelledby="canary-programme"><p className={styles.eyebrow}>{t("rewards.canary.separatePlan")}</p>
        <h2 id="canary-programme">{t("rewards.canary.programmeBudget", { amount: formatNumber(100_000) })}</h2>
        <p className={styles.help}>{t("rewards.canary.programmeHelp")}</p>
        <Link to="/rewards">{t("rewards.canary.openPlan")}</Link>
      </section>
    </div>
    <footer className={styles.footer}><div><h2>{t("rewards.canary.connectivity")}</h2><p>{t("rewards.canary.connectivityHelp")}</p>
      <a href={`${explorer}/tx/${CANARY_CONNECTIVITY_TX}`} target="_blank" rel="noopener noreferrer">{t("rewards.canary.connectivityReceipt")}</a></div>
      <Link to="/athlete/rewards">{t("rewards.programme.myRewards")}</Link>
    </footer>
  </div></div>;
}
