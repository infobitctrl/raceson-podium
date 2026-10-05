import { useEffect, useRef, useState } from "react";
import type { RewardResultReviewV3 } from "@raceson/domain/rewards/result-review-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { resultReviewV3 } from "../data/resultReviewV3";

function RaceReview({ categoryId, organizationId }: { categoryId: string; organizationId: string }) {
  const { t, locale } = useI18n();
  const [record, setRecord] = useState<RewardResultReviewV3 | null>(null);
  const [hours, setHours] = useState("24"), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [error, setError] = useState<"load" | "missing" | "conflict" | "save" | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setRecord(null); setError(null); setSaved(false);
    void resultReviewV3(categoryId, organizationId).then(value => {
      if (active) { setRecord(value); setHours(String((value.reviewSeconds ?? 86400) / 3600)); }
    }).catch(e => { if (active) setError(e?.status === 404 ? "missing" : "load"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [categoryId, organizationId, reload]);
  const seconds = Number(hours) * 3600;
  const valid = hours.trim() !== "" && Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 2592000;
  async function save() {
    if (!record || record.locked || saving || !valid || error) return;
    setSaving(true); setSaved(false);
    try {
      const value = await resultReviewV3(categoryId, organizationId, { expectedRevision: record.revision, reviewSeconds: seconds });
      if (alive.current) { setRecord(value); setHours(String(value.reviewSeconds! / 3600)); setSaved(true); }
    } catch (e) { if (alive.current) setError(e && typeof e === "object" && "status" in e && e.status === 409 ? "conflict" : "save"); }
    finally { if (alive.current) setSaving(false); }
  }
  const format = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zagreb" }).format(new Date(value));
  return <div className="space-y-3">
    <button type="button" className="rounded-md border px-3 py-2 text-sm" disabled={loading || saving} onClick={() => setReload(n => n + 1)}>{t("rewards.reviewV3.reload")}</button>
    {loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{t(`rewards.reviewV3.error.${error}`)}</p> : null}
    {record ? <>
      <p className="font-medium">{t(`rewards.reviewV3.state.${record.state}`)}</p>
      <p className="text-sm text-muted-foreground">{t("rewards.reviewV3.revision", { revision: record.revision })}</p>
      {record.reviewSeconds !== null || !record.locked ? <label className="block max-w-xs text-sm">{t("rewards.reviewV3.hours")}<input type="number" min={0} max={720} step="any" value={hours}
        className="mt-1 block w-full rounded-md border border-input bg-background p-2" disabled={record.locked || saving || Boolean(error)}
        onChange={e => { setHours(e.target.value); setSaved(false); }} /></label> : null}
      {seconds === 0 ? <p className="rounded-md border border-amber-500 p-3 text-sm">{t("rewards.reviewV3.zero")}</p> : null}
      {record.locked ? <p className="text-sm">{t("rewards.reviewV3.locked")}</p> :
        <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={!valid || saving || Boolean(error)} onClick={() => void save()}>
          {t(saving ? "rewards.saved.saving" : "rewards.reviewV3.save")}</button>}
      {saved ? <p role="status">{t("rewards.reviewV3.saved")}</p> : null}
      {record.startedAt ? <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt>{t("rewards.reviewV3.started")}</dt><dd>{format(record.startedAt)}</dd></div>
        <div><dt>{t("rewards.reviewV3.ends")}</dt><dd>{format(record.endsAt!)}</dd></div>
        {record.officialPublishedAt ? <div><dt>{t("rewards.reviewV3.final")}</dt><dd>{format(record.officialPublishedAt)}</dd></div> : null}
      </dl> : null}
      {record.finalPublicationId ? <p className="break-all text-xs text-muted-foreground">{record.finalPublicationId}</p> : null}
    </> : null}
  </div>;
}
export default function ProgrammeResultReviewV3({ organizationId, races }: { organizationId: string; races: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("");
  return <section id="result-review" aria-labelledby="result-review-heading" className="space-y-4 rounded-lg border p-4">
    <h3 id="result-review-heading" className="text-lg font-semibold">{t("rewards.reviewV3.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("rewards.reviewV3.help")}</p>
    <label className="block text-sm">{t("rewards.reviewV3.race")}<select className="mt-1 block w-full rounded-md border border-input bg-background p-2"
      value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t("rewards.reviewV3.choose")}</option>
      {races.map(race => <option key={race.id} value={race.id}>{race.name}</option>)}
    </select></label>
    {selected && races.some(r => r.id === selected) ? <RaceReview key={`${organizationId}:${selected}`} categoryId={selected} organizationId={organizationId} /> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.reviewV3.notApproval")}</p>
  </section>;
}
