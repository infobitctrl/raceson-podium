import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { getFinalClubAwardsV3 } from "../data/finalClubAwardsV3";
import { organizerClubCopyV3 } from "../model/organizerClubCopyV3";
const OrganizerClubAwardsV3 = lazy(() => import("./OrganizerClubAwardsV3"));
export default function FinalClubAwardsV3(props: { record: SavedRewardPlanningDraft; dirty: boolean }) {
  return <Workspace key={`${props.record.draftId}:${props.record.chainId}:${props.record.revision}:${props.dirty}`} {...props} />;
}
function Workspace({ record, dirty }: { record: SavedRewardPlanningDraft; dirty: boolean }) {
  const { t,locale } = useI18n(), copy = organizerClubCopyV3(locale);
  const [slot,setSlot] = useState<5|6>(5), [data,setData] = useState<Awaited<ReturnType<typeof getFinalClubAwardsV3>>>(null);
  const [busy,setBusy] = useState(false), [failed,setFailed] = useState(false), [loaded,setLoaded] = useState(false);
  const epoch = useRef(0), flight = useRef(false);
  useEffect(() => { const v = ++epoch.current; return () => {epoch.current = v + 1;}; }, []);
  async function load() {
    if (flight.current || dirty) return; const v = epoch.current; flight.current = true;
    setBusy(true);setFailed(false);setLoaded(false);setData(null);
    try { const d = await getFinalClubAwardsV3(record,slot); if (v === epoch.current) {setData(d);setLoaded(true);} }
    catch {if (v === epoch.current) setFailed(true);}
    finally {if (v === epoch.current) {flight.current = false;setBusy(false);}}
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label={copy.finaleTitle}>
    <h3 className="font-semibold">{copy.finaleTitle}</h3><p className="text-sm">{copy.finaleHelp}</p>
    <label className="block text-sm">{t("rewards.mapping.pot")}
      <select disabled={busy || dirty} className="ml-2 rounded border bg-background p-2" value={slot}
        onChange={e => {setSlot(Number(e.target.value) as 5|6);setData(null);setLoaded(false);setFailed(false);}}>
        <option value={5}>{t("rewards.mapping.round",{round:5})}</option><option value={6}>{t("rewards.mapping.league")}</option>
      </select></label>
    <Button variant="outline" disabled={busy || dirty} onClick={() => void load()}>{t("rewards.historical.reload")}</Button>
    {busy ? <p role="status">{t("rewards.loading")}</p> : failed ? <p role="alert">{copy.error}</p> : null}
    {loaded && !data ? <p>{copy.noFinalUpload}</p> : null}
    {data && !data.current ? <p role="status">{copy.stale}</p> : null}
    {data ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><OrganizerClubAwardsV3 context={data.context} dirty={dirty || !data.current} /></Suspense> : null}
  </section>;
}
