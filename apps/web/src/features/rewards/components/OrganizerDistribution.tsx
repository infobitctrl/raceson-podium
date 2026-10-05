import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { RewardAllocationScope, RewardAwardScope, RewardDistributionCampaign, RewardDistributionDetail } from "@raceson/domain/rewards";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOrganizerCampaigns, getOrganizerAwards, getOrganizerAwardEvidence } from "../data/organizerDistribution";
import { organizerAccessLost, organizerErrorKey } from "../model/organizerRewards";
import { formatTestMon } from "../model/athleteRewards";

type Access = { onAccessLost: (error: unknown) => void };
const Preparation = lazy(() => import("./OrganizerPreparation"));
const Sporting = lazy(() => import("./OrganizerSporting"));
const familyLabels = { podium: "rewards.programme.podium", record: "rewards.programme.record", club_performance: "rewards.programme.clubPerformance",
  athlete_metres: "rewards.programme.athleteDistance", club_finishes: "rewards.programme.clubFinishes" } as const;

/** Scope/session changes unmount this private view. No persistent cache, polling,
 * wallet calls or bulk detail reads. A failed refresh removes previous evidence. */
function usePrivateRead<T>(read: (after: string | null) => Promise<T>, onAccessLost: Access["onAccessLost"], merge?: (old: T, next: T) => T) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: true, error: null });
  const epoch = useRef(0), flight = useRef(false), lost = useRef(onAccessLost), value = useRef<T | null>(null); lost.current = onAccessLost;
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return; const ticket = ++epoch.current; flight.current = true;
    if (!after) value.current = null;
    setState({ data: value.current, loading: true, error: null });
    try {
      const next = await read(after);
      if (ticket !== epoch.current) return;
      value.current = after && merge && value.current ? merge(value.current, next) : next;
      setState({ data: value.current, loading: false, error: null });
    } catch (error) { if (ticket === epoch.current) {
      value.current = null; setState({ data: null, loading: false, error }); if (organizerAccessLost(error)) lost.current(error);
    } } finally { if (ticket === epoch.current) flight.current = false; }
  }, [read, merge]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; value.current = null; }; }, [load]);
  return { ...state, load };
}
function State({ loading, error }: { loading: boolean; error: unknown }) {
  const { t } = useI18n(); return <>{loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-destructive/30 p-4">{t(organizerErrorKey(error))}</p> : null}</>;
}
function Amount({ wei }: { wei: string }) {
  const { locale, t } = useI18n(); return <span className="tabular-nums">{wei === "0" ? "0" : formatTestMon(wei, locale)} <span className="whitespace-nowrap">{t("rewards.testMon")}</span></span>;
}
function time(ms: string) {
  const n = BigInt(ms); return `${n / 3_600_000n}:${String(n / 60_000n % 60n).padStart(2, "0")}:${String(n / 1000n % 60n).padStart(2, "0")}.${String(n % 1000n).padStart(3, "0")}`;
}
function points(hundredths: string, locale: string) {
  const n = BigInt(hundredths), fraction = String(n % 100n).padStart(2, "0").replace(/0+$/, "");
  return (n / 100n).toLocaleString(locale) + (fraction ? `${locale === "hr" ? "," : "."}${fraction}` : "");
}
function Campaigns({ programmeId, onSelect, onPrepare, onSporting, onAccessLost }: Access & { programmeId: string;
  onSelect: (campaign: RewardDistributionCampaign, chainId: 10143 | 31337) => void;
  onPrepare: (campaign: RewardDistributionCampaign, chainId: 10143 | 31337) => void;
  onSporting: (campaign: RewardDistributionCampaign, chainId: 10143 | 31337) => void }) {
  const { t } = useI18n(), read = useCallback(() => getOrganizerCampaigns(programmeId), [programmeId]);
  const state = usePrivateRead(read, onAccessLost);
  return <section className="space-y-4" aria-label={t("rewards.distribution.campaigns")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">{t("rewards.distribution.campaigns")}</h3>
      <Button variant="outline" disabled={state.loading} onClick={() => void state.load()}>{t("rewards.distribution.refresh")}</Button></div>
    <State {...state} />
    {state.data ? <><p className="text-xl font-semibold"><Amount wei={state.data.budgetWei} /></p>
      <ul className="grid gap-4 sm:grid-cols-2">{state.data.items.map(c => <li key={c.campaignId} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.pot === "race" ? t("rewards.distribution.round", { number: c.roundNumber ?? "" }) : t("rewards.programme.leaguePot")}</p>
        <h4 className="break-words font-semibold">{c.raceName ?? t(c.pot === "league" ? "rewards.programme.leaguePot" : "rewards.distribution.race")}</h4>
        <p className="text-lg font-semibold"><Amount wei={c.budgetWei} /></p>
        {c.allocation ? <><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">{t("rewards.distribution.allocated")}</dt><dd><Amount wei={c.allocation.allocatedWei} /></dd></div>
          <div><dt className="text-muted-foreground">{t("rewards.distribution.unallocated")}</dt><dd><Amount wei={c.allocation.unallocatedWei} /></dd></div></dl>
          <p className="text-sm">{t("rewards.distribution.awardCount", { count: c.allocation.awardCount })}</p>
          <Button variant="outline" className="h-auto whitespace-normal" onClick={() => onSelect(c, state.data!.chainId)}>{t("rewards.distribution.openAwards")}</Button></>
          : <><p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{t("rewards.distribution.awaiting")}</p>
            <Button variant="outline" className="h-auto whitespace-normal" onClick={() => onSporting(c, state.data!.chainId)}>{t("rewards.sporting.open")}</Button>
            <Button variant="outline" className="h-auto whitespace-normal" onClick={() => onPrepare(c, state.data!.chainId)}>{t("rewards.preparation.open")}</Button></>}
      </li>)}</ul></> : null}
  </section>;
}
type AwardsPage = Awaited<ReturnType<typeof getOrganizerAwards>>;
const mergeAwards = (old: AwardsPage, next: AwardsPage): AwardsPage => ({ ...next, items: [...old.items, ...next.items] });
function Awards({ selection, campaign, onSelect, onBack, onAccessLost }: Access & { selection: RewardAllocationScope;
  campaign: RewardDistributionCampaign; onSelect: (id: string) => void; onBack: () => void }) {
  const { t } = useI18n(), read = useCallback((after: string | null) => getOrganizerAwards(selection, after), [selection]);
  const state = usePrivateRead(read, onAccessLost, mergeAwards);
  return <section className="space-y-4" aria-label={t("rewards.distribution.awards")}>
    <Button variant="ghost" onClick={onBack}>{t("rewards.distribution.backCampaigns")}</Button>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-words text-xl font-semibold">{campaign.raceName ?? t("rewards.programme.leaguePot")}</h3>
      <Button variant="outline" disabled={state.loading} onClick={() => void state.load()}>{t("rewards.distribution.refresh")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("rewards.distribution.awardsHelp")}</p><State {...state} />
    {state.data ? <><ul className="space-y-3">{state.data.items.map(a => <li key={a.entitlementId} className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{t(a.beneficiaryKind === "athlete" ? "rewards.distribution.athlete" : "rewards.distribution.club")}</p>
        <h4 className="break-words font-semibold">{a.beneficiaryName ?? t("rewards.distribution.unnamed")}</h4><p><Amount wei={a.amountWei} /></p></div>
        <Button variant="outline" className="h-auto whitespace-normal" disabled={state.loading} onClick={() => onSelect(a.entitlementId)}>{t("rewards.distribution.openEvidence")}</Button></div>
    </li>)}</ul>
      {!state.data.items.length ? <p>{t("rewards.distribution.noAwards")}</p> : null}
      {state.data.nextCursor ? <Button variant="outline" disabled={state.loading} onClick={() => void state.load(state.data!.nextCursor)}>{t("rewards.loadMore")}</Button> : null}</> : null}
  </section>;
}
function mergeEvidence(old: RewardDistributionDetail, next: RewardDistributionDetail): RewardDistributionDetail {
  if (old.amountWei !== next.amountWei || old.sourceSnapshotId !== next.sourceSnapshotId || old.sourceCount !== next.sourceCount
    || JSON.stringify(old.breakdown) !== JSON.stringify(next.breakdown)) throw Error("reward_distribution_history_changed");
  return { ...next, sources: [...old.sources, ...next.sources] };
}
function Evidence({ selection, onBack, onAccessLost }: Access & { selection: RewardAwardScope; onBack: () => void }) {
  const { t, locale } = useI18n(), read = useCallback((after: string | null) => getOrganizerAwardEvidence(selection, after), [selection]);
  const state = usePrivateRead(read, onAccessLost, mergeEvidence), d = state.data;
  return <section className="space-y-5" aria-label={t("rewards.distribution.evidence")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" onClick={onBack}>{t("rewards.distribution.backAwards")}</Button>
      <Button variant="outline" disabled={state.loading} onClick={() => void state.load()}>{t("rewards.distribution.refresh")}</Button></div>
    <State {...state} />
    {d ? <><header className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-5"><p className="text-xs font-semibold uppercase text-muted-foreground">{t(d.beneficiaryKind === "athlete" ? "rewards.distribution.athlete" : "rewards.distribution.club")}</p>
      <h3 className="break-words text-xl font-semibold">{d.beneficiaryName ?? t("rewards.distribution.unnamed")}</h3>
      <p className="text-2xl font-bold"><Amount wei={d.amountWei} /></p>
      <p className="text-sm text-muted-foreground">{t("rewards.distribution.savedAt", { date: new Date(d.reservedAt).toLocaleString(locale) })}</p></header>
      <section className="space-y-3" aria-labelledby="distribution-breakdown"><h4 id="distribution-breakdown" className="font-semibold">{t("rewards.distribution.breakdown")}</h4>
        {d.breakdown.map(b => { const c = b.calculation; return <article key={`${b.family}:${b.scopeId}`} className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap justify-between gap-2"><h5 className="font-semibold">{t(familyLabels[b.family])}</h5><Amount wei={b.amountWei} /></div>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Number(BigInt(b.amountWei) * 10_000n / BigInt(d.amountWei)) / 100}%` }} /></div>
          {b.scopeName ? <p className="text-sm">{b.scopeName}</p> : null}
          <p className="text-sm text-muted-foreground">{c.method === "podium" ? t("rewards.distribution.podiumRule", { rank: c.rank, ties: c.tieSize, slots: c.prizeSlots.join(", "), amount: formatTestMon(c.sharedPrizeWei, locale) })
            : c.method === "record" ? t("rewards.distribution.recordRule", { before: time(c.baselineTimeMs), after: time(c.finishTimeMs), ties: c.tiedHolders })
              : t(b.family === "athlete_metres" ? "rewards.distribution.distanceRule" : "rewards.distribution.finishesRule", {
                weight: BigInt(c.weight).toLocaleString(locale), total: BigInt(c.totalWeight).toLocaleString(locale), amount: formatTestMon(c.familyBudgetWei, locale) })}</p>
          <p className="text-xs text-muted-foreground">{t("rewards.distribution.resultCount", { count: b.sourceCount })}</p>
          {c.method === "podium" && c.clubScore !== null ? <p className="text-sm">{t("rewards.distribution.clubScore", { score: points(c.clubScore, locale) })}</p> : null}
        </article>; })}
      </section>
      <section aria-labelledby="distribution-results" className="space-y-3"><h4 id="distribution-results" className="font-semibold">{t("rewards.distribution.results")}</h4>
        <p className="text-sm text-muted-foreground">{t("rewards.distribution.resultsHelp")}</p>
        <p className="text-xs text-muted-foreground">{t("rewards.distribution.showingResults", { shown: d.sources.length, total: d.sourceCount })}</p>
        <ul className="space-y-3">{d.sources.map(r => <li key={r.sourceId} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap justify-between gap-2"><p className="break-words font-semibold">{r.athleteName ?? t("rewards.distribution.unnamed")}</p>
            <p className="text-sm">{t("rewards.distribution.round", { number: r.roundNumber })}</p></div>
          <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">{t("rewards.distribution.distance")}</dt><dd>{BigInt(r.distanceMetres).toLocaleString(locale)} m</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.distribution.finishTime")}</dt><dd className="tabular-nums">{time(r.finishTimeMs)}</dd></div></dl>
          <ul className="flex flex-wrap gap-2">{[...new Set(r.contributions.map(c => c.family))].map(f => <li key={f} className="rounded-full bg-muted px-3 py-1 text-xs">{t(familyLabels[f])}</li>)}</ul>
          {r.clubPointsHundredths !== null && r.contributions.some(c => c.family === "club_performance") ? <p className="text-sm">{t("rewards.distribution.clubPoints", { score: points(r.clubPointsHundredths, locale) })}</p> : null}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t("rewards.distribution.references")}</summary>
            <dl className="mt-3 space-y-2 break-all"><div><dt>{t("rewards.distribution.resultId")}</dt><dd className="font-mono">{r.sourceId}</dd></div>
              <div><dt>{t("rewards.distribution.raceId")}</dt><dd className="font-mono">{r.raceId}</dd></div>
              <div><dt>{t("rewards.distribution.publicationId")}</dt><dd className="font-mono">{r.publicationId}</dd></div></dl></details>
        </li>)}</ul>
        {d.nextCursor ? <Button variant="outline" disabled={state.loading} onClick={() => void state.load(d.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
      </section>
      <p className="break-all text-xs text-muted-foreground">{t("rewards.distribution.snapshot")}: <span className="font-mono">{d.sourceSnapshotId}</span></p>
    </> : null}
  </section>;
}
export default function OrganizerDistribution({ programmeId, onBack, onAccessLost }: Access & { programmeId: string; onBack: () => void }) {
  const { t } = useI18n();
  const [campaign, setCampaign] = useState<{ row: RewardDistributionCampaign; scope: RewardAllocationScope } | null>(null);
  const [award, setAward] = useState<RewardAwardScope | null>(null);
  const [preparation, setPreparation] = useState<{ campaignId: string; programmeId: string; chainId: 10143 | 31337; raceName: string | null } | null>(null);
  const [sporting, setSporting] = useState<typeof preparation>(null);
  if (sporting) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Sporting key={sporting.campaignId}
    selection={sporting} raceName={sporting.raceName} onBack={() => setSporting(null)} onPrepare={() => { setPreparation(sporting); setSporting(null); }} onAccessLost={onAccessLost} /></Suspense>;
  if (preparation) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Preparation key={preparation.campaignId}
    selection={preparation} raceName={preparation.raceName} onBack={() => setPreparation(null)} onAccessLost={onAccessLost} /></Suspense>;
  return <div className="space-y-5"><Button variant="ghost" onClick={onBack}>{t("rewards.organizer.backProgrammes")}</Button>
    <h2 className="text-xl font-semibold">{t("rewards.distribution.title")}</h2>
    <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t("rewards.distribution.historyNotice")}</p>
    {award ? <Evidence key={award.entitlementId} selection={award} onBack={() => setAward(null)} onAccessLost={onAccessLost} />
      : campaign ? <Awards key={campaign.scope.allocationId} selection={campaign.scope} campaign={campaign.row} onBack={() => setCampaign(null)}
        onSelect={entitlementId => setAward({ ...campaign.scope, entitlementId })} onAccessLost={onAccessLost} />
        : <Campaigns programmeId={programmeId} onAccessLost={onAccessLost}
          onSporting={(row, chainId) => setSporting({ programmeId, campaignId: row.campaignId, chainId, raceName: row.raceName })}
          onPrepare={(row, chainId) => setPreparation({ programmeId, campaignId: row.campaignId, chainId, raceName: row.raceName })} onSelect={(row, chainId) => {
          if (row.allocation) setCampaign({ row, scope: { programmeId, chainId, campaignId: row.campaignId, allocationId: row.allocation.allocationId } });
        }} />}
  </div>;
}
