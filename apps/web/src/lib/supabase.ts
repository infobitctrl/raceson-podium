import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasPasswordRecoveryIntent } from "@/lib/auth-security";
import { publicEnv } from "@/lib/public-env";
import { assertRewardDemoBrowserOrigin } from "@raceson/domain/rewards/environment";
import { demoSupabaseFetch } from "@/features/rewards/data/demo-supabase-fetch";

let browserClient: SupabaseClient | null | undefined;
let publicClient: SupabaseClient | null | undefined;
const SUPABASE_STORAGE_KEY = publicEnv.supabaseStorageKey;
const LEGACY_SUPABASE_STORAGE_KEY = "sitrail-auth";

function migrateLegacyBrowserSession() {
  if (publicEnv.rewardDemo) return;
  if (typeof window === "undefined" || SUPABASE_STORAGE_KEY === LEGACY_SUPABASE_STORAGE_KEY) return;
  if (window.localStorage.getItem(SUPABASE_STORAGE_KEY)) return;
  const legacySession = window.localStorage.getItem(LEGACY_SUPABASE_STORAGE_KEY);
  if (legacySession) {
    window.localStorage.setItem(SUPABASE_STORAGE_KEY, legacySession);
  }
}

export function hasSupabaseConfig() {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}

function hasSupabasePublicConfig() {
  return Boolean(publicEnv.supabasePublicUrl && publicEnv.supabasePublishableKey);
}

export function getSupabaseStorageKey() {
  return SUPABASE_STORAGE_KEY;
}

export function getSupabaseBrowserClient() {
  assertRewardDemoBrowserOrigin(publicEnv.rewardDemo, typeof window === "undefined" ? null : window.location.origin);
  if (browserClient !== undefined) {
    return browserClient;
  }

  if (!hasSupabaseConfig()) {
    browserClient = null;
    return browserClient;
  }

  if (typeof window !== "undefined") {
    // Supabase consumes and removes recovery tokens from the URL while the
    // lazy reset route is still loading. Persist the route intent first so the
    // page can render the new-password form after that URL cleanup.
    hasPasswordRecoveryIntent(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
  }

  migrateLegacyBrowserSession();

  browserClient = createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      ...(publicEnv.rewardDemo ? { global: { fetch: demoSupabaseFetch(publicEnv.rewardDemo) } } : {}),
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: SUPABASE_STORAGE_KEY,
      },
    },
  );

  return browserClient;
}

export function getSupabasePublicClient() {
  assertRewardDemoBrowserOrigin(publicEnv.rewardDemo, typeof window === "undefined" ? null : window.location.origin);
  if (publicClient !== undefined) {
    return publicClient;
  }

  if (!hasSupabasePublicConfig()) {
    publicClient = null;
    return publicClient;
  }

  publicClient = createClient(
    publicEnv.supabasePublicUrl,
    publicEnv.supabasePublishableKey,
    {
      ...(publicEnv.rewardDemo ? { global: { fetch: demoSupabaseFetch(publicEnv.rewardDemo) } } : {}),
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `${SUPABASE_STORAGE_KEY}-public`,
      },
    },
  );

  return publicClient;
}
