import RewardDistributionTree from "../components/RewardDistributionTree";
import { allocationPotNode } from "../model/allocationTree";
import { productCopy } from "../model/productCopy";
import editorial from "../components/RewardEditorial.module.css";
import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createRewardAllocationRehearsalV3 } from "@raceson/domain/rewards/allocation-rehearsal-v3";
import { previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { athleteUxCopy } from "../model/athleteUxCopy";

const scenarios = ["four_rounds", "five_rounds", "distance_hold"] as const;
const categoryKeys = ["shortFU16", "shortMU16", "shortF", "shortM", "shortSenior", "longF", "longM", "clubs"] as const;

/** Anonymous synthetic calculator, deliberately no Auth/API/wallet dependency.
 * This does not load or change any saved planning draft or approved programme. */
export default function AllocationRehearsalV3() {
  const { t, locale } = useI18n(), copy = productCopy(locale), ux = athleteUxCopy(locale);
  const [search, setSearch] = useSearchParams();
  const [expandedScore, setExpandedScore] = useState<string | null>(null);
  const stage = scenarios.find(s => s === search.get("stage")) ?? "four_rounds";
  const cohort = search.get("cohort") === "compact_20" ? "compact_20" : "full";
  const fixture = useMemo(() => createRewardAllocationRehearsalV3(stage, cohort), [stage, cohort]);
  const preview = useMemo(() => previewRewardAllocationV3(fixture.rules, fixture.mapping, fixture.source), [fixture]);
  const potKey = /^[1-5]$/.test(search.get("pot") ?? "") ? search.get("pot")! : "league";
  const pot = potKey === "league" ? preview.league : preview.rounds[Number(potKey) - 1]!;
  const options = pot.families.flatMap(f => f.categories);
  const selected = options.find(c => c.categoryId === search.get("category")) ?? options[0]!;
  const scoreRows = useMemo(() => new Map(fixture.scoringTables.find(table => table.categoryId === selected.categoryId
    && table.slot === (potKey === "league" ? null : Number(potKey)))?.rows.map(row => [row.beneficiaryId, row]) ?? []),
  [fixture, selected.categoryId, potKey]);
  const amount = (wei: bigint) => t("rewards.programme.amount", { amount: wei ? formatTestMon(wei.toString(), locale) : "0" });
  const categoryName = (id: string) => t(`rewards.rehearsal.category.${categoryKeys[fixture.source.categories.findIndex(c => c.id === id)]!}`);
  const labelPot = (key: string) => key === "league" ? t("rewards.programme.leaguePot") : t("rewards.programme.round", { number: key });
  const recipient = (id: string, club = false) => t(club ? "rewards.rehearsal.club" : "rewards.rehearsal.athlete", {
    number: cohort === "compact_20" && !club ? fixture.source.rounds[0]!.results.findIndex(row => row.athleteId === id) + 1 : Number(id.slice(-12)) - (club ? 4999 : 999) });
  function choose(values: { stage?: string; pot?: string; category?: string; cohort?: string }) {
    setExpandedScore(null);
    setSearch({ stage, pot: potKey, category: selected.categoryId, cohort, ...values });
  }
  const distance = preview.league.participation;
  const clubCount = new Set(fixture.source.rounds.flatMap(r => r.results.flatMap(row => row.clubId ? [row.clubId] : []))).size;
  return <div className={editorial.page}>
    <header className={editorial.hero}>
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t("rewards.rehearsal.badge")}</p>
      <h1 className="font-display text-3xl font-bold">{t("rewards.rehearsal.title")}</h1>
      <p className="max-w-4xl text-sm text-muted-foreground">{ux.previewOnly} {ux.sizeHelp}</p>
      <Link className="text-sm font-semibold text-primary underline" to="/rewards/manage">{ux.organizerLink}</Link>
      <details className="text-sm"><summary className="cursor-pointer">{t("rewards.rehearsal.badge")}</summary><p className="mt-2">{t("rewards.rehearsal.notice")}</p></details>
    </header>
    <div className={editorial.notice}>{t("rewards.rehearsal.presets", {
      budget: formatTestMon(preview.budgetWei.toString(), locale), league: formatTestMon(preview.league.budgetWei.toString(), locale),
      round: formatTestMon(preview.rounds[0]!.budgetWei.toString(), locale) })}</div>
    <div className={editorial.controls}><label className="grid max-w-xl gap-2 text-sm font-semibold" htmlFor="rehearsal-cohort">{ux.example}
      <select id="rehearsal-cohort" className="min-w-0 rounded-md border bg-background p-3" value={cohort} onChange={e => choose({ cohort: e.target.value, category: "" })}>
        <option value="full">{ux.full}</option>
        <option value="compact_20">{ux.small}</option>
      </select>
    </label>
    <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">{ux.stage}</legend>
      <div className="flex flex-wrap gap-2">{(["four_rounds", "five_rounds"] as const).map(s => <button key={s} type="button"
        aria-pressed={s === "five_rounds" ? stage !== "four_rounds" : stage === s}
        className="rounded-md border px-3 py-2 text-sm aria-pressed:border-primary aria-pressed:bg-primary/10"
        onClick={() => choose({stage:s})}>{s === "four_rounds" ? ux.four : ux.five}</button>)}</div>
      <details open={stage === "distance_hold" || undefined}><summary className="cursor-pointer text-sm">{ux.advanced}</summary>
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={stage === "distance_hold"}
          onChange={e => choose({stage:e.target.checked ? "distance_hold" : "five_rounds"})}/>{ux.distanceHold}</label>
      </details>
    </fieldset>
    </div>
    {cohort === "compact_20" ? <details className="text-sm"><summary className="cursor-pointer">{ux.small}</summary><p className="mt-2" role="note">{t("rewards.rehearsal.cohort.help")}</p></details> : null}
    <dl className={editorial.metrics} aria-label={t("rewards.rehearsal.totals")}>
      {([['budget', preview.budgetWei], ['proposed', preview.proposedWei], ['retained', preview.retainedWei], ['payable', preview.payableWei]] as const).map(([key, value]) =>
        <div key={key}><dt className="text-xs text-muted-foreground">{t(`rewards.rehearsal.${key}`)}</dt>
          <dd className="break-words">{value % 100000000000000n === 0n ? amount(value) : <>
            <span>≈ {amount(value / 100000000000000n * 100000000000000n)}</span>
            <details className={editorial.exactAmount}><summary>{t("rewards.premium.exactAmount")}</summary><p>{amount(value)}</p></details>
          </>}</dd></div>)}
    </dl>
    <section className="space-y-3" aria-label={t("rewards.rehearsal.pots")}>
      <h2 className="font-display text-xl font-bold">{t("rewards.rehearsal.pots")}</h2>
      <p className="text-xs text-muted-foreground">{t("rewards.rehearsal.proposed")}</p>
      <div className={editorial.pots}>{[...preview.rounds.map(r => ({ key: String(r.slot), ...r })), { key: "league", ...preview.league }].map(p =>
        <button type="button" key={p.key} aria-pressed={p.key === potKey} aria-controls="rehearsal-pot" aria-label={`${labelPot(p.key)} · ${amount(p.budgetWei)}`}
          className="min-w-0"
          onClick={() => choose({ pot: p.key })}>
          <strong className="block">{labelPot(p.key)} · {amount(p.budgetWei)}</strong>
          <progress className={editorial.potProgress} max={10000} value={p.budgetWei ? Number(p.proposedWei * 10000n / p.budgetWei) : 0}
            aria-label={`${labelPot(p.key)} · ${t("rewards.rehearsal.proposed")}`} aria-valuetext={amount(p.proposedWei)} />
        </button>)}</div>
    </section>
    <RewardDistributionTree root={{ id: `programme:${stage}:${cohort}`, label: t("rewards.rehearsal.proposed"), wei: preview.budgetWei,
      children: [...preview.rounds.map(p => allocationPotNode(p, String(p.slot), labelPot(String(p.slot)), {
        family: key => t(key === "athlete_standings" ? "rewards.distribution.athlete" : "rewards.distribution.club"), category: categoryName, beneficiary: recipient, remaining: copy.remaining,
      })), allocationPotNode(preview.league, "league", labelPot("league"), {
        family: key => t(key === "participation_metres" ? "rewards.rehearsal.distanceRows" : key === "athlete_standings" ? "rewards.distribution.athlete" : "rewards.distribution.club"), category: categoryName, beneficiary: recipient, remaining: copy.remaining,
      })] }} />
    <section id="rehearsal-pot" className={`${editorial.ledger} space-y-4`} aria-label={t("rewards.rehearsal.selected")}>
      <h2 className="font-display text-xl font-bold">{labelPot(potKey)} · {amount(pot.budgetWei)}</h2>
      <label className="grid max-w-xl gap-2 text-sm font-semibold" htmlFor="rehearsal-category">{t("rewards.published.category")}
        <select id="rehearsal-category" aria-label={t("rewards.published.category")} className="min-w-0 rounded-md border bg-background p-3" value={selected.categoryId} onChange={e => choose({ category: e.target.value })}>
          {options.map(c => <option key={c.categoryId} value={c.categoryId}>{categoryName(c.categoryId)}</option>)}
        </select>
      </label>
      <p className="break-words text-sm [overflow-wrap:anywhere]">{t("rewards.rehearsal.budget")}: {amount(selected.budgetWei)} · {t("rewards.rehearsal.retained")}: {amount(selected.retainedWei)}</p>
      <p className="text-sm text-muted-foreground">{t("rewards.rehearsal.ranks", { clubs: clubCount, unusedFrom: clubCount + 1 })}</p>
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-semibold">{t("rewards.rehearsal.scoringRules")}</summary>
        <p className="mt-2 text-muted-foreground">{t("rewards.rehearsal.scoringPolicy", { best: fixture.policy.bestN,
          minimum: fixture.policy.minimumRounds, members: fixture.policy.clubMembersPerRound })}</p>
        {fixture.policy.pointsTables.filter(table => selected.target === "club" || table.categoryId === selected.categoryId).map(table =>
          <p key={table.categoryId} className="mt-2"><strong>{categoryName(table.categoryId)}</strong>: {table.points.join(", ")}</p>)}
      </details>
      {selected.hold ? <p role="status" className="rounded-md bg-muted p-3 text-sm">{t("rewards.rehearsal.held")} <code>{selected.hold}</code></p>
        : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">{t("rewards.rehearsal.rankTable")}</caption>
          <thead><tr className="border-b"><th className="p-2" scope="col">{t("rewards.mapping.place")}</th><th className="p-2" scope="col">{t("rewards.published.beneficiary")}</th><th className="p-2" scope="col">{t("rewards.rehearsal.proposed")}</th></tr></thead>
          <tbody>{selected.awards.map(a => {
            const score = scoreRows.get(a.beneficiaryId), name = recipient(a.beneficiaryId, selected.target === "club");
            const key = `${stage}:${potKey}:${selected.categoryId}:${a.beneficiaryId}`, open = expandedScore === key, detailId = `rehearsal-score-${a.beneficiaryId}`;
            return <Fragment key={a.beneficiaryId}><tr className="border-b last:border-0"><td className="p-2 align-top">{a.rank}</td>
            <th scope="row" className="p-2 font-normal"><button type="button" aria-expanded={open} aria-controls={open ? detailId : undefined}
              className="text-left underline decoration-dotted underline-offset-4" onClick={() => setExpandedScore(open ? null : key)}>{name}</button></th>
            <td className="max-w-xs break-words p-2 align-top [overflow-wrap:anywhere]">{amount(a.amountWei)}</td></tr>
            {open ? <tr className="border-b"><td colSpan={3} className="bg-muted/30 p-3 sm:p-4"><div id={detailId} role="region" aria-label={name} className="scroll-mt-44">
              <p className="font-semibold">{name}</p>
              <p className="mt-2 break-all text-xs text-muted-foreground">{t("rewards.rehearsal.sourceRow")}: {a.sourceRowId}</p>
              {score ? <div className="mt-2 space-y-2">
                <p className="font-semibold">{t("rewards.rehearsal.scoredPoints", { points: score.points })}</p>
                <ul className="space-y-1 text-xs">{score.roundScores.map((points, i) => (potKey === "league" || Number(potKey) === i + 1) ?
                  <li key={i}>{t("rewards.programme.round", { number: i + 1 })}: {points} · {t(score.countedRounds[i] ? "rewards.rehearsal.counted" : "rewards.rehearsal.notCounted")}</li> : null)}</ul>
                {selected.target === "club" ? <details><summary className="cursor-pointer text-xs font-semibold">{t("rewards.rehearsal.contributors")}</summary>
                  <div className="mt-2 space-y-2 text-xs">{score.roundScores.map((points, i) => {
                    const contributors = score.contributors.filter(row => row.round === i + 1);
                    if (!contributors.length) return null;
                    const label = (row: typeof contributors[number]) => `${recipient(row.athleteId)}: ${row.points} · ${t(row.counted ? "rewards.rehearsal.counted" : "rewards.rehearsal.notCounted")}`;
                    return <details key={i}><summary className="cursor-pointer">{t("rewards.programme.round", { number: i + 1 })}: {points}</summary>
                      <ul className="mt-1 space-y-1">{contributors.filter(row => row.counted).map(row => <li key={row.athleteId}>{label(row)}</li>)}</ul>
                      {contributors.some(row => !row.counted) ? <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">{t("rewards.rehearsal.otherContributors")}</summary>
                        <ul className="mt-1 space-y-1">{contributors.filter(row => !row.counted).map(row => <li key={row.athleteId}>{label(row)}</li>)}</ul>
                      </details> : null}
                    </details>;
                  })}</div></details> : null}
              </div> : null}</div></td></tr> : null}</Fragment>; })}</tbody>
        </table></div>}
    </section>
    {potKey === "league" ? <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6" aria-label={t("rewards.rehearsal.distance")}>
      <h2 className="font-display text-xl font-bold">{t("rewards.rehearsal.distance")} · {amount(distance.budgetWei)}</h2>
      <p className="text-sm text-muted-foreground">{t("rewards.rehearsal.distanceHelp")}</p>
      {distance.hold ? <p role="status" className="rounded-md bg-muted p-3 text-sm">{t("rewards.rehearsal.held")} <code>{distance.hold}</code></p> : <>
        <p className="text-sm">{t("rewards.rehearsal.denominator", { metres: distance.totalMetres.toString(), count: distance.awards.length })}</p>
        <details><summary className="cursor-pointer text-sm font-semibold">{t("rewards.rehearsal.distanceRows")}</summary>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t("rewards.rehearsal.distanceRows")}</caption>
            <thead><tr className="border-b"><th className="p-2" scope="col">{t("rewards.published.beneficiary")}</th><th className="p-2" scope="col">{t("rewards.rehearsal.metres")}</th><th className="p-2" scope="col">{t("rewards.rehearsal.proposed")}</th></tr></thead>
            <tbody>{distance.awards.map(a => <tr key={a.beneficiaryId} className="border-b last:border-0"><th scope="row" className="p-2 font-normal">{recipient(a.beneficiaryId)}</th><td className="p-2">{a.metres.toString()}</td><td className="max-w-xs break-words p-2 [overflow-wrap:anywhere]">{amount(a.amountWei)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </section> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.rehearsal.paymentGate")}</p>
  </div>;
}
