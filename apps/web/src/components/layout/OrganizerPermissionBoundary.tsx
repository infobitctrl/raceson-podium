import { Link, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import {
  hasAnyOrganizationPermission,
  type OrganizationPermission,
} from "@/lib/auth";
import { useOrganizerAuth } from "@/lib/organizer-workspace";

export default function OrganizerPermissionBoundary({
  children,
  permissions,
  permanentOnly = false,
  organizationOnly = false,
  allowOrganizerSetup = false,
  unassignedWorkerLanding = false,
}: {
  children: ReactNode;
  permissions: OrganizationPermission[];
  permanentOnly?: boolean;
  organizationOnly?: boolean;
  allowOrganizerSetup?: boolean;
  unassignedWorkerLanding?: boolean;
}) {
  const { account } = useOrganizerAuth();
  const hasEventAccess = Boolean(
    account?.eventAccess.some((assignment) =>
      permissions.some((permission) =>
        assignment.permissions.includes(permission),
      ),
    ),
  );
  const isOrganizerSetup = Boolean(
    allowOrganizerSetup
    && account?.organizerSetupEnabled
    && !account.hasOrganizerAccess
    && account.organizations.length === 0,
  );
  const allowed = isOrganizerSetup || Boolean(
    account
    && (
      !permanentOnly
      || account.accountType !== "temporary"
    )
    && (
      hasAnyOrganizationPermission(account, permissions)
      || (!organizationOnly && hasEventAccess)
    ),
  );

  if (allowed) return <>{children}</>;

  if (
    account?.accountType === "temporary"
    || account?.defaultRole === "timer"
  ) {
    if (unassignedWorkerLanding) {
      return (
        <div className="p-5 lg:p-8">
          <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-border bg-card p-8 text-center sm:p-10">
            <h1 className="font-display text-2xl font-bold">No race-day assignment yet</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your account is active, but it has not been assigned to a race or checkpoint.
              Ask an organization admin to assign you, then reload this page.
            </p>
            <Link
              to="/organizer/support"
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open support
            </Link>
          </div>
        </div>
      );
    }
    return <Navigate to="/organizer/race-operations?phase=race" replace />;
  }
  if (account?.eventAccess.length) {
    const canOperateRaceDay = account.eventAccess.some((assignment) =>
      assignment.permissions.some((permission) =>
        [
          "entrants.manage",
          "race_day.manage",
          "checkpoint_timing.enter",
          "safety.manage",
          "logistics.manage",
        ].includes(
          permission,
        )
      )
    );
    return (
      <Navigate
        to={canOperateRaceDay
          ? "/organizer/race-operations?phase=race"
          : "/organizer/timing-results"}
        replace
      />
    );
  }
  return <Navigate to="/organizer/dashboard" replace />;
}
