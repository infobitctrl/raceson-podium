import { rewardDemoBrowserEnvironment, rewardDemoServerEnvironment } from "@raceson/domain/rewards/environment";

type Environment = Record<string, string | undefined>;

/** Runs after Next resolves its public env mappings and before it starts a
 * compiler. No provider calls, secrets in errors or environment-file loading. */
export function validateRewardDemoBuildEnvironment(server: Environment, exposed: Environment) {
  const demo = rewardDemoBrowserEnvironment({
    enabled: server.NEXT_PUBLIC_RACESON_REWARDS_ENABLED,
    mode: server.NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE,
    origin: server.NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN,
    supabaseUrl: server.NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL,
    actualSupabaseUrl: exposed.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publicSupabaseUrl: exposed.NEXT_PUBLIC_SUPABASE_PUBLIC_URL ?? "",
    apiBaseUrl: exposed.NEXT_PUBLIC_API_BASE_URL ?? "",
    authRedirectBaseUrl: exposed.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL ?? "",
    storageKey: exposed.NEXT_PUBLIC_SUPABASE_STORAGE_KEY ?? "",
  });
  const backend = rewardDemoServerEnvironment({
    mode: server.RACESON_REWARD_PORTAL_MODE,
    origin: server.RACESON_REWARD_DEMO_ORIGIN,
    supabaseUrl: server.RACESON_REWARD_DEMO_SUPABASE_URL,
    publicEnabled: server.NEXT_PUBLIC_RACESON_REWARDS_ENABLED,
    publicMode: server.NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE,
    nodeEnv: server.NODE_ENV,
  }, {
    appBaseUrl: server.APP_BASE_URL ?? server.API_CORS_ORIGIN ?? null,
    supabaseUrl: server.SUPABASE_URL ?? "",
    apiCorsOrigin: server.API_CORS_ORIGIN ?? null,
    externalIntegrationsConfigured: Boolean(server.STRIPE_SECRET_KEY || server.STRIPE_WEBHOOK_SECRET
      || server.STRAVA_CLIENT_ID || server.STRAVA_CLIENT_SECRET || server.STRAVA_TOKEN_ENCRYPTION_KEY),
  });
  if ((demo && (server.RACESON_LOCAL_SUPABASE_PROXY_TARGET || server.SITRAIL_LOCAL_SUPABASE_PROXY_TARGET))
    || Boolean(demo) !== Boolean(backend) || (demo && backend && (demo.origin !== backend.origin
    || demo.supabaseUrl !== backend.supabaseUrl || demo.chainId !== backend.chainId))) {
    throw new Error("reward_demo_configuration_required");
  }
  return demo;
}
