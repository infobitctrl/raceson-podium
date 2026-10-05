import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { previewRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { ProgrammeFundingViewV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readProgrammeFundingV3 } from "../data/programmeFundingV3";
import { formatTestMon } from "../model/athleteRewards";
import { workspaceCopy } from "../model/workspaceCopy";
import DistributionExplorer from "../components/DistributionExplorer";
import { draftDistributionGraph } from "../model/distributionExplorer";
import styles from "../components/RewardWorkspace.module.css";

export default function OrganizerProgrammeOverview({ record, navigate }: {
  record: SavedRewardPlanningDraft; navigate: (section: "rules" | "results" | "funding", slot?: number) => void;
}) {
  const { locale, t } = useI18n(), copy = workspaceCopy(locale);
  const [view, setView] = useState<ProgrammeFundingViewV3 | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setView(null); setFailed(false);
    void readProgrammeFundingV3(record).then(value => { if (active) setView(value); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record, reload]);
  const observed = !loading && !failed && view?.draftId === record.draftId && view.rulesRevision === record.revision
    && view.chainId === record.chainId ? view.observation : null;
  const preview = previewRewardProgrammeDraftV2(record.rules);
  const mon = (value: bigint | string) => `${BigInt(value) === 0n ? "0" : formatTestMon(String(value), locale)} ${t("rewards.testMon")}`;
  const pots = [...preview.rounds.map(r => r.amountWei), preview.leagueBudgetWei];
  const hr = locale === "hr";
  const graph = useMemo(() => draftDistributionGraph(record.rules, hr), [record.rules, hr]);
  const [selection,setSelection] = useState("programme");
  const branch=graph.byId.get(selection)??graph.byId.get("programme")!;
  const selectedSlot=branch.potIds.length===1?(branch.potIds[0]==="league"?5:Number(branch.potIds[0].replace("round-",""))-1):undefined;
  return <>
    <section className={styles.organizerBudget} aria-label={copy.planned}>
      <div><span className={styles.muted}>{copy.planned}</span><strong>{mon(preview.budgetWei)}</strong></div>
    </section>
    <div className={styles.fundingStrip}>
      {observed ? <dl>{([[copy.funded, observed.depositedWei], [copy.allocated, observed.pots.reduce((sum, p) => sum + BigInt(p.allocatedWei), 0n)], [copy.paid, observed.pots.reduce((sum, p) => sum + BigInt(p.paidWei), 0n)]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{mon(value)}</dd></div>)}</dl>
        : <p className={styles.muted}>{loading ? t("rewards.loading") : hr ? "Financiranje još nije potvrđeno." : "Funding has not been verified yet."}</p>}
      <div className={styles.actions}><button className={styles.textAction} onClick={() => navigate("funding")}>{hr ? "Financiranje i ugovor" : "Funding & contract"}<ArrowUpRight size={15} aria-hidden="true" /></button>
        <button className={styles.iconAction} aria-label={copy.refresh} title={copy.refresh} disabled={loading} onClick={() => setReload(n => n + 1)}><RefreshCw size={16} aria-hidden="true" /></button></div>
    </div>
    {failed ? <p role="alert" className="my-4 text-sm">{t("rewards.fundingV3.error")}</p> : null}
    <DistributionExplorer graph={graph} selected={branch.id} onSelect={setSelection} status={hr?"Spremljeni plan · nije potvrda isplate":"Saved plan · not a payment receipt"}>
      <p className="my-4 text-sm text-muted-foreground">{hr?"Odaberite fond i pregledajte raspodjelu prije odobrenja.":"Choose a pot to review its distribution before approval."}</p>
      <button className={styles.textAction} onClick={()=>navigate("results",selectedSlot)}>{hr?"Pregledaj raspodjelu":"Review distribution"}<ArrowUpRight size={15} aria-hidden="true"/></button>
    </DistributionExplorer>
    <section className={styles.recipientSection}><div className={styles.sectionHeading}><h2>{hr ? "Raspodjela nagrada" : "Reward distribution"}</h2><span className={styles.muted}>test MON</span></div>
      <div className={styles.scroll}><table className={`${styles.table} ${styles.distributionTable}`}><thead><tr><th scope="col">{copy.pot}</th><th scope="col" className={styles.number}>{copy.budget}</th><th scope="col" className={styles.number}>{hr ? "Dodijeljeno" : "Allocated"}</th><th scope="col" className={styles.number}>{hr ? "Isplaćeno" : "Paid"}</th><th scope="col">{copy.state}</th><th scope="col"><span className="sr-only">{hr ? "Radnje" : "Actions"}</span></th></tr></thead>
        <tbody>{pots.map((amount, slot) => { const pot = observed?.pots.find(p => p.slot === slot); return <tr key={slot}>
          <th scope="row"><span className={slot === 5 ? styles.leagueDot : styles.raceDot} />{slot === 5 ? t("rewards.fundingV3.league") : t("rewards.fundingV3.round", { round: slot + 1 })}</th>
          <td data-label={copy.budget} className={styles.number}>{mon(amount).replace(` ${t("rewards.testMon")}`, "")}</td><td data-label={hr ? "Dodijeljeno" : "Allocated"} className={styles.number}>{pot ? mon(pot.allocatedWei).replace(` ${t("rewards.testMon")}`, "") : "—"}</td><td data-label={hr ? "Isplaćeno" : "Paid"} className={styles.number}>{pot ? mon(pot.paidWei).replace(` ${t("rewards.testMon")}`, "") : "—"}</td>
          <td><span className={styles.stateLabel}>{pot ? <>{t(`rewards.fundingV3.state.${pot.state}`)}{pot.paused ? ` · ${t("rewards.fundingV3.paused")}` : ""}</> : copy.unknown}</span></td>
          <td><button className={styles.textAction} aria-label={`${hr ? "Pregledaj" : "Review"} ${slot === 5 ? t("rewards.fundingV3.league") : t("rewards.fundingV3.round", { round: slot + 1 })}`} onClick={() => navigate("results", slot)}>{hr ? "Pregledaj" : "Review"}<ArrowUpRight size={14} aria-hidden="true" /></button></td>
        </tr>; })}</tbody></table></div>
      <p className={styles.smallNote}>{observed ? `${copy.observation} ${observed.blockNumber} · ${new Date(Number(observed.blockTimestamp) * 1000).toLocaleString(locale)}` : (hr ? "— Status isplate nije provjeren." : "— Payment status has not been verified.")}</p>
    </section>
  </>;
}
