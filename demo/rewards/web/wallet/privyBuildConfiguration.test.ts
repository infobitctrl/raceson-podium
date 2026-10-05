import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic values only. Importing Next configuration must not contact providers.
const origin = "https://reward-demo.invalid";
const database = "https://abcdefghijklmnopqrst.supabase.co";
const appId = "c".repeat(25);
const base = {
  NODE_ENV: "production", RACESON_REWARD_PORTAL_MODE: "testnet",
  RACESON_REWARD_DEMO_ORIGIN: origin, RACESON_REWARD_DEMO_SUPABASE_URL: database,
  APP_BASE_URL: origin, SUPABASE_URL: database,
  NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: "testnet", NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "true",
  NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN: origin, NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL: database,
  NEXT_PUBLIC_SUPABASE_URL: database, NEXT_PUBLIC_SUPABASE_PUBLIC_URL: database,
  NEXT_PUBLIC_RACESON_API_BASE_URL: "/api", NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL: origin,
  NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY: "raceson-rewards-demo-auth",
};
const optional = ["RACESON_REWARD_PRIVY_APP_ID", "NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "API_CORS_ORIGIN",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET",
  "STRAVA_TOKEN_ENCRYPTION_KEY", "RACESON_LOCAL_SUPABASE_PROXY_TARGET", "SITRAIL_LOCAL_SUPABASE_PROXY_TARGET"];

beforeEach(() => {
  for (const key of optional) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("provider_io_forbidden_in_config_test"); }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
const config = () => import("../next.config");
function ids(server: string | undefined, browser: string | undefined) {
  vi.stubEnv("RACESON_REWARD_PRIVY_APP_ID", server);
  vi.stubEnv("NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID", browser);
}

describe("actual independent demo Privy build boundary", () => {
  it("keeps the demo usable without a wallet provider", async () => {
    expect((await config()).default.distDir).toBe(".next-build");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts matched explicit public IDs without putting server credentials in exposed env", async () => {
    ids(appId, appId);
    vi.stubEnv("PRIVY_APP_SECRET", "synthetic-never-a-real-secret");
    const result = (await config()).default;
    expect(result.env).not.toHaveProperty("PRIVY_APP_SECRET");
    expect(JSON.stringify(result.env)).not.toContain("synthetic-never-a-real-secret");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[appId, undefined], [undefined, appId], [appId, "d".repeat(25)],
    ["malformed", "malformed"], [" ", " "]])("rejects unmatched or malformed explicit IDs (%s / %s)", async (server, browser) => {
    ids(server, browser);
    await expect(config()).rejects.toThrow(/^reward_privy_configuration_required$/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLIC_URL"])(
    "does not let a matched Privy ID bypass the protected %s boundary", async key => {
      ids(appId, appId);
      vi.stubEnv(key, "https://icdtinbmtvzhswrrzjxq.supabase.co");
      await expect(config()).rejects.toThrow(/^reward_demo_configuration_required$/);
    });
  it("rejects Privy activation on the 31337 local simulation", async () => {
    ids(appId, appId);
    const local = "http://127.0.0.1:3101", db = "http://127.0.0.1:55321";
    for (const [key, value] of Object.entries(base)) {
      vi.stubEnv(key, value === origin ? local : value === database ? db : value === "testnet" ? "local" : value);
    }
    vi.stubEnv("NODE_ENV", "development");
    await expect(config()).rejects.toThrow(/^reward_privy_configuration_required$/);
  });
  it("retains the existing prohibition on production-mode local-testnet builds", async () => {
    ids(appId, appId);
    const local = "http://127.0.0.1:3102", db = "http://127.0.0.1:55321";
    for (const [key, value] of Object.entries(base)) {
      vi.stubEnv(key, value === origin ? local : value === database ? db : value === "testnet" ? "local-testnet" : value);
    }
    await expect(config()).rejects.toThrow(/^reward_demo_configuration_required$/);
  });
  it("accepts the separate 3102 public-testnet development target without connecting", async () => {
    ids(appId, appId);
    const local = "http://127.0.0.1:3102", db = "http://127.0.0.1:55321";
    for (const [key, value] of Object.entries(base)) {
      vi.stubEnv(key, value === origin ? local : value === database ? db : value === "testnet" ? "local-testnet" : value);
    }
    vi.stubEnv("NODE_ENV", "development");
    expect((await config()).default.distDir).toBe(".next-testnet");
    expect(fetch).not.toHaveBeenCalled();
  });
});
