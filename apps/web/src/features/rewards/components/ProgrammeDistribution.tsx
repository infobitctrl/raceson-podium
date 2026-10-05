import { lazy, Suspense } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { programmePath, type ProgrammeNode, type ProgrammeOverview } from "../model/programmeOverview";
import styles from "../screens/RewardProgramme.module.css";

const ProgrammeFlowChart = lazy(() => import("./ProgrammeFlowChart"));

export type ProgrammeSelectionProps = {
  selected: string; onSelect: (id: string) => void; programme: ProgrammeOverview;
};

/** Labels are separate from proportional marks so zero and tiny pots stay reachable. */
export default function ProgrammeDistribution({ selected, onSelect, programme }: ProgrammeSelectionProps) {
  const { t, locale } = useI18n();
  const label = (node: ProgrammeNode) => node.name ?? t(node.labelKey);
  const amount = (value: bigint) => t("rewards.programme.amount", { amount: value === 0n ? "0" : formatTestMon(value.toString(), locale) });
  const share = (value: bigint) => Number(value * 10_000n / programme.budgetWei) / 100;
  const path = programmePath(selected, programme);
  const pots = [programme.byId.get("league")!, programme.byId.get("race")!];
  const rounds = programme.byId.get("race")!.children.map(id => programme.byId.get(id)!);
  return <section className={styles.distribution} aria-labelledby="programme-tree-heading">
    <div className={styles.distributionHeading}>
      <div><h2 id="programme-tree-heading">{t("rewards.design.total")}</h2>
        <button type="button" className={styles.totalAmount} onClick={() => onSelect("programme")} aria-controls="programme-inspector">
          {amount(programme.budgetWei)}
        </button></div>
      <p>{t("rewards.design.planningStatus")}</p>
    </div>
    <Suspense fallback={<p>{t("rewards.loading")}</p>}><ProgrammeFlowChart selected={selected} onSelect={onSelect} programme={programme} /></Suspense>
    <div className={styles.flowFallback}><div className={styles.potLabels}>{pots.map(pot => <button key={pot.id} type="button"
      data-pot={pot.pot} aria-pressed={path.some(node => node.id === pot.id)} aria-controls="programme-inspector"
      onClick={() => onSelect(pot.id)}>
      <span>{label(pot)} · {share(pot.amountWei)}%</span><strong>{amount(pot.amountWei)}</strong>
    </button>)}</div>
    <div className={styles.potGraphic} aria-hidden="true">{pots.map(pot => <span key={pot.id} data-pot={pot.pot}
      style={{ width: `${share(pot.amountWei)}%` }} />)}</div>
    </div>
    <ul className={styles.roundCards}>{rounds.map(round => <li key={round.id}><button type="button"
      aria-pressed={path.some(node => node.id === round.id)} aria-controls="programme-inspector" onClick={() => onSelect(round.id)}>
      <span>{t("rewards.programme.round", { number: round.roundNumber! })}</span>
      <strong>{label(round)}</strong><span className={styles.roundAmount}>{amount(round.amountWei)}</span>
      {round.roundNumber === 5 ? <span className={styles.finaleDate}>{t("rewards.premium.finale")}</span> : null}
    </button></li>)}</ul>
    <details className={styles.allAllocations}><summary>{t("rewards.design.allAllocations")}</summary>
      <label htmlFor="programme-node">{t("rewards.programme.detail")}</label>
      <select id="programme-node" value={selected} onChange={event => onSelect(event.target.value)}>
        {programme.nodes.map(node => <option key={node.id} value={node.id}>
          {programmePath(node.id, programme).slice(1).map(label).join(" / ") || label(node)}
        </option>)}
      </select>
    </details>
  </section>;
}
