type LocalPathOptions = {
  blockedPathnames?: string[];
};

type RegistrationPathOptions = {
  eventSlug?: string | null;
  categorySlug?: string | null;
};

const LOCAL_PATH_BASE = "https://sitrail.local";

export function canonicalizeEventPath(pathname: string) {
  return pathname
    .replace(/^\/organizer\/races(?=\/|$)/, "/organizer/events")
    .replace(/^\/races(?=\/|$)/, "/events")
    .replace(/^(\/leagues\/[^/]+)\/races(?=\/|$)/, "$1/events");
}

export function canonicalizeEventLocation(location: {
  hash: string;
  pathname: string;
  search: string;
}) {
  return {
    pathname: canonicalizeEventPath(location.pathname),
    search: location.search,
    hash: location.hash,
  };
}

export function sanitizeLocalAppPath(
  value: string | null | undefined,
  options: LocalPathOptions = {},
) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, LOCAL_PATH_BASE);
    if (url.origin !== LOCAL_PATH_BASE) return null;

    const blockedPathnames = options.blockedPathnames ?? [];
    if (blockedPathnames.includes(url.pathname)) return null;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function buildRegistrationPath({ eventSlug, categorySlug }: RegistrationPathOptions = {}) {
  const params = new URLSearchParams();
  if (eventSlug) params.set("event", eventSlug);
  if (categorySlug) params.set("category", categorySlug);
  const query = params.toString();
  return query ? `/registration?${query}` : "/registration";
}
