import editorial from "../components/RewardEditorial.module.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { useAuth } from "@/lib/auth";
import { organizerWorkspaceSessionStorageKey, useOrganizerWorkspace } from "@/lib/organizer-workspace";
import { useI18n } from "@/shared/i18n/I18nContext";
import { listPlanningDrafts, readPlanningDraft, savePlanningDraft } from "../data/planningDrafts";
import OrganizerProgrammeWorkspace from "./OrganizerProgrammeWorkspace";
import { athleteUxCopy } from "../model/athleteUxCopy";

function SavedWorkspace({ integrated, organizationId, userId, switchOrganization }: {
  integrated: boolean; organizationId: string | null; userId: string; switchOrganization: (id: string) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const requestedDraft = search.get("draft");
  const [records, setRecords] = useState<SavedRewardPlanningDraft[]>([]);
  const [record, setRecord] = useState<SavedRewardPlanningDraft | null>(null);
  const [otherWorkspace, setOtherWorkspace] = useState<SavedRewardPlanningDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const loaded = useRef<{ draftId: string; reload: number } | null>(null);
  useEffect(() => {
    // The first chart selection makes the already loaded draft explicit in the
    // URL. That is navigation within this draft, not a request to discard edits.
    if (requestedDraft && loaded.current?.draftId === requestedDraft && loaded.current.reload === reload) return;
    let active = true;
    loaded.current = null;
    setLoading(true); setFailed(false); setRecord(null); setRecords([]); setOtherWorkspace(null);
    void listPlanningDrafts().then(async all => {
      const rows = integrated ? all.filter(r => r.organizationId === organizationId) : all;
      // A deep link may target another organization this account can access.
      // Offer an explicit workspace switch; never load its detail in the current
      // organization or silently substitute a different draft.
      const requested = requestedDraft ? all.find(r => r.draftId === requestedDraft) : null;
      const selected = requestedDraft ? rows.find(r => r.draftId === requestedDraft) : rows[0];
      const first = selected ? await readPlanningDraft(selected) : null;
      if (active) {
        loaded.current = first ? { draftId: first.draftId, reload } : null;
        setRecords(rows); setRecord(first);
        setOtherWorkspace(integrated && requested && requested.organizationId !== organizationId ? requested : null);
      }
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, integrated, organizationId, requestedDraft]);
  const tools = <details className={editorial.workspaceTools}><summary className="cursor-pointer">{t("rewards.visual.tools")}</summary><div className="flex flex-wrap gap-4 py-3">
    <Link className="text-primary underline" to={(integrated ? "/rewards/manage" : "/organizer/reward-planner") + (record ? `?draft=${record.draftId}` : "")}
      onClick={() => { if (!integrated && record) window.sessionStorage.setItem(organizerWorkspaceSessionStorageKey(userId), record.organizationId); }}>
      {t(integrated ? "rewards.saved.openStandalone" : "rewards.saved.openPortal")}</Link>
    <Link className="text-primary underline" to="/rewards/events">{t("nav.events")}</Link>
    {record ? <><a className="text-primary underline" href="#source-mapping">{t("rewards.mapping.title")}</a>
    <a className="text-primary underline" href="#programme-funding">{t("rewards.fundingV3.title")}</a></> : null}
    {record?.draftId === "9a000000-0000-4000-8000-000000000052" && record.chainId === 10143 ? <a className="text-primary underline" href="#testnet-pilot">{t("rewards.pilot.title")}</a> : null}
    {record ? <a className="text-primary underline" href="#published-preview">{t("rewards.published.title")}</a> : null}
    <button className="underline" disabled={loading} onClick={() => setReload(n => n + 1)}>{t("rewards.saved.reload")}</button>
    <span className="text-muted-foreground">{t("rewards.saved.switchHelp")}</span>
  </div></details>;
  if (loading) return <>{tools}<p role="status" className="p-6">{t("rewards.loading")}</p></>;
  if (failed) return <>{tools}<p role="alert" className="p-6">{t("rewards.saved.loadError")}</p></>;
  if (otherWorkspace) return <>{tools}<section className="mx-auto max-w-3xl space-y-4 rounded-lg border p-6" aria-label={t("rewards.saved.otherWorkspaceTitle")}>
    <h1 className="text-xl font-semibold">{t("rewards.saved.otherWorkspaceTitle")}</h1>
    <p>{t("rewards.saved.otherWorkspace", { organization: otherWorkspace.organizationName })}</p>
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => switchOrganization(otherWorkspace.organizationId)}>
      {t("rewards.saved.switchWorkspace", { organization: otherWorkspace.organizationName })}</button>
  </section></>;
  if (!record) return <>{tools}<section className={editorial.page}>
    <header className={editorial.hero}><p>{t("rewards.pilot")}</p><h1>{t("rewards.saved.navigation")}</h1><p>{t("rewards.saved.empty")}</p></header>
    <Link className="text-primary underline" to="/rewards">{t("rewards.saved.openStandalone")}</Link>
  </section></>;
  return <>{records.length > 1 ? <div className="mx-auto max-w-[1320px] px-4">
    <label className="block min-w-0 text-sm">{t("rewards.saved.choose")} <select className="mt-1 block w-full max-w-xl rounded-md border border-input bg-background p-2" value={record.draftId} onChange={event => {
      const selected = records.find(r => r.draftId === event.target.value);
      if (!selected) return;
      setSearch({ draft: selected.draftId });
    }}>{records.map(r => <option key={r.draftId} value={r.draftId}>{r.organizationName} / {r.seasonName}</option>)}</select></label>
  </div> : null}
    <OrganizerProgrammeWorkspace key={`${record.draftId}:${record.revision}`} record={record} integrated={integrated}
      save={async rules => { const next = await savePlanningDraft(record, rules); setRecord(next); setRecords(rows => rows.map(r => r.draftId === next.draftId ? next : r)); }} />
    {tools}
  </>;
}
export default function SavedRewardProgramme({ integrated = false }: { integrated?: boolean }) {
  const { t, locale } = useI18n(), { user, session, account, isLoading } = useAuth();
  const workspace = useOrganizerWorkspace();
  const identityKey = useMemo(() => session ? crypto.randomUUID() : "signed-out", [session]);
  if (isLoading) return <p role="status" className="p-6">{t("rewards.loading")}</p>;
  if (!user || !session || account?.userId !== user.id) return <div className="p-6">
    <p>{t("rewards.error.signIn")}</p><Link className="text-primary underline" to="/auth?next=%2Frewards%2Fmanage">{t("common.signIn")}</Link>
  </div>;
  if (account.hasOrganizerAccess === false) { const copy=athleteUxCopy(locale); return <section className={editorial.page}>
    <header className={editorial.hero}><h1>{copy.organiserTitle}</h1><p>{copy.organiserHelp}</p></header>
    <div className="flex flex-wrap gap-4"><Link className="text-primary underline" to="/athlete/rewards">{copy.athleteBack}</Link>
    <Link className="text-primary underline" to="/rewards/rehearsal">{copy.calculator}</Link></div>
  </section>; }
  const organizationId = integrated ? workspace.selectedOrganizationId : null;
  return <SavedWorkspace key={`${user.id}:${identityKey}:${organizationId}`} integrated={integrated} organizationId={organizationId} userId={user.id}
    switchOrganization={id => { if (workspace.organizations.some(org => org.organizationId === id)) workspace.selectOrganization(id); }} />;
}
