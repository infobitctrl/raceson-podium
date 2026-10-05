import { useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Flag,
  Footprints,
  Globe2,
  Home,
  LockKeyhole,
  LogIn,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { initialsForName } from "@/lib/account-presentation";
import { hasOrganizerWorkspaceAccess, useAuth } from "@/lib/auth";
import { getOrganizationWorkspaceProfile } from "@/lib/organization-team";
import { useOrganizerWorkspace } from "@/lib/organizer-workspace";
import {
  getAthleteClubsReadModel,
  getFallbackAthleteClubsReadModel,
} from "@/lib/private-read-models";
import { getWorkspaceAvatars } from "./workspaceAvatars";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { brandNavbarSymbolLight, brandWordmark } from "@/shared/brand/brandAssets";

type WorkspaceKey = "public" | "athlete" | "club" | "organizer";

type PrivateWorkspaceEntry = {
  id: string;
  key: Exclude<WorkspaceKey, "public">;
  path: string;
  label: string;
  typeLabel: string;
  accessibleLabel: string;
  avatarUrl: string | null;
  initials: string | null;
  circular: boolean;
  organizationId?: string;
  selected: boolean;
};

type WorkspaceSwitcherProps = {
  variant?: "header" | "desktop" | "mobile" | "sidebar" | "rail";
  inverted?: boolean;
  className?: string;
  onNavigate?: () => void;
  publicHomePath?: string;
  publicHomeImageSrc?: string;
  publicHomeLogo?: ReactNode;
};

const workspaceDefinitions = [
  {
    key: "public" as const,
    labelKey: "common.public" as const,
    descriptionKey: "workspace.publicDescription" as const,
    path: "/",
    icon: Globe2,
  },
  {
    key: "athlete" as const,
    labelKey: "common.athlete" as const,
    descriptionKey: "workspace.athleteDescription" as const,
    path: "/athlete/dashboard",
    icon: Footprints,
  },
  {
    key: "organizer" as const,
    labelKey: "common.organizer" as const,
    descriptionKey: "workspace.organizerDescription" as const,
    path: "/organizer/dashboard",
    icon: Flag,
  },
];

function activeWorkspace(pathname: string): WorkspaceKey {
  if (/^\/athlete\/clubs\/[^/]+\/(?:club|manage)/.test(pathname)) return "club";
  if (/^\/athlete(?:\/|$)/.test(pathname)) return "athlete";
  if (/^\/organizer(?:\/|$)/.test(pathname)) return "organizer";
  return "public";
}

function activeClubSlug(pathname: string) {
  return pathname.match(/^\/athlete\/clubs\/([^/]+)\/(?:club|manage)/)?.[1] ?? null;
}

function visibleIdentityName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return displayName;
  return `${parts[0]} ${parts.at(-1)?.charAt(0) ?? ""}.`;
}

function MobilePublicHomeIcon({
  imageSrc,
  inverted,
  logo,
}: {
  imageSrc?: string;
  inverted: boolean;
  logo?: ReactNode;
}) {
  if (logo) return logo;

  return (
    <img
      src={imageSrc ?? brandWordmark}
      alt=""
      className={cn(
        "h-8 w-auto max-w-[7.5rem] object-contain",
        !inverted && "brightness-[0.26] saturate-[1.4] dark:brightness-100 dark:saturate-100",
      )}
      aria-hidden="true"
    />
  );
}

function DesktopWorkspaceAvatar({
  imageUrl,
  alt,
  initials,
  circular,
  selected,
  inverted,
  className,
}: {
  imageUrl: string | null;
  alt: string;
  initials: string | null;
  circular: boolean;
  selected: boolean;
  inverted: boolean;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Avatar className={cn("h-6 w-6 shrink-0", circular ? "rounded-full" : "rounded-xl", className)}>
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={alt}
          onError={() => setImageFailed(true)}
          className={cn("h-full w-full object-cover", circular ? "rounded-full" : "rounded-xl")}
        />
      ) : (
        <AvatarFallback className={cn(
          "bg-transparent text-[9px] font-black",
          circular ? "rounded-full" : "rounded-xl",
          selected
            ? "text-primary"
            : inverted
              ? "text-white"
              : "text-foreground",
        )}>
          {initials}
        </AvatarFallback>
      )}
    </Avatar>
  );
}

export function WorkspaceSwitcher({
  variant = "header",
  inverted = false,
  className,
  onNavigate,
  publicHomePath = "/",
  publicHomeImageSrc,
  publicHomeLogo,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, account } = useAuth();
  const { t } = useI18n();
  const {
    organizations: workspaceOrganizations = [],
    selectedOrganization,
    selectOrganization = () => undefined,
  } = useOrganizerWorkspace();
  const displayName = account?.displayName ?? user?.email?.split("@")[0] ?? t("nav.myAccount");
  const shortName = visibleIdentityName(displayName);
  const currentWorkspace = activeWorkspace(location.pathname);
  const currentClubSlug = activeClubSlug(location.pathname);
  const publicProfilePath = account?.primaryAthleteSlug
    ? `/athletes/${account.primaryAthleteSlug}`
    : null;
  const profileHandle = account?.loginUsername ?? account?.primaryAthleteSlug ?? null;
  const clubsQuery = useQuery({
    queryKey: [
      "athlete-clubs",
      account?.primaryAthleteProfileId ?? user?.id ?? "guest",
    ],
    queryFn: getAthleteClubsReadModel,
    placeholderData: getFallbackAthleteClubsReadModel(),
    enabled: ["desktop", "mobile"].includes(variant)
      && Boolean(user && account?.hasAthleteAccess),
    staleTime: 5 * 60 * 1_000,
  });
  const memberClubs = clubsQuery.data?.memberships ?? [];
  const organizationAccess = workspaceOrganizations.length
    ? workspaceOrganizations
    : account?.organizations ?? [];
  const organizerOrganizations = organizationAccess.filter(
    (organization) => organization.organizationKind === "organizer",
  );
  const organizer = selectedOrganization?.organizationKind === "organizer"
    ? selectedOrganization
    : organizerOrganizations[0];
  const organizerName = organizer?.organizationName ?? account?.organizationNames?.[0] ?? t("common.organizer");
  const organizerProfileQueries = useQueries({
    queries: organizerOrganizations.map((organization) => ({
      queryKey: ["organization-profile", organization.organizationId],
      queryFn: () => getOrganizationWorkspaceProfile(organization.organizationId),
      enabled: ["desktop", "mobile"].includes(variant) && Boolean(user && (
        account?.isMasterAdmin || account?.organizations?.some((access) => (
          access.organizationId === organization.organizationId
          && access.membershipType === "permanent"
          && (access.role === "owner" || (access.role === "admin" && access.permissions.includes("team.manage")))
        ))
      )),
      staleTime: 5 * 60 * 1_000,
    })),
  });
  const organizationIds = organizerOrganizations.map((organization) => organization.organizationId).sort();
  const organizationAvatars = useQuery({
    queryKey: ["workspace-avatars", "organizer", organizationIds],
    queryFn: () => getWorkspaceAvatars("organizer", organizationIds),
    enabled: ["desktop", "mobile"].includes(variant) && Boolean(user && organizationIds.length),
    staleTime: 5 * 60 * 1_000,
  });

  const clubWorkspaceBySlug = new Map<string, { slug: string; name: string }>();
  for (const club of memberClubs) {
    clubWorkspaceBySlug.set(club.clubSlug, { slug: club.clubSlug, name: club.name });
  }
  for (const organization of organizationAccess) {
    if (organization.organizationKind !== "club") continue;
    const slug = organization.linkedClubSlug ?? organization.organizationSlug;
    if (!slug || clubWorkspaceBySlug.has(slug)) continue;
    clubWorkspaceBySlug.set(slug, {
      slug,
      name: organization.linkedClubName ?? organization.organizationName,
    });
  }
  const clubSlugs = [...clubWorkspaceBySlug.keys()].sort();
  const clubAvatars = useQuery({
    queryKey: ["workspace-avatars", "club", clubSlugs],
    queryFn: () => getWorkspaceAvatars("club", clubSlugs),
    enabled: ["desktop", "mobile"].includes(variant) && Boolean(user && clubSlugs.length),
    staleTime: 5 * 60 * 1_000,
  });
  const privateWorkspaceEntries: PrivateWorkspaceEntry[] = [];
  if (account?.hasAthleteAccess) {
    privateWorkspaceEntries.push({
      id: "athlete",
      key: "athlete",
      path: "/athlete/dashboard",
      label: displayName,
      typeLabel: t("common.athlete"),
      accessibleLabel: t("workspace.athleteAccessible", { name: displayName }),
      avatarUrl: account.avatarUrl,
      initials: initialsForName(displayName),
      circular: true,
      selected: currentWorkspace === "athlete",
    });
  }
  for (const club of clubWorkspaceBySlug.values()) {
    privateWorkspaceEntries.push({
      id: `club:${club.slug}`,
      key: "club",
      path: `/athlete/clubs/${club.slug}/club`,
      label: club.name,
      typeLabel: t("common.club"),
      accessibleLabel: t("workspace.clubAccessible", { name: club.name }),
      avatarUrl: clubAvatars.data?.[club.slug] ?? null,
      initials: initialsForName(club.name),
      circular: false,
      selected: currentWorkspace === "club" && currentClubSlug === club.slug,
    });
  }
  for (const [index, organization] of organizerOrganizations.entries()) {
    privateWorkspaceEntries.push({
      id: `organizer:${organization.organizationId}`,
      key: "organizer",
      path: "/organizer/dashboard",
      label: organization.organizationName,
      typeLabel: t("common.organizer"),
      accessibleLabel: t("workspace.organizerAccessible", { name: organization.organizationName }),
      avatarUrl: organizerProfileQueries[index]?.data?.logoImageUrl
        ?? organizationAvatars.data?.[organization.organizationId] ?? null,
      initials: initialsForName(organization.organizationName),
      circular: false,
      organizationId: organization.organizationId,
      selected: currentWorkspace === "organizer"
        && organization.organizationId === (selectedOrganization?.organizationId ?? organizer?.organizationId),
    });
  }
  if (hasOrganizerWorkspaceAccess(account) && organizerOrganizations.length === 0) {
    privateWorkspaceEntries.push({
      id: "organizer:setup",
      key: "organizer",
      path: "/organizer/dashboard",
      label: organizerName,
      typeLabel: t("common.organizer"),
      accessibleLabel: t("workspace.organizerAccessible", { name: organizerName }),
      avatarUrl: null,
      initials: initialsForName(organizerName),
      circular: false,
      selected: currentWorkspace === "organizer",
    });
  }
  const selectedWorkspaceEntry = privateWorkspaceEntries.find((workspace) => workspace.selected);
  const triggerWorkspaceEntry = currentWorkspace === "public" ? null : selectedWorkspaceEntry ?? null;
  const currentTypeLabel = currentWorkspace === "public"
    ? t("workspace.explore")
    : t(currentWorkspace === "club" ? "common.club" : currentWorkspace === "organizer" ? "common.organizer" : "common.athlete");

  function isWorkspaceAvailable(workspace: WorkspaceKey) {
    return workspace === "public"
      || (workspace === "athlete" && Boolean(account?.hasAthleteAccess))
      || (workspace === "club" && clubWorkspaceBySlug.size > 0)
      || (workspace === "organizer" && hasOrganizerWorkspaceAccess(account));
  }

  if (!user && variant !== "mobile") {
    if (variant === "desktop") {
      return (
        <Link
          to="/auth"
          onClick={onNavigate}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-[5px] border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            inverted
              ? "border-white/[0.18] text-white/[0.82] hover:border-white/50 hover:text-white"
              : "border-border bg-card text-foreground hover:border-primary/35",
            className,
          )}
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
          {t("common.signIn")}
        </Link>
      );
    }

    if (variant === "rail") {
      return (
        <nav
          aria-label={t("workspace.applicationSpaces")}
          className={cn(
            "grid w-full grid-cols-[minmax(0,1fr)_minmax(0,2fr)] overflow-hidden rounded-2xl border p-1 shadow-soft",
            inverted ? "border-white/15 bg-black/20" : "border-border/80 bg-background/70",
            className,
          )}
        >
          <button
            type="button"
            aria-current={currentWorkspace === "public" ? "page" : undefined}
            onClick={() => navigate(publicHomePath)}
            className={cn(
              "flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold sm:text-sm",
              inverted ? "bg-white/15 text-white" : "bg-primary/[0.11] text-primary",
            )}
          >
            <Globe2 className="h-4 w-4" aria-hidden="true" />
            {t("common.public")}
          </button>
          <Link
            to="/auth"
            onClick={onNavigate}
            className={cn(
              "flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-xs font-bold sm:text-sm",
              inverted ? "text-white/75 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
            )}
          >
            <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("workspace.signInAll")}</span>
          </Link>
        </nav>
      );
    }

    if (variant === "sidebar") {
      return (
        <Link
          to="/auth"
          onClick={onNavigate}
          className={cn(
            "flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-soft transition-colors hover:border-primary/30 hover:bg-primary/[0.035]",
            className,
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-foreground">{t("common.signIn")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("workspace.signInDescription")}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      );
    }

    return (
      <Link
        to="/auth"
        onClick={onNavigate}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-bold transition-colors",
          inverted
            ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
            : "border-border bg-card/90 text-foreground shadow-soft hover:border-primary/30 hover:bg-primary/[0.04]",
          "max-w-28",
          className,
        )}
      >
        <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("common.signIn")}</span>
      </Link>
    );
  }

  function openWorkspace(path: string, available: boolean, organizationId?: string) {
    if (!available) return;
    if (organizationId) selectOrganization(organizationId);
    setOpen(false);
    navigate(path);
    onNavigate?.();
  }

  if (variant === "mobile") {
    const workspaceGroups = [
      { key: "athlete", title: t("common.athlete"), description: t("workspace.athleteDescription") },
      { key: "club", title: t("common.clubs"), description: t("workspace.clubDescription") },
      { key: "organizer", title: t("common.organizer"), description: t("workspace.organizerDescription") },
    ] as const;
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <nav aria-label={t("workspace.mobileSpaces")} className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
          <button
            type="button"
            aria-label={t("common.home")}
            onClick={() => openWorkspace(publicHomePath, true)}
            className={cn("flex h-11 w-24 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", inverted ? "text-white" : "text-primary")}
          >
            <MobilePublicHomeIcon imageSrc={publicHomeImageSrc} inverted={inverted} logo={publicHomeLogo} />
          </button>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("workspace.mobileSwitchAccessible", { workspace: currentTypeLabel, name: triggerWorkspaceEntry?.label ?? (currentWorkspace === "public" ? "RacesOn" : t("workspace.unavailable")) })}
              className={cn(
                "ml-auto flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                inverted ? "border-white/25 bg-black/30 text-white" : "border-primary/25 bg-primary/[0.045] text-foreground",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1 text-xs font-bold leading-4">
                  <span className="shrink-0">{currentTypeLabel}</span>
                  {triggerWorkspaceEntry ? <span className="truncate font-medium">· {triggerWorkspaceEntry.label}</span> : null}
                </span>
                <span className={cn("mt-0.5 flex items-center gap-1 text-[10px] font-semibold leading-3", inverted ? "text-white/80" : "text-muted-foreground")}>
                  <ArrowLeftRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {t("workspace.switchShort")}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </SheetTrigger>
        </nav>
        <SheetContent side="bottom" showClose={false} className="mx-auto max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 sm:max-w-lg">
          <SheetClose aria-label={t("common.close")} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="h-5 w-5" aria-hidden="true" /></SheetClose>
          <SheetTitle className="pr-10 text-xl font-bold">{t("workspace.switchTitle")}</SheetTitle>
          <SheetDescription className="mt-1 pr-4 text-xs leading-5">{t("workspace.switchDescription")}</SheetDescription>
          <div className="mt-4 space-y-4" aria-label={t("workspace.available")}>
            <button
              type="button"
              aria-current={currentWorkspace === "public" ? "page" : undefined}
              onClick={() => openWorkspace(publicHomePath, true)}
              className={cn("flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", currentWorkspace === "public" ? "border-primary/40 bg-primary/10" : "border-border")}
            >
              <Globe2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t("workspace.explore")}</span>
                <span className="block text-xs text-muted-foreground">{t("workspace.publicDescription")}</span>
              </span>
              {currentWorkspace === "public" ? <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t("workspace.current")} /> : null}
            </button>
            {workspaceGroups.map((group) => {
              const entries = privateWorkspaceEntries.filter((entry) => entry.key === group.key);
              const discoveryPath = group.key === "club" ? "/clubs" : group.key === "organizer" ? "/for-organizers" : "/auth";
              const discoveryLabel = group.key === "club" ? t("workspace.findClub") : group.key === "organizer" ? t("workspace.discoverOrganizer") : t("common.signIn");
              return (
                <section key={group.key} aria-label={group.title}>
                  <h3 className="text-sm font-bold">{group.title}</h3>
                  <p className="mb-2 text-xs leading-5 text-muted-foreground">{group.description}</p>
                  {entries.length ? (
                    <div className="overflow-hidden rounded-xl border border-border">
                      {entries.map((workspace) => (
                        <button
                          key={workspace.id}
                          type="button"
                          aria-label={workspace.accessibleLabel}
                          aria-current={workspace.selected ? "page" : undefined}
                          onClick={() => openWorkspace(workspace.path, true, workspace.organizationId)}
                          className={cn("flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", workspace.selected && "bg-primary/10 text-primary")}
                        >
                          <DesktopWorkspaceAvatar imageUrl={workspace.avatarUrl} alt={workspace.label} initials={workspace.initials} circular={workspace.circular} selected={workspace.selected} inverted={false} className="h-8 w-8 bg-muted" />
                          <span className="min-w-0 flex-1 break-words text-sm font-semibold">{workspace.label}</span>
                          {workspace.selected ? <Check className="h-4 w-4 shrink-0" aria-label={t("workspace.current")} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Link to={discoveryPath} onClick={() => { setOpen(false); onNavigate?.(); }} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {discoveryLabel}<ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </Link>
                  )}
                </section>
              );
            })}
          </div>
          {user ? (
            <div className="mt-4 border-t border-border pt-3">
              <p className="break-words text-xs text-muted-foreground">{displayName}</p>
              {publicProfilePath ? <Link to={publicProfilePath} onClick={() => { setOpen(false); onNavigate?.(); }} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary">{t("workspace.viewPublicProfile")}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  if (variant === "desktop") {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("workspace.switchAccessible", { name: displayName })}
            className={cn(
              "group flex h-10 min-w-0 max-w-56 shrink-0 items-center gap-2 rounded-[7px] border py-1 pl-1 pr-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              inverted
                ? "border-white/[0.16] bg-black/15 text-white hover:border-white/30 hover:bg-white/[0.08]"
                : "border-border bg-card text-foreground shadow-soft hover:border-primary/30",
              className,
            )}
          >
            {triggerWorkspaceEntry ? (
              <DesktopWorkspaceAvatar
                key={`${triggerWorkspaceEntry.id}-${triggerWorkspaceEntry.avatarUrl ?? "fallback"}`}
                imageUrl={triggerWorkspaceEntry.avatarUrl}
                alt={triggerWorkspaceEntry.key === "athlete"
                  ? t("workspace.profilePicture", { name: triggerWorkspaceEntry.label })
                  : t("workspace.organizationPicture", { name: triggerWorkspaceEntry.label })}
                initials={triggerWorkspaceEntry.initials}
                circular={triggerWorkspaceEntry.circular}
                selected={triggerWorkspaceEntry.selected}
                inverted={inverted}
                className="h-8 w-8 border border-white/10 bg-white/10"
              />
            ) : (
              <Avatar className="h-8 w-8 shrink-0 rounded-full">
                <AvatarFallback className="bg-primary/10 text-[10px] font-black text-primary">
                  {initialsForName(displayName)}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="hidden min-w-0 flex-1 xl:block">
              <span className="block truncate text-xs font-black leading-4">
                {triggerWorkspaceEntry?.label ?? displayName}
              </span>
              <span className={cn(
                "block truncate text-[9px] font-semibold leading-3",
                inverted ? "text-white/55" : "text-muted-foreground",
              )}>
                {currentTypeLabel}
              </span>
            </span>
            <ChevronDown
              className="hidden h-3.5 w-3.5 shrink-0 opacity-65 transition-transform group-data-[state=open]:rotate-180 xl:block"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={8}
          aria-label={t("workspace.available")}
          className="w-[21rem] rounded-xl border-border/80 bg-popover p-2 shadow-xl"
        >
          <div className="flex items-start gap-3 px-2 py-2">
            <Avatar className="h-11 w-11 shrink-0 ring-1 ring-border">
              {account?.avatarUrl ? (
                <AvatarImage
                  src={account.avatarUrl}
                  alt={t("workspace.profilePicture", { name: displayName })}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-xs font-black text-primary">
                {initialsForName(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-sm font-black text-popover-foreground">{displayName}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {profileHandle ? `@${profileHandle}` : t("workspace.athleteProfile")}
              </p>
              {publicProfilePath ? (
                <Link
                  to={publicProfilePath}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-bold text-primary hover:underline"
                >
                  {t("workspace.viewPublicProfile")}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>

          <DropdownMenuSeparator className="my-1.5" />
          <DropdownMenuLabel className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {t("workspace.switchTitle")}
          </DropdownMenuLabel>
          <div className="overflow-hidden rounded-lg border border-border/70">
            <DropdownMenuItem
              aria-label={`RacesOn ${t("common.home")}`}
              aria-current={currentWorkspace === "public" ? "page" : undefined}
              onSelect={() => openWorkspace(publicHomePath, true)}
              className="min-h-14 cursor-pointer gap-3 rounded-none px-2.5 py-2 text-foreground focus:bg-primary/[0.055]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card">
                <img src={brandNavbarSymbolLight} alt="" className="h-6 w-6 object-contain" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">RacesOn</span>
                <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
                  {t("common.home")}
                </span>
              </span>
              <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </DropdownMenuItem>
            {privateWorkspaceEntries.map((workspace) => {
              const selected = workspace.selected;
              return (
              <DropdownMenuItem
                key={workspace.id}
                aria-label={workspace.accessibleLabel}
                aria-current={selected ? "page" : undefined}
                onSelect={() => openWorkspace(workspace.path, true, workspace.organizationId)}
                className={cn(
                  "min-h-14 cursor-pointer gap-3 rounded-none border-t border-border/65 px-2.5 py-2 focus:bg-primary/[0.055]",
                  selected && "bg-primary/[0.075] text-primary focus:text-primary",
                )}
              >
                <DesktopWorkspaceAvatar
                  key={`${workspace.id}-${workspace.avatarUrl ?? "fallback"}`}
                  imageUrl={workspace.avatarUrl}
                  alt={workspace.key === "athlete"
                    ? t("workspace.profilePicture", { name: workspace.label })
                    : t("workspace.organizationPicture", { name: workspace.label })}
                  initials={workspace.initials}
                  circular={workspace.circular}
                  selected={selected}
                  inverted={false}
                  className="h-9 w-9 border border-border/70 bg-card"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">{workspace.label}</span>
                  <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
                    {workspace.typeLabel}
                  </span>
                </span>
                {selected ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t("workspace.current")} />
                ) : null}
              </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (variant === "rail") {

    return (
      <nav
        aria-label={t("workspace.applicationSpaces")}
        className={cn(
          "grid grid-cols-3 overflow-hidden border p-1 shadow-soft",
          "w-full rounded-2xl",
          inverted ? "border-white/15 bg-black/20" : "border-border/80 bg-background/70",
          className,
        )}
      >
        {workspaceDefinitions.map((workspace) => {
          const available = isWorkspaceAvailable(workspace.key);
          const selected = currentWorkspace === workspace.key;
          const Icon = workspace.icon;
          const workspacePath = workspace.key === "public" ? publicHomePath : workspace.path;

          return (
            <button
              key={workspace.key}
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-disabled={!available}
              disabled={!available}
              onClick={() => openWorkspace(workspacePath, available)}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                "min-h-12 rounded-xl px-1.5 text-xs sm:text-sm",
                selected
                  ? inverted
                    ? "bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                    : "bg-primary/[0.11] text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]"
                  : available
                    ? inverted
                      ? "text-white/60 hover:bg-white/10 hover:text-white"
                      : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                    : inverted
                      ? "cursor-not-allowed text-white/30"
                      : "cursor-not-allowed text-muted-foreground/45",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", selected && "text-primary")} aria-hidden="true" />
              <span className="truncate">{t(workspace.labelKey)}</span>
              {!available ? (
                <LockKeyhole
                  className="hidden h-3 w-3 shrink-0 min-[360px]:block"
                  aria-label={t("workspace.unavailable")}
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    );
  }

  const accountPath = currentWorkspace === "organizer"
    ? "/organizer/account"
    : currentWorkspace === "athlete"
      ? "/athlete/account"
      : account?.hasAthleteAccess
        ? "/athlete/account"
        : hasOrganizerWorkspaceAccess(account)
          ? "/organizer/account"
          : "/auth";

  if (variant === "header") {
    return (
      <Link
        to={accountPath}
        onClick={onNavigate}
        aria-label={t("workspace.openAccount", { name: displayName })}
        className={cn(
          "inline-flex min-h-11 min-w-0 max-w-40 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          inverted
            ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
            : "border-border bg-card/90 text-foreground shadow-soft hover:border-primary/30 hover:bg-primary/[0.04]",
          className,
        )}
      >
        <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border/70">
          {account?.avatarUrl ? <AvatarImage src={account.avatarUrl} alt={t("workspace.profilePicture", { name: displayName })} className="object-cover" /> : null}
          <AvatarFallback className="bg-primary/10 text-[10px] font-bold text-primary">
            {initialsForName(displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate">{shortName}</span>
      </Link>
    );
  }

  const trigger = variant === "sidebar" ? (
    <button
      type="button"
      className={cn(
        "group flex min-h-16 w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.055] px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <Avatar className="h-10 w-10 shrink-0 ring-1 ring-border">
        {account?.avatarUrl ? <AvatarImage src={account.avatarUrl} alt={t("workspace.profilePicture", { name: displayName })} className="object-cover" /> : null}
        <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
          {initialsForName(displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-foreground">{displayName}</span>
        <span className="mt-0.5 block text-[10px] font-semibold capitalize text-muted-foreground">
          {t("workspace.currentLabel", { workspace: t(workspaceDefinitions.find((workspace) => workspace.key === currentWorkspace)?.labelKey ?? "common.public") })}
        </span>
      </span>
      <ArrowLeftRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:rotate-180" aria-hidden="true" />
    </button>
  ) : (
    <button
      type="button"
      aria-label={t("workspace.switchAccessible", { name: displayName })}
      className={cn(
        "group inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        inverted
          ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
          : "border-border bg-card/90 text-foreground shadow-soft hover:border-primary/30 hover:bg-primary/[0.04]",
        variant === "desktop" ? "max-w-56 pr-3.5" : "max-w-40",
        className,
      )}
    >
      <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border/70">
        {account?.avatarUrl ? <AvatarImage src={account.avatarUrl} alt={t("workspace.profilePicture", { name: displayName })} className="object-cover" /> : null}
        <AvatarFallback className="bg-primary/10 text-[10px] font-bold text-primary">
          {initialsForName(displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate">{variant === "desktop" ? displayName : shortName}</span>
      <ArrowLeftRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:rotate-180" aria-hidden="true" />
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        className="bottom-[var(--mobile-navigation-height)] mx-auto rounded-t-[28px] border-x-0 border-b-0 bg-card px-4 pb-3 pt-3 focus:outline-none sm:max-w-lg lg:bottom-0"
      >
        <div className="mx-auto w-full max-w-md">
          <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          <SheetTitle className="font-display text-xl font-black tracking-tight text-foreground">
            {t("workspace.switchTitle")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("workspace.switchDescription")}
          </SheetDescription>

          <div className="mt-4 space-y-2" aria-label={t("workspace.available")}>
            {workspaceDefinitions.map((workspace) => {
              const available = isWorkspaceAvailable(workspace.key);
              const selected = currentWorkspace === workspace.key;
              const Icon = workspace.icon;

              return (
                <button
                  key={workspace.key}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  aria-disabled={!available}
                  disabled={!available}
                  onClick={() => openWorkspace(workspace.path, available)}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    selected
                      ? "border-primary bg-primary/[0.055] text-primary"
                      : available
                        ? "border-border bg-background/70 text-foreground hover:border-primary/30 hover:bg-primary/[0.025]"
                        : "cursor-not-allowed border-border/60 bg-muted/20 text-muted-foreground opacity-65",
                  )}
                >
                  <span className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    selected ? "bg-primary/12 text-primary" : "bg-muted/70 text-foreground",
                  )}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{t(workspace.labelKey)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {available
                        ? t(workspace.descriptionKey)
                        : t("workspace.accessNotEnabled", { workspace: t(workspace.labelKey) })}
                    </span>
                  </span>
                  {selected ? (
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" aria-label={t("workspace.current")} />
                  ) : available ? (
                    <Circle className="h-6 w-6 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  ) : (
                    <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("workspace.unavailable")} />
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-center text-[11px] leading-4 text-muted-foreground">
            {t("workspace.changeWhole")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
