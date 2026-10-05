import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOrganizerWorkspace } from "@/lib/organizer-workspace";
import { useI18n } from "@/shared/i18n/I18nContext";
import { loadPortalContexts, type PortalContext } from "./portalContext";
import { contextLink, portalCopy } from "./portalLinks";
import { useRewardSessionEpoch } from "../../model/useRewardSessionEpoch";

function Sources({ organizationId }: { organizationId: string }) {
  const { locale } = useI18n(), copy = portalCopy(locale), [search] = useSearchParams();
  const draft = search.get("draft"), event = search.get("event"), season = search.get("season");
  const [rows, setRows] = useState<PortalContext[]>([]), [pending, setPending] = useState(true), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setRows([]); setPending(true); setFailed(false);
    void loadPortalContexts(organizationId, { draft, event, season }).then(result => { if (active) setRows(result); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [organizationId, draft, event, season, reload]);
  return <section className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <header className="space-y-3"><p className="text-sm text-muted-foreground">{copy.title}</p><h1 className="font-display text-3xl font-bold">{copy.context}</h1><p>{copy.notice}</p></header>
    <nav className="flex flex-wrap gap-4 text-sm font-semibold"><Link to="/organizer/events">{copy.events}</Link><Link to="/organizer/leagues">{copy.league}</Link>
      <Link to="/athlete/rewards?experience=classic">{copy.athlete}</Link><Link to="/club/rewards?experience=classic">{copy.club}</Link></nav>
    {pending ? <p role="status">{copy.loading}</p> : failed ? <div role="alert"><p>{copy.error}</p><button className="min-h-11 underline" onClick={() => setReload(n => n + 1)}>{copy.retry}</button></div>
      : !rows.length ? <p>{copy.empty}</p> : rows.map(({ record, workspace, finale }) => <article key={record.draftId} className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">{record.organizationName} / {record.seasonName}</h2>
        <p className="text-sm">{copy.revision}: {record.revision} · {copy.mapping}: {workspace.revision}</p>
        <p className="break-all font-mono text-xs">{record.draftId}</p>
        <nav className="flex flex-wrap gap-4 text-sm font-semibold">
          <Link className="text-primary underline" to={`/organizer/reward-planner?draft=${record.draftId}`}>{copy.setup}</Link>
          <Link className="text-primary underline" to={`/rewards/manage?draft=${record.draftId}`}>{copy.standalone}</Link>
          <Link to={`/organizer/leagues/${record.seasonId}`}>{copy.league}</Link>
          {!draft ? <Link to={contextLink({ draft: record.draftId })}>{copy.choose}</Link> : null}
        </nav>
        <p className="text-sm text-muted-foreground">{copy.sourceNotice}</p>
        <ol className="space-y-4">{workspace.mapping.rounds.map(mapped => {
          const round = workspace.catalogue.rounds.find(r => r.id === mapped.roundId);
          return <li key={mapped.slot} className="space-y-2 border-t pt-3">
            <h3 className="font-semibold">{mapped.slot}. {round?.name ?? copy.pending}</h3>
            {round ? <><p className="text-sm">{round.date} · {round.status}</p>
              <p className="break-all font-mono text-xs">{round.editionId}</p>
              <ul className="space-y-2 text-sm">{round.races.map(race => <li key={race.id}>{race.name} — {copy.publication}: {race.publicationState ?? copy.pending}
                <span className="block break-all font-mono text-xs">{race.publicationId ?? "—"}</span></li>)}</ul></> : null}
            {mapped.slot === 5 ? <><p className="text-sm text-muted-foreground">{copy.finale}</p>
              {finale.binding ? <><p className="break-all font-mono text-xs">{finale.binding.id}</p>
                <nav className="flex flex-wrap gap-4"><Link className="inline-block min-h-11 text-primary underline" to={`/organizer/events/${finale.binding.editionId}`}>{copy.events}</Link>
                  <Link className="inline-block min-h-11 text-primary underline" to={`/organizer/registrations/results?edition=${finale.binding.editionId}&view=official`}>{copy.results}</Link></nav></> : null}</> : null}
          </li>;
        })}</ol>
        <details className="text-xs"><summary className="min-h-11 cursor-pointer">{copy.mapping}</summary><p className="break-all font-mono">{workspace.catalogueHash}</p></details>
      </article>)}
  </section>;
}

export default function ClassicPortalContext() {
  const { user, session, account } = useAuth(), workspace = useOrganizerWorkspace();
  const { locale } = useI18n(), copy = portalCopy(locale), [search] = useSearchParams();
  const epoch = useRewardSessionEpoch(session);
  if (!user || !session || account?.userId !== user.id || !workspace.selectedOrganizationId) return <p role="status" className="p-6">{copy.loading}</p>;
  return <Sources key={`${user.id}:${epoch}:${workspace.selectedOrganizationId}:${search}`} organizationId={workspace.selectedOrganizationId} />;
}
