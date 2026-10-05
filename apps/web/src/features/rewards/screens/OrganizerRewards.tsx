import RewardExplorerLink from "../components/RewardExplorerLink";
import workspaceStyles from "../components/RewardWorkspace.module.css";
import editorial from "../components/RewardEditorial.module.css";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { publicEnv } from "@/lib/public-env";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOrganizerDestinations, getOrganizerProgrammes } from "../data/organizerRewards";
import { formatTestMon } from "../model/athleteRewards";
import { usePrivatePage } from "../components/usePrivatePage";
import { organizerErrorKey, type OrganizerProgramme,
  type OrganizerDestination, type OrganizerSelection, type RewardNetwork } from "../model/organizerRewards";

const Review = lazy(() => import("../components/OrganizerReadiness"));
const Distribution = lazy(() => import("../components/OrganizerDistribution"));
const ClubTreasuries = lazy(() => import("../components/OrganizerClubTreasuries"));


function Programmes({ onSelect, onExplore, onClubs, onAccessLost }: { onSelect: (programme: OrganizerProgramme) => void;
  onClubs: (programmeId: string, chainId: RewardNetwork) => void;
  onExplore: (programme: OrganizerProgramme) => void; onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n(), page = usePrivatePage(getOrganizerProgrammes, onAccessLost);
  return <section aria-labelledby="organizer-programmes" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="organizer-programmes" className="text-xl font-semibold">{t("rewards.organizer.programmes")}</h2>
      <Button variant="outline" size="sm" disabled={page.loading} onClick={() => void page.load()}>{t("rewards.organizer.refreshProgrammes")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("rewards.organizer.budgetHelp")}</p>
    {page.loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {page.error ? <p role="alert">{t(organizerErrorKey(page.error))}</p> : !page.loading && !page.items.length ? <p className="rounded-xl border border-dashed border-border p-5">{t("rewards.organizer.noProgrammes")}</p> : null}
    <ul className="grid gap-4 sm:grid-cols-2">{page.items.map(p => <li key={p.programmeId} className={`${editorial.award} space-y-3`}>
      <h3 className="break-words text-lg font-semibold">{p.leagueName ?? t("rewards.organizer.programmeFallback")}</h3>
      <p className="text-sm text-muted-foreground">{p.seasonName ?? p.year} · {t(page.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")}</p>
      <p className={editorial.awardAmount}>{formatTestMon(p.budgetWei, locale)} <span className="whitespace-nowrap text-sm">{t("rewards.testMon")}</span></p>
      <p className="text-xs text-muted-foreground">{t("rewards.organizer.configuredBudget")}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">{p.programmeId}</p>
      <Button variant="outline" className="h-auto whitespace-normal" disabled={page.loading} onClick={() => onSelect(p)}>{t("rewards.organizer.openProgramme")}</Button>
      <Button variant="outline" className="ml-2 h-auto whitespace-normal" disabled={page.loading} onClick={() => onExplore(p)}>{t("rewards.distribution.open")}</Button>
      <Button variant="outline" className="h-auto whitespace-normal" disabled={page.loading || page.chainId === null}
        onClick={() => { if (page.chainId) onClubs(p.programmeId, page.chainId); }}>{t("rewards.clubReview.open")}</Button>
    </li>)}</ul>
    {page.nextCursor ? <Button variant="outline" disabled={page.loading} onClick={() => void page.load(page.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
  </section>;
}
function Requests({ programme, onSelect, onBack, onAccessLost }: { programme: OrganizerProgramme;
  onSelect: (request: OrganizerDestination, chainId: RewardNetwork) => void; onBack: () => void; onAccessLost: (error: unknown) => void }) {
  const { t } = useI18n();
  const fetchPage = useCallback((after: string | null) => getOrganizerDestinations(programme.programmeId, after), [programme.programmeId]);
  const page = usePrivatePage(fetchPage, onAccessLost);
  return <section aria-labelledby="organizer-requests" className="space-y-4">
    <Button variant="ghost" className="h-auto whitespace-normal" onClick={onBack}>{t("rewards.organizer.backProgrammes")}</Button>
    <h2 className="break-words text-xl font-semibold">{programme.leagueName ?? t("rewards.organizer.programmeFallback")} · {programme.year}</h2>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="organizer-requests" className="font-semibold">{t("rewards.organizer.requests")}</h3>
      <Button variant="outline" size="sm" disabled={page.loading} onClick={() => void page.load()}>{t("rewards.organizer.refreshRequests")}</Button></div>
    <p className="text-sm text-muted-foreground">{t("rewards.organizer.requestsHelp")}</p>
    {page.loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {page.error ? <p role="alert">{t(organizerErrorKey(page.error))}</p> : !page.loading && !page.items.length ? <p className="rounded-xl border border-dashed border-border p-5">{t("rewards.organizer.noRequests")}</p> : null}
    <ul className="space-y-3">{page.items.map(r => <li key={r.requestId} className={`${editorial.claim} space-y-3`}>
      <h4 className="break-words font-semibold">{r.athleteName ?? t("rewards.organizer.athleteFallback")}</h4>
      <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={page.chainId ?? 0} kind="address" value={r.address}/></p>
      <p className="text-sm text-muted-foreground">{t(`rewards.organizer.destination.${r.destinationStatus}`)}</p>
      <Button variant="outline" className="h-auto whitespace-normal" disabled={page.loading || page.chainId === null}
        onClick={() => { if (page.chainId) onSelect(r, page.chainId); }}>{t("rewards.organizer.openReview")}</Button>
    </li>)}</ul>
    {page.nextCursor ? <Button variant="outline" disabled={page.loading} onClick={() => void page.load(page.nextCursor)}>{t("rewards.loadMore")}</Button> : null}
  </section>;
}
function Workspace() {
  const { t } = useI18n();
  const [programme, setProgramme] = useState<OrganizerProgramme | null>(null);
  const [distribution, setDistribution] = useState<OrganizerProgramme | null>(null);
  const [clubProgramme, setClubProgramme] = useState<{ programmeId: string; chainId: RewardNetwork } | null>(null);
  const [selected, setSelected] = useState<{ scope: OrganizerSelection; name: string | null } | null>(null);
  const [accessError, setAccessError] = useState<unknown>(null);
  if (accessError) return <div role="alert" className="space-y-4 rounded-xl border border-destructive/30 p-5">
    <p>{t(organizerErrorKey(accessError))}</p>
    <Button variant="outline" onClick={() => { setProgramme(null); setDistribution(null); setClubProgramme(null); setSelected(null); setAccessError(null); }}>{t("rewards.organizer.checkAccess")}</Button>
    <Link className="block text-sm text-primary underline" to="/auth?next=%2Forganizer%2Frewards">{t("common.signIn")}</Link>
  </div>;
  if (clubProgramme) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><ClubTreasuries key={clubProgramme.programmeId}
    {...clubProgramme} onBack={() => setClubProgramme(null)} onAccessLost={setAccessError} /></Suspense>;
  if (distribution) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Distribution key={distribution.programmeId}
    programmeId={distribution.programmeId} onBack={() => setDistribution(null)} onAccessLost={setAccessError} /></Suspense>;
  if (selected) return <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}><Review key={selected.scope.requestId}
    selection={selected.scope} athleteName={selected.name} onBack={() => setSelected(null)} onAccessLost={setAccessError} /></Suspense>;
  if (programme) return <Requests key={programme.programmeId} programme={programme} onBack={() => setProgramme(null)} onAccessLost={setAccessError}
    onSelect={(r, chainId) => setSelected({ name: r.athleteName, scope: { programmeId: programme.programmeId, chainId,
      requestId: r.requestId, athleteProfileId: r.athleteProfileId, address: r.address, requestedAt: r.requestedAt } })} />;
  return <Programmes onSelect={setProgramme} onExplore={setDistribution} onClubs={(programmeId, chainId) => setClubProgramme({ programmeId, chainId })} onAccessLost={setAccessError} />;
}
export default function OrganizerRewards({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n(), { user, account, session, isLoading } = useAuth();
  const viewKey = useMemo(() => session ? crypto.randomUUID() : "signed-out", [session]);
  // Auth is shared; programme permission is checked by the private API, not a
  // browser workspace label or user-editable metadata. No athlete profile needed.
  const signedIn = !isLoading && user && session && account?.userId === user.id;
  return <div className={`${editorial.page} ${embedded ? workspaceStyles.embedded : ""} space-y-6`}>
    <header className={editorial.hero} hidden={embedded}><p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("rewards.pilot")}</p>
      <h1 className="text-2xl font-bold sm:text-3xl">{t("rewards.organizer.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("rewards.organizer.intro")}</p></header>
    {!publicEnv.rewardPortalEnabled || !publicEnv.rewardDemo ? <p role="status">{t("rewards.unavailable")}</p>
      : isLoading ? <p role="status">{t("rewards.loading")}</p>
        : signedIn ? <Workspace key={`${user.id}:${viewKey}`} /> : <div className="space-y-3"><p role="alert">{t("rewards.error.signIn")}</p>
          <Link className="text-sm text-primary underline" to="/auth?next=%2Forganizer%2Frewards">{t("common.signIn")}</Link></div>}
  </div>;
}
