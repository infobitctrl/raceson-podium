import { getSupabaseBrowserClient } from "@/lib/supabase";
import { publicEnv } from "@/lib/public-env";
import { assertRewardDemoBrowserOrigin } from "@raceson/domain/rewards/environment";
import { platformSupportRequestHeaders } from "@/shared/platform/platformSupportWorkspace";

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, options: { status: number; code?: string | null }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? null;
  }
}

type ApiRequestOptions = {
  path: string;
  method?: "DELETE" | "GET" | "POST" | "PATCH";
  accessToken?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  cache?: RequestCache;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

type ApiSuccessPayload<T> = {
  data: T;
};

const CONFIGURED_API_BASE_URL = publicEnv.apiBaseUrl;

function normalizeApiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function isLocalHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

type ApiLocation = {
  hostname: string;
  origin: string;
};

function isSameOriginApiBaseUrl(baseUrl: string, origin: string) {
  const normalized = normalizeApiBaseUrl(baseUrl);
  return normalized === "/api" || normalized === `${normalizeApiBaseUrl(origin)}/api`;
}

async function hasStructuredApiError(response: Response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return false;
  }

  const payload = (await response.clone().json().catch(() => null)) as ApiErrorPayload | null;
  return Boolean(
    payload
    && typeof payload === "object"
    && payload.error
    && typeof payload.error.code === "string"
    && payload.error.code.trim(),
  );
}

async function shouldRetryApiResponse(response: Response, hasFallback: boolean) {
  if (!hasFallback) return false;
  if (response.status === 404) return true;
  if (![502, 503, 504].includes(response.status)) return false;
  return !(await hasStructuredApiError(response));
}

export function resolveApiBaseUrls(
  location: ApiLocation | null = typeof window !== "undefined" ? window.location : null,
  configuredApiBaseUrl = CONFIGURED_API_BASE_URL,
) {
  if (publicEnv.rewardDemo) {
    assertRewardDemoBrowserOrigin(publicEnv.rewardDemo, location?.origin ?? null);
    // No :8787, hostname-alias or cross-origin fallback in an isolated demo.
    return [publicEnv.rewardDemo.apiBaseUrl];
  }
  const candidates: string[] = [];

  function pushCandidate(candidate: string | null | undefined) {
    if (!candidate) return;
    const normalized = normalizeApiBaseUrl(candidate);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  }

  const isLocal = location ? isLocalHostname(location.hostname) : false;
  const configuredUsesSameOrigin = Boolean(
    location
      && configuredApiBaseUrl
      && isSameOriginApiBaseUrl(configuredApiBaseUrl, location.origin),
  );
  const configuredCrossesLocalHostnames = Boolean(
    location
      && isLocal
      && configuredApiBaseUrl
      && (() => {
        try {
          const configuredHostname = new URL(configuredApiBaseUrl, location.origin).hostname;
          return isLocalHostname(configuredHostname) && configuredHostname !== location.hostname;
        } catch {
          return false;
        }
      })(),
  );

  // The local API process on :8787 has the server-only Supabase environment.
  // Prefer it over Next's same-origin /api fallback, which may be running without
  // those variables when the web app is started independently.
  if ((!isLocal || !configuredUsesSameOrigin) && !configuredCrossesLocalHostnames) {
    pushCandidate(configuredApiBaseUrl);
  }

  if (location?.origin) {
    if (isLocal) {
      pushCandidate(`http://${location.hostname}:8787/api`);
    }

    if (!configuredCrossesLocalHostnames) {
      pushCandidate(configuredApiBaseUrl);
    }
    pushCandidate("/api");
    pushCandidate(`${location.origin}/api`);
  } else {
    pushCandidate(configuredApiBaseUrl);
  }

  pushCandidate("/api");
  return candidates.length ? candidates : ["/api"];
}

export function resolveApiUrl(path: string, baseUrl = resolveApiBaseUrls()[0]) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function resolveAccessToken(explicitAccessToken?: string | null) {
  if (explicitAccessToken !== undefined) {
    return explicitAccessToken;
  }

  const client = getSupabaseBrowserClient();
  if (!client) return null;

  const { data: { session }, error } = await client.auth.getSession();
  if (error) {
    console.warn("Unable to resolve Supabase session for API request", error);
    return null;
  }

  return session?.access_token ?? null;
}

export async function apiRequest<T>({
  path,
  method = "GET",
  accessToken,
  body,
  headers,
  cache,
}: ApiRequestOptions): Promise<T> {
  const resolvedAccessToken = await resolveAccessToken(accessToken);
  const baseUrls = resolveApiBaseUrls();
  let lastFetchError: unknown = null;
  let response: Response | null = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    try {
      const candidate = await fetch(resolveApiUrl(path, baseUrl), {
        method,
        cache,
        credentials: "include",
        ...(publicEnv.rewardDemo ? { redirect: "error" as const } : {}),
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(resolvedAccessToken ? { Authorization: `Bearer ${resolvedAccessToken}` } : {}),
          ...platformSupportRequestHeaders(path),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const shouldRetry = await shouldRetryApiResponse(
        candidate,
        index < baseUrls.length - 1,
      );

      if (shouldRetry) {
        continue;
      }

      response = candidate;
      break;
    } catch (error) {
      lastFetchError = error;
      if (index === baseUrls.length - 1) {
        throw error;
      }
    }
  }

  if (!response) {
    throw (lastFetchError instanceof Error ? lastFetchError : new Error("Request failed"));
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ApiSuccessPayload<T> | T | ApiErrorPayload | null;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new ApiError(errorPayload?.error?.message ?? "Request failed", {
      status: response.status,
      code: errorPayload?.error?.code ?? null,
    });
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiSuccessPayload<T>).data;
  }

  return payload as T;
}

export async function apiDownload({
  path,
  method = "GET",
  accessToken,
}: Omit<ApiRequestOptions, "body">): Promise<{ blob: Blob; fileName: string | null; mimeType: string | null }> {
  const resolvedAccessToken = await resolveAccessToken(accessToken);
  const baseUrls = resolveApiBaseUrls();
  let lastFetchError: unknown = null;
  let response: Response | null = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    try {
      const candidate = await fetch(resolveApiUrl(path, baseUrl), {
        method,
        credentials: "include",
        headers: {
          Accept: "*/*",
          ...(resolvedAccessToken ? { Authorization: `Bearer ${resolvedAccessToken}` } : {}),
          ...platformSupportRequestHeaders(path),
        },
      });

      const shouldRetry = await shouldRetryApiResponse(
        candidate,
        index < baseUrls.length - 1,
      );

      if (shouldRetry) {
        continue;
      }

      response = candidate;
      break;
    } catch (error) {
      lastFetchError = error;
      if (index === baseUrls.length - 1) {
        throw error;
      }
    }
  }

  if (!response) {
    throw (lastFetchError instanceof Error ? lastFetchError : new Error("Request failed"));
  }

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(errorPayload?.error?.message ?? "Request failed", {
      status: response.status,
      code: errorPayload?.error?.code ?? null,
    });
  }

  const disposition = response.headers.get("content-disposition");
  const fileNameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? null,
    mimeType: response.headers.get("content-type"),
  };
}
