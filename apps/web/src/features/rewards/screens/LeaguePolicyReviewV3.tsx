import { useEffect, useRef, useState } from "react";
import { decodeLeagueScoringPolicyV3, type LeaguePolicyChangeV3, type LeagueScoringPolicyV3 } from "@raceson/domain/rewards/league-standings-v3";
import type { LeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestLeaguePolicyV3 } from "../data/leaguePolicyV3";
import LeagueStandingsInspectorV3 from "./LeagueStandingsInspectorV3";

type TieBreak = LeagueScoringPolicyV3["categories"][number]["tieBreak"];
type Fields = { categoryId: string; points: string; participationPoints: string; bestN: string; minimumRounds: string; tieBreak: TieBreak | "" };
const form = (v: LeaguePolicyViewV3): Fields[] => v.categories.filter(c => c.target === "individual").map(c => {
  const r = v.review?.contextHash === v.contextHash ? v.review.policy.categories.find(r => r.categoryId === c.id) : null;
  return { categoryId: c.id, points: r?.points.join(", ") ?? "", participationPoints: String(r?.participationPoints ?? ""),
    bestN: String(r?.bestN ?? ""), minimumRounds: String(r?.minimumRounds ?? ""), tieBreak: r?.tieBreak ?? "" };
});
function policy(view: LeaguePolicyViewV3 | null, fields: Fields[], members: string): LeagueScoringPolicyV3 | null {
  if (!view) return null;
  const number = (s: string) => /^(0|[1-9][0-9]*)$/.test(s.trim()) ? Number(s) : NaN;
  try { return decodeLeagueScoringPolicyV3({ schema: "raceson-league-scoring-policy-v3", categories: fields.map(f => ({ ...f,
    points: f.points.split(",").map(number), participationPoints: number(f.participationPoints), bestN: number(f.bestN), minimumRounds: number(f.minimumRounds) })),
    club: { categoryId: view.categories.find(c => c.target === "club")?.id, membersPerRound: number(members) } }); } catch { return null; }
}
export default function LeaguePolicyReviewV3({ record, dirty }: { record: SavedRewardPlanningDraft; dirty: boolean }) {
  const { t } = useI18n(), [view, setView] = useState<LeaguePolicyViewV3 | null>(null), [fields, setFields] = useState<Fields[]>([]);
  const [members, setMembers] = useState(""), [category, setCategory] = useState("");
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [confirmed, setConfirmed] = useState(false), [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<LeaguePolicyChangeV3 | null>(null);
  const generation = useRef(0), sending = useRef(false);
  function accept(v: LeaguePolicyViewV3) {
    const next = form(v); setView(v); setFields(next); setCategory(next[0]?.categoryId ?? "");
    setMembers(v.review?.contextHash === v.contextHash ? String(v.review.policy.club.membersPerRound) : ""); setConfirmed(false);
  }
  useEffect(() => {
    const token = generation, current = ++token.current; sending.current = false;
    setView(null); setFields([]); setMembers(""); setPending(null); setBusy(true); setFailed(false); setSaved(false);
    void requestLeaguePolicyV3(record).then(v => { if (current === token.current) accept(v); })
      .catch(() => { if (current === token.current) setFailed(true); }).finally(() => { if (current === token.current) setBusy(false); });
    return () => { token.current++; };
  }, [record]);
  const parsed = policy(view, fields, members), unchanged = Boolean(parsed && view?.review && view.review.contextHash === view.contextHash && canonical(parsed) === canonical(view.review.policy));
  function edited() { setConfirmed(false); setSaved(false); }
  async function act(decision?: "selected" | "held") {
    if (sending.current || busy || dirty || (decision && (!view || !parsed || !confirmed))) return;
    const change = pending ?? (decision && view && parsed ? { requestId: crypto.randomUUID(), expectedReviewId: view.review?.id ?? null,
      contextHash: view.contextHash, decision, policy: parsed } : null);
    const current = ++generation.current; sending.current = true; setBusy(true); setFailed(false); setSaved(false); setView(null); setConfirmed(false); if (change) setPending(change);
    try { const v = await requestLeaguePolicyV3(record, change ?? undefined);
      if (current === generation.current) { accept(v); setPending(null); setSaved(Boolean(change)); } }
    catch { if (current === generation.current) setFailed(true); }
    finally { if (current === generation.current) { sending.current = false; setBusy(false); } }
  }
  const selected = fields.find(f => f.categoryId === category), inputClass = "mt-1 w-full min-w-0 rounded border bg-background p-2 text-sm";
  return <section id="league-scoring-policy" aria-label={t("rewards.leaguePolicy.title")} className="scroll-mt-48 space-y-4 rounded border border-primary/40 p-4 md:scroll-mt-24">
    <h3 className="text-lg font-semibold">{t("rewards.leaguePolicy.title")}</h3><p className="text-sm">{t("rewards.leaguePolicy.help")}</p>
    <p className="rounded bg-muted p-3 text-sm">{t("rewards.leaguePolicy.boundary")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t(pending ? "rewards.continuity.uncertain" : "rewards.leaguePolicy.error")}</p> : null}
    {saved ? <p role="status">{t("rewards.leaguePolicy.saved")}</p> : null}
    {view ? <>
      <p className="font-medium">{t(`rewards.leaguePolicy.state.${view.reviewState}`)}</p>
      <fieldset disabled={busy || dirty} className="min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">{t("rewards.leaguePolicy.editor")}</legend>
        <div className="rounded border p-3 text-sm"><p>{t("rewards.leaguePolicy.exampleHelp")}</p>
          <button type="button" className="mt-2 rounded border px-3 py-2" onClick={() => { edited(); setMembers("3"); setFields(f => f.map(c => ({ ...c, points: "100, 80, 60, 50, 40, 30, 20, 15, 10, 5", participationPoints: "1", bestN: "4", minimumRounds: "2", tieBreak: "best_finish" }))); }}>{t("rewards.leaguePolicy.example")}</button></div>
        <label className="block text-sm">{t("rewards.leaguePolicy.editCategory")}<select aria-label={t("rewards.leaguePolicy.editCategory")} className={inputClass} value={category} onChange={e => setCategory(e.target.value)}>
          {view.categories.filter(c => c.target === "individual").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {selected ? <div className="grid gap-3 md:grid-cols-2">
          {(["points", "participationPoints", "bestN", "minimumRounds"] as const).map(key => <label key={key} className={`block min-w-0 text-sm ${key === "points" ? "md:col-span-2" : ""}`}>
            {t(`rewards.leaguePolicy.field.${key}`)}<input className={inputClass} type="text" inputMode={key === "points" ? "text" : "numeric"} value={selected[key]}
              onChange={e => { edited(); setFields(f => f.map(c => c.categoryId === category ? { ...c, [key]: e.target.value } : c)); }} /></label>)}
          <label className="block text-sm">{t("rewards.leaguePolicy.field.tieBreak")}<select aria-label={t("rewards.leaguePolicy.field.tieBreak")} className={inputClass} value={selected.tieBreak} onChange={e => { edited(); setFields(f => f.map(c => c.categoryId === category ? { ...c, tieBreak: e.target.value as TieBreak | "" } : c)); }}>
            <option value="">{t("rewards.continuity.choose")}</option>{(["best_finish", "most_wins", "last_round"] as const).map(key => <option key={key} value={key}>{t(`rewards.leaguePolicy.tie.${key}`)}</option>)}</select></label>
        </div> : null}
        <p className="text-xs text-muted-foreground">{t("rewards.leaguePolicy.validation")}</p>
        <label className="block text-sm">{t("rewards.leaguePolicy.members")}<input className={inputClass} type="text" inputMode="numeric" value={members} onChange={e => { edited(); setMembers(e.target.value); }} /></label>
      </fieldset>
      <details className="rounded border p-3 text-sm"><summary className="cursor-pointer">{t("rewards.leaguePolicy.summary", { count: fields.length })}</summary>
        <ul className="mt-2 space-y-2">{fields.map(f => <li key={f.categoryId} className="min-w-0 break-words"><strong>{view.categories.find(c => c.id === f.categoryId)?.name}</strong>
          <p>{t("rewards.leaguePolicy.policyLine", { points: f.points || "—", fallback: f.participationPoints || "—", best: f.bestN || "—", minimum: f.minimumRounds || "—" })}</p>
          <p>{f.tieBreak ? t(`rewards.leaguePolicy.tie.${f.tieBreak}`) : "—"}</p></li>)}</ul></details>
      {!parsed ? <p role="status" className="text-sm">{t("rewards.leaguePolicy.incomplete")}</p> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy || dirty || !parsed} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{t("rewards.leaguePolicy.confirm")}</span></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" disabled={busy || dirty || !parsed || !confirmed} onClick={() => void act("selected")}>{t("rewards.leaguePolicy.save")}</button>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || dirty || !parsed || !confirmed} onClick={() => void act("held")}>{t("rewards.leaguePolicy.hold")}</button></div>
      {view.review ? <p className="break-all text-xs text-muted-foreground">{view.review.id} · {view.review.reviewedAt}</p> : null}
      {unchanged && !dirty && view.proposal ? <LeagueStandingsInspectorV3 key={view.proposalHash} view={view} /> : view.proposal ? <p role="status">{t("rewards.leaguePolicy.unsaved")}</p> : null}
    </> : null}
    <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || dirty} onClick={() => void act()}>{t(pending ? "rewards.continuity.retry" : "rewards.leaguePolicy.reload")}</button>
    {dirty ? <p role="status">{t("rewards.published.savedOnly")}</p> : null}
  </section>;
}
