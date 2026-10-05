import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readPublishedPreview } from "../data/publishedPreview";
import styles from "./ProgrammeSourceMapping.module.css";
import FrozenRewardProposals from "./FrozenRewardProposals";
const HistoricalSourceReviewV3 = lazy(() => import("./HistoricalSourceReviewV3"));

type Data = Awaited<ReturnType<typeof readPublishedPreview>>;
export default function PublishedRewardPreview({ record, workspace, dirty, selectedRound }: { selectedRound?: number; record: SavedRewardPlanningDraft; workspace: RewardMappingWorkspaceV2; dirty: boolean }) {
  const { t } = useI18n(), [data, setData] = useState<Data>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const [round, setRound] = useState(1), [category, setCategory] = useState(""), [query, setQuery] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  useEffect(() => { if (selectedRound && selectedRound >= 1 && selectedRound <= 5) { setRound(selectedRound); setCategory(""); setQuery(""); } }, [selectedRound]);
  useEffect(() => {
    let active = true; setLoading(true); setFailed(false); setData(null);
    void readPublishedPreview(record, workspace).then(d => { if (active) setData(d); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record, workspace]);
  const frozenContext = useMemo(() => data?.snapshot.version === 2 ? { record, workspace, snapshot: data.snapshot, sourceHash: data.sourceHash, slot: round } : null, [data, record, workspace, round]);
  const reviewContext = useMemo(() => data ? { record, workspace, sourceHash: data.sourceHash, slot: round } : null, [data, record, workspace, round]);
  const heading = <h3 className="text-xl font-semibold">{t("rewards.published.title")}</h3>;
  if (loading || failed || !data) return <section id="published-preview" className="scroll-mt-48 space-y-3 rounded-lg border p-4 md:scroll-mt-24">
    {heading}<p role={failed ? "alert" : "status"}>{t(loading ? "rewards.loading" : failed ? "rewards.published.error" : "rewards.published.empty")}</p></section>;
  const { snapshot, preview, sourceHash } = data, pot = preview.rounds[round - 1];
  const synthetic = snapshot.version === 3;
  const selected = pot.categories.find(c => c.categoryId === category) ?? pot.categories[0];
  const athletes = selected?.awards.filter(a => a.amountWei > 0n && (!query || (a.name ?? a.beneficiaryId).toLocaleLowerCase().includes(query.toLocaleLowerCase()))) ?? [];
  const amount = (v: bigint) => formatUnits(v, 18);
  return <section id="published-preview" className="scroll-mt-48 space-y-4 rounded-lg border p-4 md:scroll-mt-24" aria-label={t("rewards.published.title")}>
    {heading}
    <p className={synthetic ? "rounded-md border border-amber-500 p-3 text-sm font-medium" : "text-sm"}>{t(synthetic ? "rewards.pilot.notice" : "rewards.published.notice")}</p>
    <p className="rounded-md border border-amber-500 p-3 text-sm">{t(synthetic ? "rewards.pilot.categories" : "rewards.published.categoryGap")}</p>
    <p className="text-sm text-muted-foreground">{t("rewards.published.counts", { rows: preview.resultCount, finished: preview.finishedCount,
      athletes: new Set(snapshot.results.map(r => r.athleteId)).size, clubs: snapshot.clubs.length })}</p>
    <p className="text-sm text-muted-foreground">{t("rewards.published.holds", { duplicates: preview.duplicateAthleteRounds, unclassified: preview.unclassifiedFinishes })}</p>
    {dirty ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{t("rewards.published.savedOnly")}</p> : null}
    <div className="flex flex-wrap items-end gap-3">
      <label className="w-full min-w-0 text-sm sm:w-auto">{t("rewards.published.round")}<select className="mt-1 block w-full rounded border bg-background p-2" value={round} onChange={e => { setRound(Number(e.target.value)); setCategory(""); setQuery(""); }}>
        {preview.rounds.map(r => <option key={r.slot} value={r.slot}>{t("rewards.mapping.round", { round: r.slot })}{r.sourceName ? ` · ${r.sourceName}` : ""}</option>)}
      </select></label>
      <label className="w-full min-w-0 text-sm sm:w-auto">{t("rewards.published.category")}<select className="mt-1 block w-full rounded border bg-background p-2" value={selected?.categoryId ?? ""} onChange={e => { setCategory(e.target.value); setQuery(""); }}>
        {!pot.categories.length ? <option value="">{t("rewards.published.configure")}</option> : pot.categories.map(c => <option key={c.categoryId} value={c.categoryId}>{c.label}</option>)}
      </select></label>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {([["budget", pot.budgetWei], ["proposed", pot.proposedWei], ["retained", pot.retainedWei]] as const).map(([key, value]) => <div key={key} className="rounded-md bg-muted p-3">
        <p className="text-xs text-muted-foreground">{t(`rewards.published.${key}`)}</p><p className="text-lg font-semibold">{amount(value)} test MON</p>
      </div>)}
    </div>
    <progress className={styles.share} max={10000} value={pot.budgetWei ? Number(pot.proposedWei * 10000n / pot.budgetWei) : 0} aria-label={t("rewards.published.proposed")} />
    {synthetic ? null : workspace.catalogue.rounds.some(r => r.slot === 5) ? <p className="rounded bg-muted p-3 text-sm">{t("rewards.finale.legacy")}</p>
      : frozenContext ? <FrozenRewardProposals key={`${record.draftId}:${record.revision}:${workspace.revision}:${sourceHash}:${round}`} context={frozenContext} dirty={dirty} /> : null}
    {reviewContext && round <= 4 ? <>
      <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setReviewOpen(v => !v)} aria-expanded={reviewOpen}>
        {t(synthetic ? "rewards.pilot.reviewTitle" : "rewards.historical.title")}</button>
      {reviewOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><HistoricalSourceReviewV3
        key={`historical:${record.draftId}:${record.revision}:${workspace.revision}:${sourceHash}:${round}`} context={reviewContext} dirty={dirty} /></Suspense> : null}
    </> : null}
    {selected ? <>
      <p className="text-sm">{selected.label} · {t("rewards.published.categoryBudget", { budget: amount(selected.budgetWei), unused: amount(selected.unusedWei) })}</p>
      <p className="text-xs text-muted-foreground">{t(selected.target === "club" ? "rewards.published.clubFormula" : "rewards.published.athleteFormula")}</p>
      {selected.blockedReason ? <p role="status" className="rounded-md border border-amber-500 p-3 text-sm">{t(`rewards.published.block.${selected.blockedReason}`)}</p> : <>
        <label className="block max-w-sm text-sm">{t("rewards.published.search")}<input className="mt-1 block w-full rounded border bg-background p-2" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-medium">{t("rewards.published.table")}</caption>
          <thead><tr className="border-b"><th className="p-2">{t("rewards.mapping.place")}</th><th className="p-2">{t("rewards.published.beneficiary")}</th><th className="p-2">test MON</th><th className="p-2">{t("rewards.published.evidence")}</th></tr></thead>
          <tbody>{athletes.map(a => <tr key={a.beneficiaryId} className="border-b align-top"><td className="p-2">{a.place}</td><td className="p-2">{a.name ?? t("rewards.published.hiddenName")}<p className="text-xs text-muted-foreground">{t("rewards.published.unclaimed")}</p></td>
            <td className="p-2 font-medium">{amount(a.amountWei)}</td><td className="p-2"><details><summary className="cursor-pointer text-primary">{t("rewards.published.inspect")}</summary><p>{t(selected.target === "club" ? "rewards.published.points" : "rewards.published.sourcePlace", { value: a.evidenceValue })}</p>
              {a.evidenceIds.map(id => <p key={id} className="max-w-48 break-all font-mono text-xs">{id}</p>)}<p className="mt-2 max-w-48 text-xs">{t("rewards.published.paymentHold")}</p>
            </details></td></tr>)}</tbody>
        </table></div>
        {!athletes.length ? <p className="text-sm">{t("rewards.published.noAwards")}</p> : null}
      </>}
    </> : <p>{t("rewards.published.configure")}</p>}
    <details className="rounded-md border p-3"><summary className="cursor-pointer font-medium">{t("rewards.published.participation")}</summary>
      <p className="my-3 text-sm">{t("rewards.published.leagueHold", { amount: amount(preview.leagueRetainedWei) })}</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{t("rewards.published.beneficiary")}</th><th className="p-2">km</th><th className="p-2">{t("rewards.published.finishes")}</th></tr></thead>
        <tbody>{preview.participation.map(r => <tr key={r.athleteId}><td className="p-2">{r.name ?? t("rewards.published.hiddenName")}</td><td className="p-2">{formatUnits(r.metres, 3)}</td><td className="p-2">{r.finishes}</td></tr>)}</tbody>
      </table></div>
    </details>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("rewards.published.provenance")}</summary>
      <p>{snapshot.sourceOrigin} · {snapshot.capturedAt}</p><p className="break-all">{sourceHash}</p><p>{t(synthetic ? "rewards.pilot.provenance" : "rewards.published.provenanceHelp")}</p>
    </details>
  </section>;
}
