import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AnimatedOutlet from "@/components/shared/AnimatedOutlet";
import ThemeToggle from "@/components/shared/ThemeToggle";
import {
  ChartNoAxesCombined,
  Calendar,
  ClipboardCheck,
  Flag,
  FlaskConical,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Route,
  ShieldCheck,
  Trophy,
  Users,
  WalletCards,
} from "lucide-react";
import {
  hasAnyOrganizationPermission,
  useAuth,
  type AuthAccountContext,
  type OrganizationPermission,
} from "@/lib/auth";
import {
  useOrganizerWorkspace,
} from "@/lib/organizer-workspace";
import OrganizerWorkspaceProvider from "@/components/layout/OrganizerWorkspaceProvider";
import { BrandWordmark } from "@/shared/brand/BrandWordmark";
import { MobileWorkspaceNavigation } from "@/shared/navigation/MobileWorkspaceNavigation";
import { MobileMoreUtilities } from "@/shared/navigation/MobileMoreUtilities";
import { MobileWorkspaceTopBar } from "@/shared/navigation/MobileWorkspaceTopBar";
import { WorkspaceTopBar } from "@/shared/navigation/WorkspaceTopBar";
import { useI18n } from "@/shared/i18n/I18nContext";
import { PlatformSupportBanner } from "@/shared/platform/PlatformSupportBanner";
import { getOrganizerDashboardReadModel } from "@/lib/private-read-models";
import { getOrganizerEventSummaries } from "@/lib/organizer-management";
import type { TranslationKey } from "@/shared/i18n/messages";

const nativeEventRaceDayPath = /^\/organizer\/events\/[^/]+\/race-day(?:\/results)?$/;
const nativeEventRaceDayOperationsPath = /^\/organizer\/events\/[^/]+\/race-day$/;

function isNativeEventRaceDayPath(pathname: string) {
  return nativeEventRaceDayPath.test(pathname);
}

function isNativeEventRaceDayOperationsPath(pathname: string) {
  return nativeEventRaceDayOperationsPath.test(pathname);
}

type NavItem = {
  labelKey: TranslationKey;
  path: string;
  icon: typeof LayoutDashboard;
  permissions: OrganizationPermission[];
  permanentOnly?: boolean;
  organizationOnly?: boolean;
  organizerSetup?: boolean;
  personal?: boolean;
  testing?: boolean;
  platformAdmin?: boolean;
  superAdminOnly?: boolean;
  badgeKey?: TranslationKey;
  planningCountKey?: "routes" | "races" | "leagues";
};

const navigation: Array<{ labelKey: TranslationKey; items: NavItem[] }> = [
  {
    labelKey: "nav.workspace",
    items: [
      {
        labelKey: "nav.overview",
        path: "/organizer/dashboard",
        icon: LayoutDashboard,
        permissions: [],
        personal: true,
      },
    ],
  },
  {
    labelKey: "nav.planning",
    items: [
      {
        labelKey: "nav.events",
        path: "/organizer/events",
        icon: Calendar,
        permissions: ["events.manage"],
        planningCountKey: "races",
      },
      {
        labelKey: "common.leagues",
        path: "/organizer/leagues",
        icon: Trophy,
        permissions: ["events.manage", "results.manage"],
        planningCountKey: "leagues",
      },
      {
        labelKey: "nav.tracks",
        path: "/organizer/create-track",
        icon: Route,
        permissions: ["events.manage"],
        planningCountKey: "routes",
      },
    ],
  },
  {
    labelKey: "nav.raceOperations",
    items: [
      {
        labelKey: "nav.registrationDesk",
        path: "/organizer/registrations/desk",
        icon: ClipboardCheck,
        permissions: ["entrants.manage", "events.manage", "race_day.manage", "results.manage"],
      },
      {
        labelKey: "nav.timing",
        path: "/organizer/race-operations",
        icon: Flag,
        permissions: [
          "race_day.manage",
          "checkpoint_timing.enter",
        ],
      },
    ],
  },
  {
    labelKey: "nav.organization",
    items: [
      {
        labelKey: "nav.organizationTeam",
        path: "/organizer/team",
        icon: Users,
        permissions: ["team.manage"],
        organizerSetup: true,
      },
      {
        labelKey: "nav.payments",
        path: "/organizer/settings/payments",
        icon: WalletCards,
        permissions: ["finance.manage"],
        badgeKey: "common.preview",
      },
      {
        labelKey: "common.support",
        path: "/organizer/support",
        icon: LifeBuoy,
        permissions: [],
        personal: true,
      },
    ],
  },
  {
    labelKey: "nav.sandbox",
    items: [
      {
        labelKey: "nav.testing",
        path: "/organizer/testing",
        icon: FlaskConical,
        permissions: [],
        testing: true,
        badgeKey: "nav.resettable",
      },
    ],
  },
  {
    labelKey: "nav.platform",
    items: [
      {
        labelKey: "platform.stats.navigation",
        path: "/organizer/statistics",
        icon: ChartNoAxesCombined,
        permissions: [],
        platformAdmin: true,
      },
      {
        labelKey: "nav.requestsTickets",
        path: "/organizer/requests",
        icon: ListChecks,
        permissions: [],
        platformAdmin: true,
      },
      {
        labelKey: "nav.platformAdministration",
        path: "/organizer/site-admins",
        icon: ShieldCheck,
        permissions: [],
        platformAdmin: true,
      },
    ],
  },
];

const organizerMobilePrimaryPaths = new Set<string>([
  "/organizer/dashboard",
  "/organizer/events",
  "/organizer/create-track",
  "/organizer/leagues",
  "/organizer/registrations/desk",
  "/organizer/race-operations",
]);

function canOpenNavItem(account: AuthAccountContext | null, item: NavItem) {
  if (!account) return false;
  if (item.testing) {
    return account.hasTestingAccess || account.organizations.some(
      (organization) =>
        organization.membershipType === "permanent"
        && ["owner", "admin"].includes(organization.role),
    );
  }
  if (item.superAdminOnly) return account.platformRole === "super_admin";
  if (item.platformAdmin) return Boolean(account.platformRole);
  if (account.testingRole) return false;
  if (item.organizerSetup && account.organizerSetupEnabled && !account.hasOrganizerAccess) {
    return true;
  }
  if (item.permanentOnly && account.accountType === "temporary") return false;
  if (item.personal) return true;
  if (hasAnyOrganizationPermission(account, item.permissions)) return true;
  if (item.organizationOnly) return false;
  return account.eventAccess.some((assignment) =>
    item.permissions.some((permission) => assignment.permissions.includes(permission)),
  );
}

function SidebarNav({
  onNavigate,
  onSignOut,
  showBranding = true,
}: {
  onNavigate?: () => void;
  onSignOut?: () => void;
  showBranding?: boolean;
}) {
  const location = useLocation();
  const { account } = useOrganizerWorkspace();
  const { t } = useI18n();
  const planningSummaryQuery = useQuery({
    queryKey: [
      "organizer-dashboard",
      2,
      account?.organizationIds?.[0] ?? "no-org",
    ],
    queryFn: () => getOrganizerDashboardReadModel(account),
    enabled: Boolean(account?.hasOrganizerAccess),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const planningEventsQuery = useQuery({
    queryKey: ["organizer-event-summaries", account?.organizationIds?.[0] ?? "no-org"],
    queryFn: () => getOrganizerEventSummaries(account),
    enabled: Boolean(account?.hasOrganizerAccess),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const planningCounts = planningSummaryQuery.data
    ? {
        routes: planningSummaryQuery.data.ownedTracks,
        races: planningEventsQuery.data
          ? planningEventsQuery.data.filter((event) => !event.isPractice).length
          : planningSummaryQuery.data.activeEvents,
        leagues: planningSummaryQuery.data.ownedLeagueSeasons,
      }
    : null;
  const accountBadge = account?.testingRole
    ? "TEST"
    : account?.accountType === "temporary"
      ? "FIELD"
      : account?.isMasterAdmin
        ? "SITE"
        : "ORG";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showBranding ? (
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <BrandWordmark className="h-7 shrink-0" eager />
            <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {accountBadge}
            </span>
          </div>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {account?.testingRole ? t("workspace.testingLabel") : t("workspace.organizerLabel")}
          </p>
        </div>
      ) : (
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {account?.testingRole ? t("workspace.testingLabel") : t("workspace.organizerLabel")}
          </p>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {accountBadge}
          </span>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-5">
          {navigation.map((group) => {
            const items = group.items.filter((item) => canOpenNavItem(account, item));
            if (!items.length) return null;
            return (
              <section key={group.labelKey} aria-label={t(group.labelKey)}>
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                  {t(group.labelKey)}
                </p>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const isNativeRaceDay = /^\/organizer\/events\/[^/]+\/race-day$/.test(
                      location.pathname,
                    );
                    const isNativeResults = /^\/organizer\/events\/[^/]+\/(?:race-day\/)?results$/.test(
                      location.pathname,
                    );
                    const isRaceOperationsWorkspace =
                      isNativeRaceDay;
                    const isEventRegistrationsWorkspace =
                      isNativeResults
                      || location.pathname.startsWith("/organizer/timing-results")
                      || (
                        /^\/organizer\/events\/[^/]+$/.test(location.pathname)
                        && new URLSearchParams(location.search).get("tab") === "registrations"
                      );
                    const isRaceDataWorkspace =
                      (location.pathname.startsWith("/organizer/registrations")
                        && location.pathname !== "/organizer/registrations/desk")
                      || isEventRegistrationsWorkspace;
                    const isActive =
                      location.pathname === item.path
                      || (
                        item.path === "/organizer/events"
                        && isRaceDataWorkspace
                      )
                      || (item.path === "/organizer/race-operations" && isRaceOperationsWorkspace)
                      || (item.path !== "/organizer/dashboard"
                        && location.pathname.startsWith(`${item.path}/`));
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={onNavigate}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                        {item.badgeKey ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                            {t(item.badgeKey)}
                          </span>
                        ) : null}
                        {item.planningCountKey && planningCounts ? (
                          <span
                            aria-hidden="true"
                            className="min-w-6 rounded-full border border-border/70 bg-background/75 px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums text-muted-foreground"
                          >
                            {planningCounts[item.planningCountKey]}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      <div className="sticky bottom-0 shrink-0 space-y-2 border-t border-border bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-medium text-muted-foreground">{t("common.appearance")}</span>
          <ThemeToggle />
        </div>
        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t("common.signOut")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function OrganizerLayoutContent() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const {
    account,
    exitPlatformSupportMode,
    isPlatformSupportMode,
    platformSupportOrganizationName,
  } = useOrganizerWorkspace();
  const { t } = useI18n();
  const organizerMobileMoreNavigation = navigation
    .flatMap((group) => group.items)
    .filter((item) => canOpenNavItem(account, item) && !organizerMobilePrimaryPaths.has(item.path))
    .map((item) => ({
      label: t(item.labelKey),
      path: item.path,
      icon: item.icon,
      activeWhen: (pathname: string) => pathname === item.path || pathname.startsWith(`${item.path}/`),
    }));

  async function handleSignOut() {
    await signOut();
    navigate("/auth");
  }

  return (
    <div className="workspace-viewport flex flex-col overflow-hidden bg-background text-foreground">
      <WorkspaceTopBar sidebar="organizer" onSignOut={handleSignOut} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="hidden h-full w-64 flex-shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
          <SidebarNav showBranding={false} onSignOut={handleSignOut} />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-border/70 bg-card/95 shadow-soft backdrop-blur-xl lg:hidden">
            <MobileWorkspaceTopBar />
          </header>

          {isPlatformSupportMode && platformSupportOrganizationName ? (
            <PlatformSupportBanner
              target={platformSupportOrganizationName}
              description="You are using this organization’s owner workspace with your platform identity."
              exitTo="/organizer/site-admins?section=organizations"
              onExit={exitPlatformSupportMode}
            />
          ) : null}

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <AnimatedOutlet />
          </main>

          <MobileWorkspaceNavigation
            label={t("nav.mobileOrganizer")}
            moreItems={organizerMobileMoreNavigation}
            moreUtilities={<MobileMoreUtilities onSignOut={handleSignOut} />}
            items={[
              { label: t("nav.overview"), path: "/organizer/dashboard", icon: LayoutDashboard },
              {
                label: t("nav.events"),
                path: "/organizer/events",
                icon: Calendar,
                activeWhen: (pathname) =>
                  (pathname.startsWith("/organizer/events")
                    && !isNativeEventRaceDayPath(pathname))
                  || (pathname.startsWith("/organizer/registrations")
                    && pathname !== "/organizer/registrations/desk")
                  || pathname.startsWith("/organizer/timing-results"),
              },
              {
                label: t("nav.registrationDeskShort"),
                path: "/organizer/registrations/desk",
                icon: ClipboardCheck,
                visualGroup: "race-operations",
                activeWhen: (pathname) =>
                  pathname === "/organizer/registrations/desk",
              },
              {
                label: t("nav.timingShort"),
                path: "/organizer/race-operations?phase=start",
                icon: Flag,
                visualGroup: "race-operations",
                activeWhen: (pathname) =>
                  pathname.startsWith("/organizer/race-operations")
                  || isNativeEventRaceDayOperationsPath(pathname),
              },
              {
                label: t("nav.tracks"),
                path: "/organizer/create-track",
                icon: Route,
                activeWhen: (pathname) => pathname.startsWith("/organizer/create-track"),
              },
              {
                label: t("common.leagues"),
                path: "/organizer/leagues",
                icon: Trophy,
                activeWhen: (pathname) => pathname.startsWith("/organizer/leagues"),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

export default function OrganizerLayout() {
  return (
    <OrganizerWorkspaceProvider>
      <OrganizerLayoutContent />
    </OrganizerWorkspaceProvider>
  );
}
