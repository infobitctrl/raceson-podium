"use client";

import PodiumHeader from "../components/PodiumHeader";
import {DemoAccountSwitchProvider, DemoAccountSwitchNavigation} from '../components/DemoAccountSwitchProvider';
import { useRewardDocumentTitle } from "./useRewardDocumentTitle";

import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import RewardWalletSession from "../components/RewardWalletSession";
import { publicEnv, assertPublicEnvironmentOrigin } from "@/lib/public-env";
import { AccountLocaleSynchronizer } from "@/shared/i18n/AccountLocaleSynchronizer";
import { useI18n } from "@/shared/i18n/I18nContext";
import AthleteRewardsAccessNotice from "../components/AthleteRewardsAccessNotice";
import ProtectedWorkspace from "@/components/layout/ProtectedWorkspace";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import DemoWorkspaceReady from "./DemoWorkspaceReady";
import ClassicRewardFrame from "./portal/ClassicRewardFrame";
import ClassicSourceEntry from "./portal/ClassicSourceEntry";

const RewardProfile = lazy(() => import("../screens/RewardProfile"));
const RewardWalletSettings = lazy(() => import("../screens/RewardWalletSettings"));
const WalletAdministration = lazy(() => import("../screens/WalletAdministration"));
const HostedCopyPreview = lazy(() => import("../screens/HostedCopyPreview"));
const RewardReviewQueue = lazy(() => import("../screens/RewardReviewQueue"));
const SponsorResultsHandoff = lazy(() => import("../screens/SponsorResultsHandoff"));
const PublicSponsorCampaign = lazy(() => import("../screens/PublicSponsorCampaign"));
const CopySponsorCampaign = lazy(() => import("../screens/CopySponsorCampaign"));
const HostedSponsorFunding = lazy(() => import("../screens/HostedSponsorFunding"));
const SponsorLaunch = lazy(() => import("../screens/SponsorLaunch"));
const RewardsHome = lazy(() => import("../screens/PodiumHome"));
const PodiumEvents = lazy(() => import("../screens/SponsorDiscovery"));
const PodiumCampaignDirectory = lazy(() => import("../screens/PodiumCampaignDirectory"));
const SponsorCampaignEntry = lazy(() => import("../screens/SponsorCampaignEntry"));
const PublicDistributionReport = lazy(() => import("../screens/PublicDistributionReport"));
const RewardPot = lazy(() => import("../screens/RewardCatalogue").then(m => ({ default: m.PublicRewardPot })));
const ClassicPortalContext = lazy(() => import("./portal/ClassicPortalContext"));

const Rewards = lazy(() => import("../screens/AthleteRewards"));
const PublicProgramme = lazy(() => import("../screens/PublicRewardProgramme"));
const Programme = lazy(() => import("../screens/RewardProgramme"));
const CreateRewardProgramme = lazy(() => import("../screens/CreateRewardProgramme"));
const ProgrammeDirectory = lazy(() => import("../screens/OrganizerProgrammeDirectory"));
const SavedProgramme = lazy(() => import("../screens/SavedRewardProgramme"));
const OrganizerLayout = lazy(() => import("@/components/layout/OrganizerLayout"));
const OrganizerPermissionBoundary = lazy(() => import("@/components/layout/OrganizerPermissionBoundary"));
const OrganizerLeagues = lazy(() => import("@/pages/organizer/OrganizerLeagues"));
const OrganizerLeagueDetail = lazy(() => import("@/pages/organizer/OrganizerLeagueDetail"));
const OrganizerAccount = lazy(() => import("@/pages/organizer/OrganizerAccountPage"));
const OrganizerRewards = lazy(() => import("../screens/OrganizerRewards"));
const ClubRewards = lazy(() => import("../screens/ClubRewards"));
const Account = lazy(() => import("@/pages/athlete/AthleteAccountPage"));
const Auth = lazy(() => import("@/pages/AuthPage"));
const PasswordReset = lazy(() => import("@/pages/ForgotPasswordPage"));
const Event = lazy(() => import("@/pages/EventDetailPage"));
const TimingResults = lazy(() => import("@/pages/organizer/TimingResults"));
const PublicLeague = lazy(() => import("@/pages/LeaguePage"));
const PublicResults = lazy(() => import("@/pages/ResultsPage"));

const isClassicWorkspace = (pathname: string) => /^\/organizer\/(?:leagues)(?:\/[^/]+)?$/.test(pathname)
  || ["/organizer", "/organizer/dashboard", "/organizer/reward-planner", "/organizer/reward-context", "/organizer/registrations/results", "/organizer/account"].includes(pathname);

function DemoError() {
  const { t } = useI18n();
  return <div role="alert" className="mx-auto max-w-3xl space-y-4 px-4 py-10">
    <h1 className="font-display text-2xl font-bold">{t("rewards.demo.error")}</h1>
    <p className="text-sm text-muted-foreground">{t("rewards.demo.errorHelp")}</p>
    <Button onClick={() => window.location.reload()}>{t("rewards.refresh")}</Button>
  </div>;
}
class DemoErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <DemoError /> : this.props.children; }
}

function ProgrammeEntry(){const {search}=useLocation();return new URLSearchParams(search).get("legacy")==="1"?<CreateRewardProgramme/>:<SponsorCampaignEntry/>;}

function DemoHeader() {
 const {pathname}=useLocation();
 if(pathname==="/auth"||pathname==="/auth/reset"||isClassicWorkspace(pathname))return null;
 return <PodiumHeader/>;
}

function UnavailableArea() {
  const { t } = useI18n();
  return <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
    <h1 className="font-display text-2xl font-bold">{t("rewards.demo.unavailable")}</h1>
    <p className="text-sm text-muted-foreground">{t("rewards.demo.unavailableHelp")}</p>
    <Link className="font-semibold text-primary underline underline-offset-4" to="/rewards">{t("rewards.programme.navigation")}</Link>
  </div>;
}

function PublicProgrammeEntry() {
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  // Existing planner links retain their selected node under the new tools route.
  if (query.has("node") || ["portal", "standalone"].includes(query.get("view") ?? "")) return <Navigate replace to={`/rewards/calculator${search}`} />;
  if(query.has("setup"))return <Navigate replace to={`/rewards/events${search}`}/>;
  return <RewardsHome />;
}

function ManageEntry() {
  const {search}=useLocation();
  return new URLSearchParams(search).has("draft") ? <SavedProgramme/> : <ProgrammeDirectory/>;
}

function DemoRoutes() {
  const { t, locale } = useI18n();
  const { pathname } = useLocation();
  useRewardDocumentTitle(pathname, `${(pathname === "/rewards/setup" || pathname === "/rewards/create" || pathname.startsWith("/rewards/campaigns/")) ? (locale === "hr" ? "Sponzorska kampanja" : "Sponsor campaign") : pathname === "/rewards/profile" ? (locale === "hr" ? "Profil" : "Profile") : pathname === "/rewards/admin/wallets" ? (locale === "hr" ? "Upravljanje novčanicima" : "Wallet administration") : pathname === "/rewards/test" ? (locale === "hr" ? "Testni program" : "Test programme") : pathname === "/rewards" ? (locale === "hr" ? "Početna" : "Home") : pathname === "/rewards/events" ? (locale === "hr" ? "Događaji" : "Events") : pathname === "/rewards/campaigns" ? (locale === "hr" ? "Kampanje" : "Campaigns") : pathname === "/rewards/manage" ? (locale === "hr" ? "Moje kampanje" : "My campaigns") : pathname.startsWith("/rewards/pots") ? (locale === "hr" ? "Fondovi nagrada" : "Reward pots") : t(["/rewards", "/rewards/calculator", "/rewards/manage", "/organizer/reward-planner"].includes(pathname) ? "rewards.programme.title" : pathname === "/rewards/rehearsal" ? "rewards.rehearsal.title" : pathname === "/rewards/contract" ? "rewards.canary.title" : pathname === "/organizer/rewards" ? "rewards.organizer.title" : pathname === "/club/rewards" ? "rewards.club.title" : "rewards.title")} · ${t("rewards.demo.label")} | RacesOn Podium`);
  return <><DemoHeader /><main><DemoErrorBoundary key={pathname}>
    <Suspense fallback={<p role="status" className="p-6 text-center">{t("rewards.loading")}</p>}>
      <Routes>
        <Route path="/" element={<Navigate to="/rewards" replace />} />
        <Route path="/rewards" element={<PublicProgrammeEntry />} />
        <Route path="/rewards/events" element={<PodiumEvents />} />
        <Route path="/rewards/demo-copy" element={<HostedCopyPreview />} />
        <Route path="/rewards/campaigns" element={<PodiumCampaignDirectory />} />
        <Route path="/rewards/pots" element={<Navigate replace to="/rewards/campaigns" />} />
        <Route path="/rewards/pots/:potId" element={<RewardPot />} />
        <Route path="/rewards/programmes/sibenik-2026" element={<PublicProgramme />} />
        <Route path="/rewards/programmes/:programmeId" element={<PublicDistributionReport />} />
        <Route path="/rewards/programmes/:programmeId/pots/:potId" element={<PublicDistributionReport />} />
        <Route path="/rewards/setup" element={<SponsorCampaignEntry />} />
        <Route path="/rewards/test" element={<Navigate replace to="/rewards/campaigns" />} />
        <Route path="/rewards/calculator" element={<Programme />} />
        <Route path="/rewards/rehearsal" element={<Navigate replace to="/rewards/campaigns" />} />
        <Route path="/rewards/contract" element={<Navigate replace to="/rewards/campaigns" />} />
        <Route path="/rewards/review" element={<RewardReviewQueue />} />
        <Route path="/rewards/manage/campaigns/:id" element={<SponsorResultsHandoff />} />
        <Route path="/rewards/campaigns/:id/public" element={<PublicSponsorCampaign />} />
        <Route path="/rewards/campaigns/:id" element={publicEnv.hostedCopy?<HostedSponsorFunding/>:<SponsorLaunch />} />
        <Route path="/rewards/create" element={<ProgrammeEntry />} />
        <Route path="/rewards/manage" element={<ManageEntry />} />
        <Route path="/rewards/profile" element={<RewardProfile />} />
        <Route path="/rewards/wallet" element={<RewardWalletSettings />} />
        <Route path="/rewards/admin/wallets" element={<WalletAdministration />} />
        {/* Retired sporting-management entry points never mount the classic workspace. */}
        <Route path="/organizer" element={<Navigate to="/rewards" replace />} />
        <Route path="/organizer/dashboard" element={<Navigate to="/rewards" replace />} />
        <Route path="/organizer/events/*" element={<Navigate to="/rewards/events" replace />} />
        <Route element={<ProtectedWorkspace requiredRole="organizer"><OrganizerLayout /></ProtectedWorkspace>}>
          <Route element={<DemoWorkspaceReady />}>
          <Route path="/organizer/reward-context" element={<OrganizerPermissionBoundary permanentOnly permissions={["events.manage", "results.manage"]}><ClassicPortalContext /></OrganizerPermissionBoundary>} />
          <Route path="/organizer/registrations/results" element={<OrganizerPermissionBoundary permissions={["race_day.manage", "results.manage"]}><ClassicSourceEntry><TimingResults fieldOperationsOnly /></ClassicSourceEntry></OrganizerPermissionBoundary>} />
          <Route path="/organizer/reward-planner" element={<ClassicSourceEntry><SavedProgramme integrated /></ClassicSourceEntry>} />
          <Route path="/organizer/leagues" element={<OrganizerPermissionBoundary permanentOnly permissions={["events.manage", "results.manage"]}><ClassicSourceEntry><OrganizerLeagues /></ClassicSourceEntry></OrganizerPermissionBoundary>} />
          <Route path="/organizer/leagues/:seasonId" element={<OrganizerPermissionBoundary permanentOnly permissions={["events.manage", "results.manage"]}><ClassicSourceEntry><OrganizerLeagueDetail /></ClassicSourceEntry></OrganizerPermissionBoundary>} />
          <Route path="/organizer/account" element={<OrganizerAccount />} />
          </Route>
        </Route>
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/reset" element={<PasswordReset />} />
        <Route path="/athlete" element={<Navigate to="/athlete/rewards" replace />} />
        <Route path="/athlete/dashboard" element={<Navigate to="/athlete/rewards" replace />} />
        <Route path="/athlete/rewards" element={<ProtectedWorkspace requiredRole="athlete" accessDenied={<AthleteRewardsAccessNotice/>}><ClassicRewardFrame><Rewards /></ClassicRewardFrame></ProtectedWorkspace>} />
        <Route path="/organizer/rewards" element={<OrganizerRewards />} />
        <Route path="/club/rewards" element={<ClassicRewardFrame><ClubRewards /></ClassicRewardFrame>} />
        <Route path="/athlete/account" element={<ProtectedWorkspace requiredRole="athlete"><Account /></ProtectedWorkspace>} />
        <Route path="/events/:id" element={<ClassicSourceEntry><Event /></ClassicSourceEntry>} />
        <Route path="/leagues/:id" element={<ClassicSourceEntry league><PublicLeague /></ClassicSourceEntry>} />
        <Route path="/leagues/:leagueId/events/:eventId" element={<ClassicSourceEntry><Event /></ClassicSourceEntry>} />
        <Route path="/results" element={<ClassicSourceEntry><PublicResults /></ClassicSourceEntry>} />
        <Route path="*" element={<UnavailableArea />} />
      </Routes>
    </Suspense>
  </DemoErrorBoundary></main></>;
}

function WalletSessionBoundary({children}:{children:ReactNode}){
 const {pathname}=useLocation();
 // Native operational ownership must never share the custom-JWT synchronizer.
 return pathname==='/rewards/admin/wallets'?<>{children}</>:<RewardWalletSession>{children}</RewardWalletSession>;
}
function ConfiguredDemo() {
  const [client] = useState(() => new QueryClient());
  if (!publicEnv.rewardDemo) throw new Error("reward_demo_configuration_required");
  assertPublicEnvironmentOrigin();
  return <QueryClientProvider client={client}><DemoAccountSwitchProvider><AuthProvider><AccountLocaleSynchronizer />
    <BrowserRouter><DemoAccountSwitchNavigation/><WalletSessionBoundary><TooltipProvider><Toaster /><Sonner /><DemoRoutes /></TooltipProvider></WalletSessionBoundary></BrowserRouter>
  </AuthProvider></DemoAccountSwitchProvider></QueryClientProvider>;
}

export default function RewardsDemoApp() {
  return <DemoErrorBoundary><ConfiguredDemo /></DemoErrorBoundary>;
}
