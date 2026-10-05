import { previewRewardRankSlotsV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import styles from "../screens/RewardProgramme.module.css";

export default function ProgrammePrizeCurve({ weights }: { weights: readonly number[] }) {
  const { t, locale } = useI18n();
  const slots = previewRewardRankSlotsV2(1_000_000n, weights);
  const maximum = slots[0].amountWei;
  const percent = new Intl.NumberFormat(locale === "hr" ? "hr-HR" : "en-GB", { style: "percent", maximumFractionDigits: 2 });
  const title = t(weights.length === 10 ? "rewards.planner.raceCurve" : "rewards.planner.leagueCurve");
  return <div className={styles.prizeCurve}>
    <div className={styles.prizeBars} role="img" aria-label={title}>
      {slots.map(slot => <span key={slot.rank} style={{ height: `${Number(slot.amountWei * 10000n / maximum) / 100}%` }} />)}
    </div>
    <div className={styles.curveAxis}><span>{t("rewards.planner.place")} 1</span>
      <span>{t("rewards.planner.place")} {weights.length}</span></div>
    <p className={styles.curveCaption}>{t("rewards.design.curveMeaning")}</p>
    <details className={styles.rules}><summary>{t("rewards.design.prizeSlots")}</summary>
      <table className={styles.rankTable}>
        <caption className="sr-only">{title}</caption>
        <thead><tr><th scope="col">{t("rewards.planner.place")}</th><th scope="col">{t("rewards.planner.share")}</th></tr></thead>
        <tbody>{slots.map(slot => <tr key={slot.rank}><th scope="row">{slot.rank}</th>
          <td>{percent.format(Number(slot.amountWei) / 1_000_000)}</td></tr>)}</tbody>
      </table>
    </details>
  </div>;
}
