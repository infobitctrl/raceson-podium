import { useEffect, useRef, useState } from "react";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestNativeFinaleSourceV3 } from "../data/nativeFinaleSourceV3";

type View = Awaited<ReturnType<typeof requestNativeFinaleSourceV3>>;
export default function NativeFinaleSourceV3({ record, bindingId, dirty }: { record: SavedRewardPlanningDraft; bindingId: string; dirty: boolean }) {
  const { t, locale } = useI18n(), [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0), generation = useRef(0), sending = useRef(false);
  useEffect(() => {
    const requestGeneration = generation;
    const current = ++requestGeneration.current; setView(null); setBusy(true); setFailed(false); setPage(0);
    void requestNativeFinaleSourceV3(record, bindingId).then(v => { if (current === requestGeneration.current) setView(v); })
      .catch(() => { if (current === requestGeneration.current) setFailed(true); })
      .finally(() => { if (current === requestGeneration.current) setBusy(false); });
    return () => { requestGeneration.current++; };
  }, [record, bindingId]);
  async function refresh() {
    if (sending.current || busy || dirty) return;
    sending.current = true; const current = ++generation.current; setView(null); setBusy(true); setFailed(false); setPage(0);
    try { const v = await requestNativeFinaleSourceV3(record, bindingId); if (current === generation.current) setView(v); }
    catch { if (current === generation.current) setFailed(true); }
    finally { sending.current = false; if (current === generation.current) setBusy(false); }
  }
  const rows = view?.document.races.flatMap(r => r.rows) ?? [];
  return <section aria-label={t("rewards.nativeFinale.title")} className="space-y-3 rounded border border-primary/40 p-3">
    <h4 className="text-lg font-semibold">{t("rewards.nativeFinale.title")}</h4>
    <p className="text-sm">{t("rewards.nativeFinale.help")}</p>
    <p className="rounded bg-muted p-3 text-sm">{t("rewards.nativeFinale.notApproval")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t("rewards.nativeFinale.error")}</p> : null}
    {view ? <>
      <p className="font-medium">{t(view.inspection.state === "held" ? "rewards.nativeFinale.held" : "rewards.nativeFinale.final")}</p>
      {view.inspection.holds.length ? <ul className="list-inside list-disc text-sm">{view.inspection.holds.map(h => <li key={h}>{t(`rewards.nativeFinale.hold.${h}`)}</li>)}</ul> : null}
      <p className="text-sm">{t("rewards.nativeFinale.counts", { rows: view.inspection.resultCount, finished: view.inspection.finishedCount,
        metres: view.inspection.observedFinishedMetres })}</p>
      <p className="text-xs text-muted-foreground">{t("rewards.nativeFinale.identity")}</p>
      {view.document.races.map(r => <details key={r.raceId} className="rounded border p-2 text-xs">
        <summary className="cursor-pointer break-all">{t("rewards.nativeFinale.race", { id: r.raceId })}</summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          <div><dt>{t("rewards.nativeFinale.publication")}</dt><dd className="break-all font-mono">{r.publication?.id ?? "—"}</dd></div>
          <div><dt>{t("rewards.nativeFinale.run")}</dt><dd className="break-all font-mono">{r.run?.id ?? "—"}</dd></div>
          <div><dt>{t("rewards.nativeFinale.review")}</dt><dd>{r.review.reviewSeconds ?? "—"}</dd></div>
          <div><dt>{t("rewards.nativeFinale.started")}</dt><dd>{r.review.startedAt ? new Date(r.review.startedAt).toLocaleString(locale) : "—"}</dd></div>
          <div><dt>{t("rewards.nativeFinale.ends")}</dt><dd>{r.review.endsAt ? new Date(r.review.endsAt).toLocaleString(locale) : "—"}</dd></div>
          <div><dt>{t("rewards.nativeFinale.official")}</dt><dd>{r.review.officialPublishedAt ? new Date(r.review.officialPublishedAt).toLocaleString(locale) : "—"}</dd></div>
        </dl>
      </details>)}
      {!rows.length ? <p>{t("rewards.nativeFinale.empty")}</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="py-2 text-left">{t("rewards.nativeFinale.rows")}</caption>
          <thead><tr>{(["athlete", "club", "rank", "time"] as const).map(k => <th className="p-2" key={k}>{t(`rewards.nativeFinale.column.${k}`)}</th>)}</tr></thead>
          <tbody>{rows.slice(page * 25, page * 25 + 25).map(r => <tr className="border-t align-top" key={r.id}>
            <td className="max-w-48 break-all p-2 font-mono">{r.athleteId}</td><td className="max-w-48 break-all p-2 font-mono">{r.clubId ?? "—"}</td>
            <td className="p-2">{r.rankOverall ?? "—"}</td><td className="p-2">{r.finishTimeMs ?? "—"}</td>
          </tr>)}</tbody></table></div>
        <div className="flex gap-2"><button type="button" className="rounded border p-2 text-sm disabled:opacity-50" disabled={page === 0}
          onClick={() => setPage(p => p - 1)}>{t("rewards.nativeFinale.previous")}</button>
          <button type="button" className="rounded border p-2 text-sm disabled:opacity-50" disabled={(page + 1) * 25 >= rows.length}
            onClick={() => setPage(p => p + 1)}>{t("rewards.nativeFinale.next")}</button></div>
      </>}
      <details className="text-xs"><summary className="cursor-pointer">{t("rewards.nativeFinale.digest")}</summary><p className="break-all font-mono">{view.sourceHash}</p></details>
    </> : null}
    <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || dirty} onClick={() => void refresh()}>{t("rewards.nativeFinale.refresh")}</button>
    {dirty ? <p role="status" className="text-sm">{t("rewards.published.savedOnly")}</p> : null}
  </section>;
}
