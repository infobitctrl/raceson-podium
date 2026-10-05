import type { PlatformRole, RequestSession } from "@raceson/domain/auth";
import { forbidden } from "./errors.js";

export type PlatformCapability =
  | "platform.records.view"
  | "platform.records.edit"
  | "platform.records.transfer"
  | "platform.records.delete"
  | "platform.integrity.decide"
  | "platform.administrators.manage"
  | "platform.accounts.manage"
  | "platform.organizations.manage";

const capabilitiesByRole: Record<PlatformRole, ReadonlySet<PlatformCapability>> = {
  site_admin: new Set([
    "platform.records.view",
    "platform.records.edit",
    "platform.records.transfer",
    "platform.records.delete",
    "platform.integrity.decide",
    "platform.accounts.manage",
    "platform.organizations.manage",
  ]),
  super_admin: new Set([
    "platform.records.view",
    "platform.records.edit",
    "platform.records.transfer",
    "platform.records.delete",
    "platform.integrity.decide",
    "platform.administrators.manage",
    "platform.accounts.manage",
    "platform.organizations.manage",
  ]),
};

export function hasPlatformCapability(
  role: PlatformRole | null,
  capability: PlatformCapability,
) {
  return role ? capabilitiesByRole[role].has(capability) : false;
}

export function requirePlatformCapability(
  session: RequestSession,
  capability: PlatformCapability,
) {
  if (!hasPlatformCapability(session.account.platformRole, capability)) {
    throw forbidden("This platform administrator role cannot perform that action.");
  }
}

export function platformRecordCapabilities(session: RequestSession) {
  return {
    canView: hasPlatformCapability(session.account.platformRole, "platform.records.view"),
    canEdit: hasPlatformCapability(session.account.platformRole, "platform.records.edit"),
    canTransfer: hasPlatformCapability(session.account.platformRole, "platform.records.transfer"),
    canDelete: hasPlatformCapability(session.account.platformRole, "platform.records.delete"),
  };
}
