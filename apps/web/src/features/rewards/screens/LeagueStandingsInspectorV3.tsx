import { useState } from "react";
import type { LeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
import { useI18n } from "@/shared/i18n/I18nContext";

export default function LeagueStandingsInspectorV3({ view }: { view: LeaguePolicyViewV3 }) {
  const { t, locale } = useI18n(), [kind, setKind] = useState("athletes"), [category, setCategory] = useState(view.categories.find(c => c.target === "individual")?.id ?? "");
  const [round, setRound] = useState("league"), [page, setPage] = useState(0);
  const p = view.proposal;
  if (!p) return null;
  const number = (v: number | string) => new Intl.NumberFormat(locale).format(typeof v === "string" ? BigInt(v) : v);
  const names = new Map([...view.labels.athletes, ...view.labels.clubs].map(n => [n.id, n.name]));
  const label = (id: string) => names.get(id) ?? id;
  const athletes = p.athleteTables.find(t => t.categoryId === category)?.rows ?? [];
  const clubs = p.clubTables.find(t => String(t.slot ?? "league") === round)?.rows ?? [];
  const rows = kind === "athletes" ? athletes : kind === "clubs" ? clubs : p.participation.rows;
  return <section aria-label={t("rewards.leaguePolicy.proposal")} className="scroll-mt-48 space-y-3 rounded border p-3 md:scroll-mt-24">
    <h4 className="font-semibold">{t("rewards.leaguePolicy.proposal")}</h4>
    <p className="text-sm text-muted-foreground">{t("rewards.leaguePolicy.proposalHelp")}</p>
    {p.state === "held" ? <><p role="status" className="font-medium">{t("rewards.leaguePolicy.sourceHeld")}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">{p.holds.map((h, i) => <li key={i}>
        {h.slot ? `${t("rewards.leaguePolicy.round", { round: h.slot })} · ` : ""}{h.categoryId ? `${view.categories.find(c => c.id === h.categoryId)?.name ?? h.categoryId} · ` : ""}
        {t(`rewards.leaguePolicy.hold.${h.reason}`)}</li>)}</ul></> : <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("rewards.leaguePolicy.tables")}>
        {(["athletes", "clubs", "distance"] as const).map(key => <button key={key} type="button" aria-pressed={kind === key}
          className={`rounded border px-3 py-2 text-sm ${kind === key ? "bg-primary text-primary-foreground" : ""}`} onClick={() => { setKind(key); setPage(0); }}>{t(`rewards.leaguePolicy.${key}`)}</button>)}
      </div>
      {kind === "athletes" ? <label className="block text-sm">{t("rewards.leaguePolicy.category")}<select aria-label={t("rewards.leaguePolicy.category")} className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={category}
        onChange={e => { setCategory(e.target.value); setPage(0); }}>{view.categories.filter(c => c.target === "individual").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : null}
      {kind === "clubs" ? <label className="block text-sm">{t("rewards.leaguePolicy.clubTable")}<select aria-label={t("rewards.leaguePolicy.clubTable")} className="mt-1 w-full rounded border bg-background p-2" value={round}
        onChange={e => { setRound(e.target.value); setPage(0); }}><option value="league">{t("rewards.leaguePolicy.league")}</option>
        {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{t("rewards.leaguePolicy.round", { round: r })}</option>)}</select></label> : null}
      {kind === "distance" ? <p className="rounded bg-muted p-3 text-sm">{p.participation.hold ? t("rewards.leaguePolicy.distanceHeld") : t("rewards.leaguePolicy.distanceTotal", { metres: number(p.participation.totalMetres) })}</p> : null}
      {rows.length === 0 ? <p>{t("rewards.leaguePolicy.empty")}</p> : null}
      <ol className="space-y-2">{rows.slice(page * 25, page * 25 + 25).map(r => <li key={r.beneficiaryId} className="min-w-0 rounded border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words font-medium">{label(r.beneficiaryId)}</span>
          <span className="text-sm">{"rank" in r ? `${r.rank === null ? t("rewards.leaguePolicy.ineligible") : t("rewards.leaguePolicy.rank", { rank: r.rank })} · ${t("rewards.leaguePolicy.score", { points: number(r.points) })}` : t("rewards.leaguePolicy.metres", { metres: number(r.metres) })}</span></div>
        <details className="mt-2 text-sm"><summary className="cursor-pointer">{t("rewards.leaguePolicy.explain")}</summary>
          <p className="my-2 break-all font-mono text-xs text-muted-foreground">{r.beneficiaryId}</p>
          {"rounds" in r ? <ul className="space-y-2">{r.rounds.map(s => <li key={s.sourceRowId} className="rounded bg-muted p-2">
            <p>{t("rewards.leaguePolicy.round", { round: s.slot })} · {t("rewards.leaguePolicy.rank", { rank: s.rank })} · {t("rewards.leaguePolicy.score", { points: number(s.points) })} · {t(s.counted ? "rewards.leaguePolicy.counted" : "rewards.leaguePolicy.excluded")}</p>
            <p className="break-all font-mono text-xs">{s.sourceRowId}</p></li>)}</ul> : "contributions" in r ? <ul className="space-y-2">{r.contributions.map(s => <li key={s.sourceRowId} className="rounded bg-muted p-2">
            <p>{label(s.athleteId)} · {t("rewards.leaguePolicy.round", { round: s.slot })} · {t("rewards.leaguePolicy.score", { points: number(s.points) })} · {t(s.counted ? "rewards.leaguePolicy.counted" : "rewards.leaguePolicy.excluded")}</p>
            <p className="break-all font-mono text-xs">{s.sourceRowId}</p></li>)}</ul> : <><p>{t("rewards.leaguePolicy.distanceHelp")}</p><ul className="mt-2 space-y-1 font-mono text-xs">{r.resultIds.map(id => <li className="break-all" key={id}>{id}</li>)}</ul></>}
        </details></li>)}</ol>
      <div className="flex flex-wrap items-center gap-2 text-sm"><button type="button" className="rounded border p-2 disabled:opacity-50" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("rewards.nativeFinale.previous")}</button>
        <span>{t("rewards.leaguePolicy.page", { page: page + 1, total: Math.max(1, Math.ceil(rows.length / 25)) })}</span>
        <button type="button" className="rounded border p-2 disabled:opacity-50" disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(p => p + 1)}>{t("rewards.nativeFinale.next")}</button></div>
    </>}
    <details className="text-xs"><summary>{t("rewards.leaguePolicy.digest")}</summary><p className="break-all font-mono">{view.proposalHash}</p></details>
  </section>;
}
