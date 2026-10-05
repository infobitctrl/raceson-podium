import { Link, Navigate, useLocation } from "react-router-dom";
import { Loader2, LockKeyhole, Mountain } from "lucide-react";
import type { ReactNode } from "react";
import {
  hasOrganizerWorkspaceAccess,
  useAuth,
  type AppRole,
  type AuthAccountContext,
} from "@/lib/auth";
import { useI18n } from "@/shared/i18n/I18nContext";

type ProtectedWorkspaceProps = {
  children: ReactNode;
  accessDenied?: ReactNode;
  requiredRole: Extract<AppRole, "athlete" | "organizer">;
};

function hasRoleAccess(
  account: AuthAccountContext | null,
  role: ProtectedWorkspaceProps["requiredRole"],
) {
  return role === "organizer"
    ? hasOrganizerWorkspaceAccess(account)
    : Boolean(account?.hasAthleteAccess);
}

function alternateAccessRoute(
  account: AuthAccountContext | null,
  role: ProtectedWorkspaceProps["requiredRole"],
) {
  if (account?.hasTestingAccess && !account.hasOrganizerAccess && !account.hasAthleteAccess) {
    return "/organizer/testing";
  }
  if (role === "organizer" && account?.hasAthleteAccess) return "/athlete/dashboard";
  if (role === "athlete" && hasOrganizerWorkspaceAccess(account)) return "/organizer/dashboard";
  return null;
}

export default function ProtectedWorkspace({ children, requiredRole, accessDenied }: ProtectedWorkspaceProps) {
  const { t } = useI18n();
  const location = useLocation();
  const { account, isLoading, user } = useAuth();
  const nextPath = `${location.pathname}${location.search}${location.hash}`;
  const hasResolvedCurrentAccount = Boolean(
    user && account?.userId === user.id,
  );

  if (isLoading && !hasResolvedCurrentAccount) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(nextPath)}`} replace />;
  }

  if (hasRoleAccess(account, requiredRole)) {
    return <>{children}</>;
  }

  if (accessDenied !== undefined) return <>{accessDenied}</>;

  const fallbackRoute = alternateAccessRoute(account, requiredRole);
  const workspaceLabel = requiredRole === "organizer"
    ? t("workspace.organizerLabel")
    : t("workspace.athleteLabel");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-soft">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("workspace.protected.eyebrow")}
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold">{t("workspace.protected.title", { workspace: workspaceLabel })}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("workspace.protected.description")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {fallbackRoute ? (
            <Link
              to={fallbackRoute}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              {t("workspace.protected.available")}
            </Link>
          ) : null}
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted/60"
          >
            <Mountain className="h-4 w-4" />
            {t("workspace.protected.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
