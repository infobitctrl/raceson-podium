import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { FinaleBindingChangeV3, FinaleBindingViewV3 } from "@raceson/domain/rewards/finale-binding-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestFinaleBindingV3 } from "../data/finaleBindingV3";
const NativeFinaleSourceV3 = lazy(() => import("./NativeFinaleSourceV3"));
const NativeContinuityReviewV3 = lazy(() => import("./NativeContinuityReviewV3"));

export default function FinaleBindingV3({ record, dirty, onSaved }: { record: SavedRewardPlanningDraft; dirty: boolean; onSaved: () => void }) {
  const { t } = useI18n(), [data, setData] = useState<FinaleBindingViewV3 | null>(null);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [saved, setSaved] = useState(false);
  const [editionId, setEditionId] = useState(""), [races, setRaces] = useState<Record<string, string>>({}), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<FinaleBindingChangeV3 | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [continuityOpen, setContinuityOpen] = useState(false);
  const live = useRef(false), sending = useRef(false);
  function accept(value: FinaleBindingViewV3) {
    setData(value); setEditionId(value.binding?.editionId ?? "");
    setRaces(Object.fromEntries(value.binding?.races.map(r => [r.competitionId, r.raceId]) ?? [])); setConfirmed(false);
  }
  // Parent instance is keyed to the saved draft revision and Auth session.
  useEffect(() => {
    live.current = true; let current = true;
    void requestFinaleBindingV3(record).then(v => { if (current) accept(v); }).catch(() => { if (current) setFailed(true); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; live.current = false; };
  }, [record]);
  const edition = data?.editions.find(e => e.id === editionId);
  const competitions = [...new Map(data?.categories.filter(c => c.target === "individual").map(c => [c.competitionId, c.competitionName]) ?? [])];
  const chosen = competitions.map(([id]) => races[id]);
  const complete = Boolean(edition) && competitions.length > 0 && chosen.every(id => edition?.races.some(r => r.id === id))
    && new Set(chosen).size === chosen.length;
  async function act(save = false) {
    if (sending.current || busy || dirty || (save && (!data || data.locked || !complete || !confirmed))) return;
    const request = pending ?? (save && data ? { requestId: crypto.randomUUID(), expectedBindingId: data.binding?.id ?? null,
      contextHash: data.contextHash, editionId, races: competitions.map(([competitionId]) => ({ competitionId, raceId: races[competitionId] })) } : null);
    sending.current = true; setBusy(true); setFailed(false); setSaved(false); setData(null); if (request) setPending(request);
    try {
      const v = await requestFinaleBindingV3(record, request ?? undefined);
      if (live.current) { accept(v); setPending(null); setSaved(Boolean(request)); if (request) onSaved(); }
    } catch { if (live.current) setFailed(true); }
    finally { sending.current = false; if (live.current) setBusy(false); }
  }
  const disabled = busy || dirty || Boolean(data?.locked);
  return <section aria-label={t("rewards.finale.title")} className="space-y-3 rounded-lg border p-4">
    <h3 className="text-lg font-semibold">{t("rewards.finale.title")}</h3>
    <p className="text-sm">{t("rewards.finale.help")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t(pending ? "rewards.finale.uncertain" : "rewards.finale.error")}</p> : null}
    {saved ? <p role="status">{t("rewards.finale.saved")}</p> : null}
    {data ? <>
      {data.locked ? <p className="rounded bg-muted p-3 text-sm">{t("rewards.finale.locked")}</p> : null}
      {!data.editions.length ? <p>{t("rewards.finale.empty")}</p> : null}
      <label className="block text-sm">{t("rewards.finale.edition")}
        <select className="mt-1 block w-full rounded border bg-background p-2" disabled={disabled} value={editionId}
          onChange={e => { setEditionId(e.target.value); setRaces({}); setConfirmed(false); setSaved(false); }}>
          <option value="">{t("rewards.finale.choose")}</option>
          {editionId && !edition ? <option value={editionId}>{t("rewards.mapping.removed")}</option> : null}
          {data.editions.map(e => <option key={e.id} value={e.id}>{e.name} · {e.date}</option>)}
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-2">{competitions.map(([id, name]) => <label key={id} className="block text-sm">{name}
        <select aria-label={t("rewards.finale.race", { competition: name })} className="mt-1 block w-full rounded border bg-background p-2"
          disabled={disabled || !edition} value={races[id] ?? ""} onChange={e => { setRaces(v => ({ ...v, [id]: e.target.value })); setConfirmed(false); setSaved(false); }}>
          <option value="">{t("rewards.finale.choose")}</option>
          {races[id] && !edition?.races.some(r => r.id === races[id]) ? <option value={races[id]}>{t("rewards.mapping.removed")}</option> : null}
          {edition?.races.map(r => <option key={r.id} value={r.id}>{r.name} · {r.distanceMetres ? `${Number(r.distanceMetres) / 1000} km` : t("rewards.mapping.distanceMissing")}</option>)}
        </select>
      </label>)}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={disabled || !complete}
        onChange={e => setConfirmed(e.target.checked)} /><span>{t("rewards.finale.confirm")}</span></label>
      <button type="button" disabled={disabled || !complete || !confirmed} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        onClick={() => void act(true)}>{t("rewards.finale.save")}</button>
      {data.binding ? <p className="break-all text-xs text-muted-foreground">{data.binding.id}</p> : null}
      {data.binding ? <>
        <button type="button" className="rounded border px-3 py-2 text-sm" aria-expanded={continuityOpen} onClick={() => setContinuityOpen(v => !v)}>{t("rewards.continuity.title")}</button>
        {continuityOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><NativeContinuityReviewV3 key={data.binding.id}
          record={record} bindingId={data.binding.id} dirty={dirty || editionId !== data.binding.editionId
            || data.binding.races.some(p => races[p.competitionId] !== p.raceId)} /></Suspense> : null}
        <button type="button" className="rounded border px-3 py-2 text-sm" aria-expanded={sourceOpen} onClick={() => setSourceOpen(v => !v)}>{t("rewards.nativeFinale.title")}</button>
        {sourceOpen ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><NativeFinaleSourceV3 key={data.binding.id}
          record={record} bindingId={data.binding.id} dirty={dirty || editionId !== data.binding.editionId
            || data.binding.races.some(p => races[p.competitionId] !== p.raceId)} /></Suspense> : null}
      </> : null}
    </> : null}
    {!busy ? <button type="button" disabled={dirty} className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void act()}>
      {t(pending ? "rewards.finale.retry" : "rewards.mapping.reload")}</button> : null}
    {dirty ? <p role="status" className="text-sm">{t("rewards.published.savedOnly")}</p> : null}
  </section>;
}
