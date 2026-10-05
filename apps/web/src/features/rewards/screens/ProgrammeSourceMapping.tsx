import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { previewRewardSourceMappingV2, type RewardMappingWorkspaceV2, type RewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readSourceMapping, saveSourceMapping } from "../data/sourceMapping";
import { formatUnits } from "viem";
import styles from "./ProgrammeSourceMapping.module.css";
import PublishedRewardPreview from "./PublishedRewardPreview";
import ProgrammeResultReviewV3 from "./ProgrammeResultReviewV3";
const FinaleBindingV3 = lazy(() => import("./FinaleBindingV3"));
const LeaguePolicyReviewV3 = lazy(() => import("./LeaguePolicyReviewV3"));
const FinalClubAwardsV3 = lazy(() => import("../components/FinalClubAwardsV3"));

export default function ProgrammeSourceMapping({ record, section = "all", selectedRound, selectedLeague = false }: { record: SavedRewardPlanningDraft; selectedRound?: number; selectedLeague?: boolean; section?: "all" | "setup" | "results" }) {
  const { t, locale } = useI18n();
  const [workspace, setWorkspace] = useState<RewardMappingWorkspaceV2 | null>(null);
  const [mapping, setMapping] = useState<RewardSourceMappingV2 | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "save" | "conflict" | null>(null);
  const [reload, setReload] = useState(0), [pot, setPot] = useState(0);
  const [saved, setSaved] = useState(false);
  const [showFinale, setShowFinale] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setWorkspace(null); setMapping(null); setSaved(false);
    void readSourceMapping(record).then(value => { if (active) { setWorkspace(value); setMapping(value.mapping); } })
      .catch(() => { if (active) setError("load"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record, reload]);
  const preview = useMemo(() => {
    if (!workspace || !mapping) return null;
    try { return previewRewardSourceMappingV2(record.rules, mapping, workspace.catalogue); } catch { return null; }
  }, [record.rules, mapping, workspace]);
  const dirty = workspace && mapping && JSON.stringify(workspace.mapping) !== JSON.stringify(mapping);
  const stale = workspace?.boundCatalogueHash && workspace.boundCatalogueHash !== workspace.catalogueHash;
  function edit(next: RewardSourceMappingV2) { setMapping(next); setSaved(false); }
  async function save() {
    if (!workspace || !mapping || saving || !preview) return;
    setSaving(true); setError(null); setSaved(false);
    try { const next = await saveSourceMapping(record, workspace, mapping); setWorkspace(next); setMapping(next.mapping); setSaved(true); }
    catch (e) { setError(e && typeof e === "object" && "status" in e && e.status === 409 ? "conflict" : "save"); }
    finally { setSaving(false); }
  }
  const inputClass = "mt-1 w-full rounded-md border border-input bg-background p-2 text-sm";
  return <section id="source-mapping" aria-labelledby={section === "results" ? undefined : "mapping-heading"} aria-label={section === "results" ? t("rewards.published.title") : undefined} className="mx-auto my-6 max-w-[1320px] scroll-mt-48 space-y-5 rounded-xl border bg-card p-4 md:scroll-mt-24 md:p-6">
    {section === "results" && loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {section === "results" && error ? <div><p role="alert">{t(`rewards.mapping.error.${error}`)}</p><button className="my-3 rounded border px-3 py-2 text-sm" disabled={loading || saving} onClick={() => setReload(n => n + 1)}>{t("rewards.mapping.reload")}</button></div> : null}
    {section === "results" && dirty ? <p role="status">{t("rewards.mapping.unsaved")}</p> : null}
    <div hidden={section === "results"} className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="mapping-heading" className="text-xl font-semibold">{t("rewards.mapping.title")}</h2>
      <Link className="text-sm text-primary underline" to={`/organizer/leagues/${record.seasonId}`}>{t("rewards.mapping.openLeague")}</Link>
    </div>
    <p className="text-sm text-muted-foreground">{t("rewards.mapping.notice")}</p>
    <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setShowFinale(v => !v)} aria-expanded={showFinale}>{t("rewards.finale.title")}</button>
    {showFinale ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><FinaleBindingV3 key={`${record.draftId}:${record.revision}`}
      record={record} dirty={Boolean(dirty) || saving} onSaved={() => setReload(n => n + 1)} /></Suspense> : null}
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button className="rounded-md border px-3 py-2" disabled={loading || saving} onClick={() => setReload(n => n + 1)}>{t("rewards.mapping.reload")}</button>
      {workspace ? <span>{t("rewards.mapping.revision", { revision: workspace.revision, rules: workspace.rulesRevision })}</span> : null}
      {dirty ? <span>{t("rewards.mapping.unsaved")}</span> : null}
    </div>
    {loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p role="alert" className="text-destructive">{t(`rewards.mapping.error.${error}`)}</p> : null}
    {saved ? <p role="status">{t("rewards.mapping.saved")}</p> : null}
    {workspace && mapping ? <>
      <button type="button" className="rounded border px-3 py-2 text-sm" aria-expanded={showPolicy} onClick={() => setShowPolicy(v => !v)}>{t("rewards.leaguePolicy.title")}</button>
      {showPolicy ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><LeaguePolicyReviewV3 key={`${record.draftId}:${record.revision}:${workspace.revision}:${reload}`}
        record={record} dirty={Boolean(dirty) || saving || Boolean(stale)} /></Suspense> : null}
      {stale ? <p role="alert" className="rounded-md border border-amber-500 p-3 text-sm">{t("rewards.mapping.stale")}</p> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {mapping.rounds.map((round, index) => {
          const source = workspace.catalogue.rounds.find(r => r.id === round.roundId);
          return <div key={round.slot} className="rounded-lg border p-3">
            <label className="text-sm font-medium" htmlFor={`round-source-${round.slot}`}>{t("rewards.mapping.round", { round: round.slot })}</label>
            <select id={`round-source-${round.slot}`} className={inputClass} value={round.roundId ?? ""} disabled={saving}
              onChange={e => edit({ ...mapping, rounds: mapping.rounds.map((r, i) => i === index ? { ...r, roundId: e.target.value || null } : r) })}>
              <option value="">{t("rewards.mapping.unmapped")}</option>
              {round.roundId && !source ? <option value={round.roundId}>{t("rewards.mapping.removed")}</option> : null}
              {workspace.catalogue.rounds.filter(r => r.slot === round.slot).map(r => <option key={r.id} value={r.id} disabled={r.status === "cancelled"}>{r.name}</option>)}
            </select>
            {source ? <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{source.date}</p>
              {source.races.map(r => <p key={r.competitionId}>{r.name} · {r.distanceMetres === null ? t("rewards.mapping.distanceMissing") : `${Number(r.distanceMetres) / 1000} km`} · {t("rewards.mapping.results", { count: r.resultCount })}</p>)}
              {!source.races.length ? <p>{t("rewards.mapping.racesMissing")}</p> : null}
              <details><summary className="cursor-pointer">{t("rewards.mapping.sourceIds")}</summary><p className="break-all">{source.editionId}</p></details>
            </div> : <p className="mt-2 text-xs text-muted-foreground">{t("rewards.mapping.pending")}</p>}
          </div>;
        })}
      </div>
      <label className="block max-w-sm text-sm font-medium">{t("rewards.mapping.pot")}
        <select className={inputClass} value={pot} onChange={e => setPot(Number(e.target.value))}>
          {mapping.rounds.map((r, i) => <option key={r.slot} value={i}>{t("rewards.mapping.round", { round: r.slot })}</option>)}
          <option value={5}>{t("rewards.mapping.league")}</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">{t("rewards.mapping.categoryHelp")}</p>
      {(["individual", "club"] as const).map(target => {
        const categories = workspace.catalogue.categories.filter(c => c.target === target);
        const shares = pot === 5 ? mapping.leagueCategories : mapping.rounds[pot].categories;
        const family = preview?.[pot]?.families.find(f => f.key === (target === "individual" ? "athlete_standings" : "club_standings"));
        const total = categories.reduce((n, c) => n + (shares.find(s => s.categoryId === c.id)?.shareBps ?? 0), 0);
        return <fieldset key={target} className="space-y-3 rounded-lg border p-4">
          <legend className="px-2 font-medium">{t(`rewards.mapping.${target}`)}</legend>
          <p className="text-sm">{t("rewards.mapping.assigned", { share: (total / 100).toFixed(2) })}
            {family ? ` · ${t("rewards.mapping.unassigned", { amount: formatUnits(family.unassignedWei, 18) })}` : ""}</p>
          {!categories.length ? <p className="text-sm text-muted-foreground">{t("rewards.mapping.categoriesMissing")}</p> : null}
          {categories.length ? <button className="rounded-md border px-3 py-2 text-sm" disabled={saving} onClick={() => {
            const other = shares.filter(s => !categories.some(c => c.id === s.categoryId));
            const ordered = [...categories].sort((a, b) => a.id < b.id ? -1 : 1);
            const next = [...other, ...ordered.map((c, i) => ({ categoryId: c.id, shareBps: Math.floor(10000 / ordered.length) + (i < 10000 % ordered.length ? 1 : 0) }))];
            edit(pot === 5 ? { ...mapping, leagueCategories: next } : { ...mapping, rounds: mapping.rounds.map((r, i) => i === pot ? { ...r, categories: next } : r) });
          }}>{t("rewards.mapping.equal")}</button> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {categories.map(category => {
              const share = shares.find(s => s.categoryId === category.id)?.shareBps ?? 0;
              const amount = family?.categories.find(c => c.categoryId === category.id);
              const source = pot === 5 ? null : workspace.catalogue.rounds.find(r => r.id === mapping.rounds[pot].roundId);
              const missingRace = target === "individual" && pot !== 5 && share > 0 && !source?.races.some(r => r.competitionId === category.competitionId);
              return <div key={category.id} className="space-y-2 rounded-md border p-3">
                <label htmlFor={`share-${category.id}`} className="block text-sm font-medium">{category.competitionName} · {category.name}</label>
                <div className="flex items-center gap-2"><input id={`share-${category.id}`} aria-label={`${category.competitionName} · ${category.name} (%)`}
                  className="w-24 rounded-md border border-input bg-background p-2 text-sm" type="number" min={0} max={100} step={0.01} value={share / 100} disabled={saving}
                  onChange={e => {
                    const value = e.target.value === "" ? 0 : Number(e.target.value);
                    if (!Number.isFinite(value)) return;
                    const next = shares.filter(s => s.categoryId !== category.id).concat({ categoryId: category.id, shareBps: Math.round(value * 100) });
                    edit(pot === 5 ? { ...mapping, leagueCategories: next } : { ...mapping, rounds: mapping.rounds.map((r, i) => i === pot ? { ...r, categories: next } : r) });
                  }} /><span className="text-sm">% {amount ? `· ${formatUnits(amount.amountWei, 18)} test MON` : ""}</span></div>
                <progress aria-label={`${category.name} (%)`} value={Math.max(0, Math.min(share, 10000))} max={10000} className={styles.share} />
                {missingRace ? <p className="text-xs text-amber-700 dark:text-amber-400">{t("rewards.mapping.raceLinkMissing")}</p> : null}
                <details className="text-xs"><summary className="cursor-pointer text-primary">{t("rewards.mapping.evidence")}</summary>
                  <p className="my-2 break-all">{category.id}</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify(category.eligibility, null, 2)}</pre>
                  <p className="my-2 text-muted-foreground">{t("rewards.mapping.notEligibility")}</p>
                  {amount ? <table className="w-full text-left"><caption>{t("rewards.mapping.slots")}</caption><thead><tr><th>{t("rewards.mapping.place")}</th><th>test MON</th></tr></thead>
                    <tbody>{amount.slots.map(s => <tr key={s.rank}><td>{s.rank}</td><td>{formatUnits(s.amountWei, 18)}</td></tr>)}</tbody></table> : null}
                </details>
              </div>;
            })}
          </div>
        </fieldset>;
      })}
      {mapping.rounds.some(r => r.categories.some(s => !workspace.catalogue.categories.some(c => c.id === s.categoryId)))
        || mapping.leagueCategories.some(s => !workspace.catalogue.categories.some(c => c.id === s.categoryId)) ?
        <button className="rounded-md border px-3 py-2 text-sm" disabled={saving} onClick={() => {
          const keep = (s: { categoryId: string }) => workspace.catalogue.categories.some(c => c.id === s.categoryId);
          edit({ ...mapping, rounds: mapping.rounds.map(r => ({ ...r, categories: r.categories.filter(keep) })), leagueCategories: mapping.leagueCategories.filter(keep) });
        }}>{t("rewards.mapping.removeUnavailable")}</button> : null}
      {pot === 5 ? <p className="rounded-md bg-muted p-3 text-sm">{t("rewards.mapping.participation")}</p> : null}
      {!preview ? <p role="alert" className="text-sm text-destructive">{t("rewards.mapping.invalid")}</p> : null}
      <p className="text-sm text-muted-foreground">{t("rewards.mapping.paymentGate")}</p>
      <button className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50" disabled={saving || !preview || (!dirty && !stale && workspace.revision > 0)} onClick={() => void save()}>
        {t(saving ? "rewards.saved.saving" : "rewards.mapping.save")}</button>
    </> : null}
    </div>
    {workspace ? <div hidden={section === "setup"} className="space-y-5">
      {selectedLeague ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><LeaguePolicyReviewV3 record={record} dirty={Boolean(dirty) || saving || Boolean(stale)} /></Suspense> : <PublishedRewardPreview record={record} workspace={workspace} dirty={Boolean(dirty)} selectedRound={selectedRound} />}
      {!selectedLeague ? <details><summary className="cursor-pointer py-3 font-medium">{locale === "hr" ? "Pregled rezultata" : "Results review"}</summary><ProgrammeResultReviewV3 organizationId={record.organizationId} races={workspace.catalogue.rounds.filter(round => !selectedRound || round.slot === selectedRound).flatMap(round => round.races.map(race => ({ id: race.id, name: `${round.name} · ${race.name}` })))} /></details> : null}
      <details><summary className="cursor-pointer py-3 font-medium">{locale === "hr" ? "Završne klupske nagrade" : "Final club awards"}</summary><Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><FinalClubAwardsV3 record={record} dirty={Boolean(dirty) || saving || Boolean(stale)} /></Suspense></details>
    </div> : null}
  </section>;
}
