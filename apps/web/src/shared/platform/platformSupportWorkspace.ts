export const PLATFORM_SUPPORT_ORGANIZATION_HEADER = "X-RacesOn-Support-Organization";

const PLATFORM_SUPPORT_ORGANIZATION_STORAGE_KEY = "raceson.platform-support-organization";

function storage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function readPlatformSupportOrganizationId() {
  try {
    return storage()?.getItem(PLATFORM_SUPPORT_ORGANIZATION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setPlatformSupportOrganizationId(organizationId: string) {
  try {
    storage()?.setItem(PLATFORM_SUPPORT_ORGANIZATION_STORAGE_KEY, organizationId);
  } catch {
    // Support mode can still use the current URL when session storage is unavailable.
  }
}

export function clearPlatformSupportOrganizationId() {
  try {
    storage()?.removeItem(PLATFORM_SUPPORT_ORGANIZATION_STORAGE_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export function platformSupportRequestHeaders(path: string) {
  if (!path.startsWith("/v1/organizer/")) return {};
  const organizationId = readPlatformSupportOrganizationId();
  return organizationId
    ? { [PLATFORM_SUPPORT_ORGANIZATION_HEADER]: organizationId }
    : {};
}
