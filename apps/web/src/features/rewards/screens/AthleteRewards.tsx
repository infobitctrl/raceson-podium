import HostedAthleteRewards from './HostedAthleteRewards';
import {sponsorAwards} from "../data/sponsorProgramme";
import SponsorClaims from "../components/SponsorClaims";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import RewardAccountSummary from "../components/RewardAccountSummary";
import p from "../components/Podium.module.css";
import editorial from "../components/RewardEditorial.module.css";
import { useCallback, useState } from "react";
import { useRewardSessionEpoch } from "../model/useRewardSessionEpoch";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { publicEnv } from "@/lib/public-env";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getOwnRewardAllocations } from "../data/athleteRewards";
import { formatTestMon, rewardErrorKey, type RewardAllocation } from "../model/athleteRewards";
import { getOwnRewardDestinations } from "../data/athleteDestinations";
import AthleteProfileWallet from "../components/AthleteProfileWallet";
import { athleteUxCopy } from "../model/athleteUxCopy";
import RewardClaimHistory from "../components/RewardClaimHistory";
import { getOwnAthleteClaims } from "../data/athleteClaims";
import { getOwnAllocationsV3 } from "../data/athleteAllocationsV3";
import ProgrammeAthleteAllocationsV3 from "../components/ProgrammeAthleteAllocationsV3";
import ProgrammeAthleteClaimsV3, { type RewardClaimSelection } from "../components/ProgrammeAthleteClaimsV3";
import { getOwnAthleteClaimsV3 } from "../data/athleteConsentV3";

import { productCopy } from "../model/productCopy";

function AllocationCard({ award }: { award: RewardAllocation }) {
  const { t, locale } = useI18n();
  return <li className={`${editorial.award} space-y-3`} data-pot={award.pot}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{t(award.pot === "race" ? "rewards.raceAward" : "rewards.leagueAward")}</h3>
      <span className="rounded-full bg-secondary px-2 py-1 text-xs">{t(award.environment === "local_simulation" ? "rewards.simulation" : "rewards.testnet")}</span>
    </div>
    <p className={editorial.awardAmount}>{formatTestMon(award.amountWei, locale)} <span className="whitespace-nowrap text-sm font-medium">{t("rewards.testMon")}</span></p>
    <p className="text-sm text-muted-foreground">{t("rewards.allocatedOnly")}</p>
    <ul className="space-y-1 text-sm text-muted-foreground">
      {award.identityChanged ? <li>{t("rewards.hold.identity")}</li> : null}
      <li>{t(award.ageStatus === "minor" ? "rewards.hold.minor" : award.ageStatus === "unknown" ? "rewards.hold.unknownAge" : "rewards.hold.ageReview")}</li>
    </ul>
    {award.pot === "race" ? <Link className="inline-block text-sm font-medium text-primary underline underline-offset-4" to={`/events/${award.scopeKey}`}>
      {t("rewards.viewRace")}</Link> : <p className="text-sm">{t("rewards.leagueScope")}</p>}
  </li>;
}

function SignedInRewards({ userId, athleteProfileId, viewKey, selectedProfile, onSelectProfile, rememberedClaim, onSelectClaim }: { userId: string; athleteProfileId: string | null; viewKey: string; selectedProfile: string | null; onSelectProfile: (id: string) => void; rememberedClaim: RewardClaimSelection | null; onSelectClaim: (selection: RewardClaimSelection | null) => void }) {
  const { t, locale } = useI18n(), copy = productCopy(locale);

  const [paymentObservations, setPaymentObservations] = useState<Record<string, { binding: string; paid: boolean | null }>>({});
  const recordObservation = useCallback((award: AthleteAllocationV3, binding: string, paid: boolean | null) => {
    const key = `${award.chainId}:${award.entitlementId}:${award.approvalId}`;
    setPaymentObservations(previous => previous[key]?.binding === binding && previous[key]?.paid === paid ? previous : { ...previous, [key]: { binding, paid } });
  }, []);
  const [claimAccessError, setClaimAccessError] = useState<unknown>(null);
  const awards = useInfiniteQuery({
    queryKey: ["athlete-reward-allocations", userId, viewKey],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getOwnRewardAllocations(pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false, staleTime: 0, gcTime: 0,
  });
  const programmeAwards = useInfiniteQuery({
    queryKey: ["athlete-programme-allocations-v3", userId, viewKey], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getOwnAllocationsV3(pageParam), getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false, staleTime: 0, gcTime: 0,
  });
  const destinations = useInfiniteQuery({
    queryKey: ["athlete-reward-destinations", userId, viewKey], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getOwnRewardDestinations(pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false, staleTime: 0, gcTime: 0,
  });
  const claims = useInfiniteQuery({
    queryKey: ["athlete-reward-claims", userId, viewKey], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getOwnAthleteClaims(pageParam), getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false, staleTime: 0, gcTime: 0,
  });
  const programmeClaims = useInfiniteQuery({
    queryKey: ["athlete-programme-claims-v3", userId, viewKey], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getOwnAthleteClaimsV3(publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false, staleTime: 0, gcTime: 0,
  });
  const sponsored = useQuery({queryKey:["athlete-sponsor-awards-v4",userId,viewKey],queryFn:()=>sponsorAwards("recipient"),retry:false,staleTime:0,gcTime:0});
  const sponsorItems=sponsored.data??[];
  const privateError = claimAccessError ?? (sponsored.isError ? sponsored.error : programmeClaims.isError ? programmeClaims.error : programmeAwards.isError ? programmeAwards.error : awards.isError ? awards.error : destinations.isError ? destinations.error : claims.isError ? claims.error : null);
  // A failed refresh must not present stale private allocations as current.
  const items = privateError ? [] : awards.data?.pages.flatMap(page => page.items) ?? [];
  const hasProgrammeActivity = !!programmeAwards.data?.pages.some(page => page.items.length)
    || !!programmeClaims.data?.pages.some(page => page.items.length);
  const canUseWallet = awards.isSuccess && programmeAwards.isSuccess && programmeClaims.isSuccess && destinations.isSuccess && claims.isSuccess && sponsored.isSuccess && !privateError;
  const refreshProgramme = () => { void programmeAwards.refetch(); void programmeClaims.refetch(); };
  const programmeItems = programmeAwards.data?.pages.flatMap(page => page.items) ?? [];
  const claimItems = programmeClaims.data?.pages.flatMap(page => page.items) ?? [];
  const profileIds = [...new Set([...programmeItems.map(a => a.athleteProfileId), ...items.map(a => a.athleteProfileId), ...sponsorItems.flatMap(a=>a.athleteProfileId?[a.athleteProfileId]:[])])];
  // The account default is an option only when no awarded profile was returned.
  if (!profileIds.length && athleteProfileId) profileIds.push(athleteProfileId);
  const walletProfileId = selectedProfile && profileIds.includes(selectedProfile) ? selectedProfile
    : profileIds.length === 1 && !awards.hasNextPage && !programmeAwards.hasNextPage ? profileIds[0] : null;
  const destinationItems = destinations.data?.pages.flatMap(page => page.items) ?? [];
  const completePayments = !items.length && !programmeAwards.hasNextPage && !programmeClaims.hasNextPage && programmeAwards.isSuccess && programmeClaims.isSuccess
    && programmeItems.every(award => {
      const observed = paymentObservations[`${award.chainId}:${award.entitlementId}:${award.approvalId}`];
      const binding = JSON.stringify(claimItems.filter(c => c.entitlementId === award.entitlementId && c.chainId === award.chainId && c.amountWei === award.amountWei));
      return binding !== "[]" && observed?.binding === binding && observed.paid !== null;
    });
  const confirmedAwards = programmeItems.filter(award => {
    const observed = paymentObservations[`${award.chainId}:${award.entitlementId}:${award.approvalId}`];
    const binding = JSON.stringify(claimItems.filter(c => c.entitlementId === award.entitlementId && c.chainId === award.chainId && c.amountWei === award.amountWei));
    return observed?.binding === binding && observed.paid === true;
  });
  const sponsorPaid=sponsorItems.filter(a=>a.claims.some(c=>c.paid)).reduce((sum,a)=>sum+BigInt(a.amountWei),0n);
  const confirmedPaid = completePayments || confirmedAwards.length || sponsorPaid>0n ? confirmedAwards.reduce((sum, award) => sum + BigInt(award.amountWei), sponsorPaid) : null;
  async function refreshAll() {
    const results = await Promise.all([awards.refetch(), programmeAwards.refetch(), programmeClaims.refetch(), destinations.refetch(), claims.refetch(), sponsored.refetch()]);
    if (results.every(result => result.isSuccess)) setClaimAccessError(null);
  }
  if (!privateError && (sponsored.isPending || awards.isPending || programmeAwards.isPending || programmeClaims.isPending || destinations.isPending || claims.isPending))
    return <p role="status" className="py-12 text-sm text-muted-foreground">{t("rewards.loading")}</p>;
  return <>
    {canUseWallet ? <div className={p.recipientSummary}><RewardAccountSummary paymentsComplete={completePayments&&sponsorItems.every(a=>a.claims.some(c=>c.paid))} confirmedPaid={confirmedPaid} awards={[...items, ...programmeItems, ...sponsorItems.map(a=>({entitlementId:a.entitlementId,amountWei:a.amountWei,chainId:publicEnv.rewardDemo?.mode==="local"?31337 as const:10143 as const}))]} complete={!awards.hasNextPage && !programmeAwards.hasNextPage}
      hasMore={!!awards.hasNextPage || !!programmeAwards.hasNextPage} loading={awards.isFetching || programmeAwards.isFetching}
      onMore={() => { if (awards.hasNextPage) void awards.fetchNextPage(); if (programmeAwards.hasNextPage) void programmeAwards.fetchNextPage(); }} /></div> : null}
    <div className={p.recipientLayout}><aside className={p.recipientReadiness} aria-label={locale === "hr" ? "Vaš novčanik za nagrade" : "Your reward wallet"}><AthleteProfileWallet ready={canUseWallet} failed={!!privateError} profiles={profileIds} profileId={walletProfileId}
      onProfile={onSelectProfile} destinations={privateError ? [] : destinationItems} complete={!destinations.hasNextPage}
      refreshing={destinations.isFetching} onRefresh={refreshAll} onMore={() => void destinations.fetchNextPage()} /></aside><div className={p.recipientAwards}>
    {!privateError && sponsorItems.length > 0 ? <SponsorClaims role="recipient" hr={locale === "hr"} chainId={publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143} shared={{awards:sponsorItems,destinations:destinationItems,refresh:refreshAll}} onAccessError={setClaimAccessError}/> : null}
    {!privateError && (hasProgrammeActivity || programmeAwards.hasNextPage || programmeClaims.hasNextPage) ? <div id="my-awards" tabIndex={-1} className="space-y-4 scroll-mt-6">
      <ProgrammeAthleteAllocationsV3 onObservation={recordObservation} items={programmeItems} pending={programmeAwards.isPending} hasMore={!!programmeAwards.hasNextPage}
        rememberedClaim={rememberedClaim} onSelectClaim={onSelectClaim} claims={claimItems} claimsComplete={!programmeClaims.hasNextPage && !programmeClaims.isPending} onRefresh={refreshProgramme} onAccessLost={setClaimAccessError}
        />
      {programmeAwards.hasNextPage ? <Button variant="outline" disabled={programmeAwards.isFetching}
        onClick={() => void programmeAwards.fetchNextPage()}>{t("rewards.loadMore")}</Button> : null}
      {programmeClaims.hasNextPage ? <Button variant="outline" disabled={programmeClaims.isFetching} onClick={() => void programmeClaims.fetchNextPage()}>{t("rewards.claim.more")}</Button> : null}
      {claimItems.some(c => !programmeItems.some(a => a.entitlementId === c.entitlementId && a.chainId === c.chainId && a.amountWei === c.amountWei)) ? <details>
        <summary className="cursor-pointer text-sm font-medium">{copy.historical}</summary><p className="my-2 text-sm">{copy.noExtra}</p>
        <ProgrammeAthleteClaimsV3 embedded allowConsent={false} items={claimItems.filter(c => !programmeItems.some(a => a.entitlementId === c.entitlementId && a.chainId === c.chainId && a.amountWei === c.amountWei))}
          awards={[]} pending={programmeClaims.isPending} refreshing={programmeClaims.isFetching} hasMore={false}
          onRefresh={refreshProgramme} onMore={() => {}} onAccessLost={setClaimAccessError} />
      </details> : null}
    </div> : null}
    {privateError || awards.isPending || items.length || (!hasProgrammeActivity && !sponsorItems.length) ? <section className="space-y-4" aria-labelledby="reward-allocations-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reward-allocations-title" className="text-lg font-semibold">{t("rewards.allocations")}</h2>
        <Button variant="outline" size="sm" disabled={awards.isFetching || programmeAwards.isFetching}
          onClick={() => void refreshAll()}>{t("rewards.refresh")}</Button>
      </div>
      {privateError ? <p role="alert" className="rounded-xl border border-border p-5">{t(rewardErrorKey(privateError))} {copy.recovery}</p> : awards.isPending ? <p role="status">{t("rewards.loading")}</p>
        : items.length ? <ul className="grid gap-4 sm:grid-cols-2">{items.map(award => <AllocationCard key={award.entitlementId} award={award} />)}</ul>
          : <div className="space-y-3 rounded-xl border border-dashed border-border p-5">
            <h3 className="font-medium">{t("rewards.empty.title")}</h3><p className="text-sm text-muted-foreground">{t("rewards.empty.help")}</p>
            <Link className="text-sm font-medium text-primary underline underline-offset-4" to="/athlete/account?view=edit#athlete-race-history">{t("rewards.profileHistory")}</Link>
          </div>}
      {awards.hasNextPage && !privateError ? <Button variant="outline" disabled={awards.isFetching} onClick={() => void awards.fetchNextPage()}>{t("rewards.loadMore")}</Button> : null}
    </section> : null}
    {privateError ? <Button variant="outline" disabled={awards.isFetching || destinations.isFetching}
        onClick={() => void refreshAll()}>{athleteUxCopy(locale).refreshWallet}</Button> : null}
    {!privateError && (claims.isPending || claims.data?.pages.some(page => page.items.length) || claims.hasNextPage) ? <RewardClaimHistory items={claims.data?.pages.flatMap(page => page.items) ?? []} pending={claims.isPending}
      refreshing={claims.isFetching} hasMore={!!claims.hasNextPage} onRefresh={() => void claims.refetch()}
      onMore={() => void claims.fetchNextPage()} onAccessLost={setClaimAccessError} /> : null}
    </div></div>
  </>;
}

export default function AthleteRewards() {
  const { t, locale } = useI18n();
  const { user, account, session, isLoading } = useAuth();
  // Retain only a profile identifier across credential rotation, never proofs.
  const [profileChoice, setProfileChoice] = useState<{ actor: string; mode: string; id: string } | null>(null);
  const [claimChoice, setClaimChoice] = useState<{ actor: string; mode: string; selection: RewardClaimSelection | null } | null>(null);
  const mode = publicEnv.rewardDemo?.mode ?? "disabled";
  // Exact credential copies preserve the view; actual rotation retires it.
  const sessionViewKey = useRewardSessionEpoch(session);
  const signedIn = !isLoading && user && account?.userId === user.id && account.hasAthleteAccess;
  return <div className={`${p.page} ${p.workspace}`}>
    <header className={p.heading}><div><span className={p.eyebrow} translate="no">RacesOn Podium</span>
      <h1>{locale === "hr" ? "Moje nagrade" : "My rewards"}</h1><p>{locale === "hr" ? "Vaše nagrade iz službenih rezultata. Pregledajte spremnost, odaberite novčanik i preuzmite svaku nagradu." : "Your awards from official results. Review readiness, choose your wallet and claim each reward."}</p>
    </div><Link className={p.secondary} to="/rewards/campaigns">{locale === "hr" ? "Istraži kampanje" : "Explore campaigns"}</Link></header>
    {!publicEnv.rewardPortalEnabled ? <p role="status" className="rounded-xl border border-border p-5">{t("rewards.unavailable")}</p>
      : isLoading ? <p role="status">{t("rewards.loading")}</p>
         : signedIn && publicEnv.hostedOperations ? <HostedAthleteRewards key={`${user.id}:${sessionViewKey}:${account.primaryAthleteProfileId??'none'}`} userId={user.id}
          profileId={account.primaryAthleteProfileId??null} viewKey={sessionViewKey} hr={locale==='hr'}/>
        : signedIn ? <SignedInRewards key={`${user.id}:${sessionViewKey}:${publicEnv.rewardDemo?.mode ?? "disabled"}:${account.primaryAthleteProfileId ?? "none"}`} userId={user.id}
          viewKey={`${sessionViewKey}:${publicEnv.rewardDemo?.mode ?? "disabled"}`} athleteProfileId={account.primaryAthleteProfileId ?? null}
          selectedProfile={profileChoice?.actor === user.id && profileChoice.mode === mode ? profileChoice.id : null}
          onSelectProfile={id => setProfileChoice({ actor: user.id, mode, id })}
          rememberedClaim={claimChoice?.actor === user.id && claimChoice.mode === mode ? claimChoice.selection : null}
          onSelectClaim={selection => setClaimChoice({ actor: user.id, mode, selection })} /> : <p role="alert">{t("rewards.error.signIn")}</p>}
  </div>;
}
