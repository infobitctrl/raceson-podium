import { rewardDemoServerEnvironment } from "@raceson/domain/rewards/environment";

export type ServerEnv = {
  rewardHostedCopyPreview?: boolean;
  readOnly: boolean;
  apiHost: string;
  apiPort: number;
  apiCorsOrigin: string | null;
  appBaseUrl: string | null;
  stravaCallbackBaseUrl?: string | null;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePlatformFeeBps: number;
  stripeApiBaseUrl?: string | null;
  stravaClientId: string | null;
  stravaClientSecret: string | null;
  stravaTokenEncryptionKey: string | null;
  stravaApiBaseUrl: string;
  stravaOAuthBaseUrl: string;
};

function requireEnv(name: keyof NodeJS.ProcessEnv, env: NodeJS.ProcessEnv) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBooleanEnv(name: keyof NodeJS.ProcessEnv, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim().toLowerCase();
  if (!value || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${name} must be one of: 1, 0, true, false`);
}

function requireReadOnlyCompatibleEnv(
  primaryName: keyof NodeJS.ProcessEnv,
  publicNames: (keyof NodeJS.ProcessEnv)[],
  env: NodeJS.ProcessEnv,
  readOnly: boolean,
) {
  const primaryValue = env[primaryName];
  if (primaryValue) return primaryValue;
  if (readOnly) {
    for (const publicName of publicNames) {
      const publicValue = env[publicName];
      if (publicValue) return publicValue;
    }
  }
  return requireEnv(primaryName, env);
}

export function loadServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const readOnly = readBooleanEnv("RACESON_READ_ONLY", env);
  const supabaseUrl = requireReadOnlyCompatibleEnv(
    "SUPABASE_URL",
    ["NEXT_PUBLIC_SUPABASE_URL"],
    env,
    readOnly,
  );
  const supabaseAnonKey = requireReadOnlyCompatibleEnv(
    "SUPABASE_ANON_KEY",
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    env,
    readOnly,
  );
  if (env.RACESON_REWARD_HOSTED_COPY_MODE !== undefined &&
    (!["preview-v1", "sponsor-drafts-v1"].includes(env.RACESON_REWARD_HOSTED_COPY_MODE) || env.RACESON_REWARD_PORTAL_MODE !== "testnet"
      || supabaseUrl !== "https://niklhlmljiikwbkrmapw.supabase.co")) throw new Error("hosted_copy_configuration_required");
  const stripePlatformFeeBps = Number(env.STRIPE_PLATFORM_FEE_BPS ?? "0");
  if (
    !Number.isInteger(stripePlatformFeeBps)
    || stripePlatformFeeBps < 0
    || stripePlatformFeeBps > 10_000
  ) {
    throw new Error("STRIPE_PLATFORM_FEE_BPS must be an integer between 0 and 10000");
  }

  const resolved: ServerEnv = {
    rewardHostedCopyPreview: ["preview-v1", "sponsor-drafts-v1"].includes(env.RACESON_REWARD_HOSTED_COPY_MODE ?? ""),
    readOnly,
    apiHost: env.API_HOST ?? "127.0.0.1",
    apiPort: Number(env.API_PORT ?? "8787"),
    apiCorsOrigin: env.API_CORS_ORIGIN ?? null,
    appBaseUrl: env.APP_BASE_URL ?? env.API_CORS_ORIGIN ?? null,
    stravaCallbackBaseUrl: env.STRAVA_CALLBACK_BASE_URL ?? null,
    supabaseUrl,
    supabaseAnonKey,
    // A read-only deployment deliberately ignores any service-role value. This
    // ensures every database client is constrained by the public role and RLS.
    supabaseServiceRoleKey: readOnly
      ? supabaseAnonKey
      : requireEnv("SUPABASE_SERVICE_ROLE_KEY", env),
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
    stripePlatformFeeBps,
    stripeApiBaseUrl: env.STRIPE_API_BASE_URL ?? null,
    stravaClientId: env.STRAVA_CLIENT_ID ?? null,
    stravaClientSecret: env.STRAVA_CLIENT_SECRET ?? null,
    stravaTokenEncryptionKey: env.STRAVA_TOKEN_ENCRYPTION_KEY ?? null,
    stravaApiBaseUrl: env.STRAVA_API_BASE_URL ?? "https://www.strava.com/api/v3",
    stravaOAuthBaseUrl: env.STRAVA_OAUTH_BASE_URL ?? "https://www.strava.com/oauth",
  };
  // Applies to every normal server consumer, not just the reward routes. The
  // demo never silently inherits a live database, alternate CORS origin or
  // registration-payment/Strava integration credentials from a portal .env.
  rewardDemoServerEnvironment({
    mode: env.RACESON_REWARD_PORTAL_MODE,
    origin: env.RACESON_REWARD_DEMO_ORIGIN,
    supabaseUrl: env.RACESON_REWARD_DEMO_SUPABASE_URL,
    publicEnabled: env.NEXT_PUBLIC_RACESON_REWARDS_ENABLED,
    publicMode: env.NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE,
    nodeEnv: env.NODE_ENV,
  }, {
    appBaseUrl: resolved.appBaseUrl,
    supabaseUrl: resolved.supabaseUrl,
    apiCorsOrigin: resolved.apiCorsOrigin,
    externalIntegrationsConfigured: Boolean(resolved.stripeSecretKey || resolved.stripeWebhookSecret
      || resolved.stravaClientId || resolved.stravaClientSecret || resolved.stravaTokenEncryptionKey),
  });
  return resolved;
}
