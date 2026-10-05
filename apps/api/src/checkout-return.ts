type BrowserHeaders = {
  origin?: string | string[];
  "sec-fetch-site"?: string | string[];
  "x-trail-client"?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function originOf(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveBrowserCheckoutReturn(
  headers: BrowserHeaders,
  allowedOrigins: ReadonlySet<string>,
) {
  if (first(headers["x-trail-client"]) !== "alt-web") return undefined;
  const origin = originOf(first(headers.origin));
  const fetchSite = first(headers["sec-fetch-site"])?.toLowerCase();
  if (!origin || !allowedOrigins.has(origin) || fetchSite === "cross-site") {
    throw new Error("Untrusted browser origin");
  }
  return {
    baseUrl: origin,
    registrationPath: "/events",
  };
}
