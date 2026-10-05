import { afterEach, describe, expect, it, vi } from "vitest";
import { validateRewardDemoBuildEnvironment } from "./demo-build-environment";

const origin = "https://reward-demo.invalid";
const database = "https://abcdefghijklmnopqrst.supabase.co";
const server = {
  NODE_ENV: "production", RACESON_REWARD_PORTAL_MODE: "testnet", RACESON_REWARD_DEMO_ORIGIN: origin,
  RACESON_REWARD_DEMO_SUPABASE_URL: database, APP_BASE_URL: origin, SUPABASE_URL: database,
  NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: "testnet", NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "true",
  NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN: origin, NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL: database,
};
const exposed = { NEXT_PUBLIC_SUPABASE_URL: database, NEXT_PUBLIC_SUPABASE_PUBLIC_URL: database,
  NEXT_PUBLIC_API_BASE_URL: "/api", NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: origin,
  NEXT_PUBLIC_SUPABASE_STORAGE_KEY: "raceson-rewards-demo-auth" };

afterEach(() => { vi.unstubAllEnvs(); });

describe("demo Next build boundary", () => {
  it("leaves ordinary portal builds alone", () => {
    expect(validateRewardDemoBuildEnvironment({}, {})).toBeNull();
    expect(validateRewardDemoBuildEnvironment({ SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, {})).toBeNull();
  });
  it("requires browser and server to declare the same isolated testnet environment", () => {
    expect(validateRewardDemoBuildEnvironment(server, exposed)).toMatchObject({ chainId: 10143, origin, apiBaseUrl: `${origin}/api` });
    for (const key of ["RACESON_REWARD_PORTAL_MODE", "RACESON_REWARD_DEMO_ORIGIN", "RACESON_REWARD_DEMO_SUPABASE_URL",
      "NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE", "NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN", "NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL"]) {
      expect(() => validateRewardDemoBuildEnvironment({ ...server, [key]: undefined }, exposed)).toThrow("reward_demo_configuration_required");
    }
  });
  it("rejects inherited production database/API/Auth URLs and browser session namespaces", () => {
    for (const patch of [{ SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, { APP_BASE_URL: "https://www.raceson.com" },
      { API_CORS_ORIGIN: "https://www.raceson.com" }, { RACESON_REWARD_PORTAL_MODE: "disabled" }]) {
      expect(() => validateRewardDemoBuildEnvironment({ ...server, ...patch }, exposed)).toThrow("reward_demo_configuration_required");
    }
    for (const patch of [{ NEXT_PUBLIC_SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" },
      { NEXT_PUBLIC_SUPABASE_PUBLIC_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, { NEXT_PUBLIC_API_BASE_URL: "https://www.raceson.com/api" },
      { NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: "https://www.raceson.com" }, { NEXT_PUBLIC_SUPABASE_STORAGE_KEY: "raceson-auth" }]) {
      expect(() => validateRewardDemoBuildEnvironment(server, { ...exposed, ...patch })).toThrow("reward_demo_configuration_required");
    }
  });
  it("refuses inherited payment/Strava credentials without including them in errors", () => {
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY"]) {
      expect(() => validateRewardDemoBuildEnvironment({ ...server, [key]: "synthetic-not-a-real-secret" }, exposed))
        .toThrow(/^reward_demo_configuration_required$/);
    }
  });
  it("keeps environment checks active when reward UI is temporarily hidden", () => {
    const hidden = { ...server, NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "false" };
    expect(validateRewardDemoBuildEnvironment(hidden, exposed)).not.toBeNull();
    expect(() => validateRewardDemoBuildEnvironment({ ...hidden, SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, exposed))
      .toThrow("reward_demo_configuration_required");
  });
  it("refuses inherited local database proxy rewrites in the demo", () => {
    for (const key of ["RACESON_LOCAL_SUPABASE_PROXY_TARGET", "SITRAIL_LOCAL_SUPABASE_PROXY_TARGET"]) {
      expect(() => validateRewardDemoBuildEnvironment({ ...server, [key]: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, exposed))
        .toThrow("reward_demo_configuration_required");
    }
  });
  it("runs the boundary in the actual Next config, including its public-variable fallbacks", async () => {
    for (const [key, value] of Object.entries({ ...server, ...exposed })) vi.stubEnv(key, value);
    for (const key of ["NEXT_PUBLIC_RACESON_API_BASE_URL", "NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL", "NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY",
      "API_CORS_ORIGIN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY",
      "RACESON_LOCAL_SUPABASE_PROXY_TARGET", "SITRAIL_LOCAL_SUPABASE_PROXY_TARGET"]) vi.stubEnv(key, undefined);
    vi.resetModules();
    expect((await import("../../../../next.config")).default.env.NEXT_PUBLIC_SUPABASE_URL).toBe(database);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://icdtinbmtvzhswrrzjxq.supabase.co");
    vi.resetModules();
    await expect(import("../../../../next.config")).rejects.toThrow("reward_demo_configuration_required");
  });
  it("requires demo configuration in the independent app, with no ordinary-portal fallback", async () => {
    const values = { ...server, ...exposed, NEXT_PUBLIC_RACESON_API_BASE_URL: "/api",
      NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL: origin,
      NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY: "raceson-rewards-demo-auth" };
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    vi.resetModules();
    const config = (await import("../../../../../../demo/rewards/web/next.config")).default;
    expect(config.env.NEXT_PUBLIC_API_BASE_URL).toBe("/api");
    expect(config).not.toHaveProperty("rewrites");
    expect(config).not.toHaveProperty("redirects");
    expect(config.images.remotePatterns).toEqual([{
      protocol: "https", hostname: new URL(database).hostname, port: "",
      pathname: "/storage/v1/object/public/**", search: "",
    }]);
    expect(config.images.maximumRedirects).toBe(0);
    expect((await config.headers())[0].headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" });
    for (const key of Object.keys(values)) vi.stubEnv(key, undefined);
    vi.resetModules();
    await expect(import("../../../../../../demo/rewards/web/next.config")).rejects.toThrow("reward_demo_configuration_required");
  });
  it("does not enable remote image optimization into the local backend", async () => {
    const localOrigin = "http://127.0.0.1:3102", localDatabase = "http://127.0.0.1:55431";
    const values = { ...server, ...exposed, NODE_ENV: "development",
      RACESON_REWARD_PORTAL_MODE: "local-testnet", NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: "local-testnet",
      RACESON_REWARD_DEMO_ORIGIN: localOrigin, NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN: localOrigin,
      APP_BASE_URL: localOrigin, RACESON_REWARD_DEMO_SUPABASE_URL: localDatabase,
      NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL: localDatabase, SUPABASE_URL: localDatabase,
      NEXT_PUBLIC_SUPABASE_URL: localDatabase, NEXT_PUBLIC_SUPABASE_PUBLIC_URL: localDatabase,
      NEXT_PUBLIC_RACESON_API_BASE_URL: "/api", NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL: localOrigin,
      NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY: "raceson-rewards-demo-auth" };
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    vi.resetModules();
    const config = (await import("../../../../../../demo/rewards/web/next.config")).default;
    expect(config.images.remotePatterns).toEqual([]);
    expect(config.images.maximumRedirects).toBe(0);
  });
});
