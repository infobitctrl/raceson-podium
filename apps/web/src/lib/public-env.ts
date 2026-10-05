import { rewardDemoBrowserEnvironment, assertRewardDemoBrowserOrigin } from "@raceson/domain/rewards/environment";

const normalize = (value: string | undefined) => value?.trim() ?? "";

const configuredEnv = {
  apiBaseUrl: normalize(
    process.env.NEXT_PUBLIC_RACESON_API_BASE_URL
      ?? process.env.NEXT_PUBLIC_API_BASE_URL,
  ),
  authRedirectBaseUrl: normalize(
    process.env.NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL
      ?? process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL,
  ),
  demoAthleteSlug: normalize(process.env.NEXT_PUBLIC_DEMO_ATHLETE_SLUG),
  demoOrganizationSlug: normalize(process.env.NEXT_PUBLIC_DEMO_ORGANIZATION_SLUG),
  supabasePublishableKey: normalize(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  supabaseStorageKey:
    normalize(
      process.env.NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY
        ?? process.env.NEXT_PUBLIC_SUPABASE_STORAGE_KEY,
    ) || "raceson-auth",
  supabasePublicUrl:
    normalize(process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_URL)
    || normalize(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseUrl: normalize(process.env.NEXT_PUBLIC_SUPABASE_URL),
} as const;

// Keep explicit process.env.NAME references: Next only inlines static public
// lookups. No server-only values or credentials enter the target policy.
const rewardDemo = rewardDemoBrowserEnvironment({
  enabled: process.env.NEXT_PUBLIC_RACESON_REWARDS_ENABLED,
  mode: process.env.NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE,
  origin: process.env.NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN,
  supabaseUrl: process.env.NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL,
  actualSupabaseUrl: configuredEnv.supabaseUrl,
  publicSupabaseUrl: configuredEnv.supabasePublicUrl,
  apiBaseUrl: configuredEnv.apiBaseUrl || "/api",
  authRedirectBaseUrl: configuredEnv.authRedirectBaseUrl,
  storageKey: configuredEnv.supabaseStorageKey,
});

export const publicEnv = {
  ...configuredEnv,
  rewardDemo,
  hostedCopy: process.env.NEXT_PUBLIC_RACESON_REWARD_HOSTED_COPY_MODE === "sponsor-drafts-v1",
  hostedOperations: process.env.NEXT_PUBLIC_RACESON_REWARD_HOSTED_OPERATIONS === 'testnet-v1',
  rewardPortalEnabled: rewardDemo !== null && process.env.NEXT_PUBLIC_RACESON_REWARDS_ENABLED === "true",
} as const;

export function assertPublicEnvironmentOrigin() {
  assertRewardDemoBrowserOrigin(publicEnv.rewardDemo, typeof window === "undefined" ? null : window.location.origin);
}
