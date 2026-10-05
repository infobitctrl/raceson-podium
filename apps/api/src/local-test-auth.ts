function isLoopbackHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function requestOriginHostname(origin: string | null | undefined) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

export function resolveLocalTestAuthCredentials(
  processEnv: NodeJS.ProcessEnv,
  apiHost: string,
  requestOrigin: string | null | undefined,
) {
  if (processEnv.LOCAL_TEST_AUTH_ENABLED !== "true") return null;
  if (!isLoopbackHostname(apiHost)) return null;

  const originHostname = requestOriginHostname(requestOrigin);
  if (!originHostname || !isLoopbackHostname(originHostname)) return null;

  // A source checkout must never supply credentials for retained test accounts.
  const email = processEnv.LOCAL_TEST_ACCOUNT_EMAIL?.trim();
  const password = processEnv.LOCAL_TEST_ACCOUNT_PASSWORD;
  if (!email || !password?.trim()) return null;
  return { email, password };
}
