import { describe, expect, it } from "vitest";
import { isRewardPrivyToken, rewardPrivyConfiguration } from "./privyConfiguration";
import type { RewardDemoBrowserEnvironment } from "@raceson/domain/rewards/environment";

const demo: RewardDemoBrowserEnvironment = { mode: "local-testnet", chainId: 10143, origin: "http://127.0.0.1:3102",
  supabaseUrl: "http://127.0.0.1:55321", apiBaseUrl: "http://127.0.0.1:3102/api", storageKey: "raceson-rewards-demo-auth" };
export const issuer = `${demo.supabaseUrl}/auth/v1`, userId = "84000000-0000-4000-8000-000000000001";
export function token(payload = {}, header = {}) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return [encode({ alg: "ES256", kid: "test-public-key", ...header }), encode({ iss: issuer, sub: userId,
    exp: Math.floor(Date.now() / 1000) + 3600, session_id: "84000000-0000-4000-8000-000000000002",
    aud: "authenticated", role: "authenticated", ...payload }), "synthetic-signature-not-authorization"].join(".");
}

describe("Privy demo configuration and token disclosure guard", () => {
  it("stays off without an App ID and rejects production/local simulation or another origin", () => {
    expect(rewardPrivyConfiguration(undefined, demo, demo.origin)).toBeNull();
    const id = "c".repeat(25);
    expect(rewardPrivyConfiguration(id, demo, demo.origin)).toMatchObject({ appId: id, issuer });
    for (const [target, origin] of [[null, demo.origin], [{ ...demo, mode: "local", chainId: 31337 }, demo.origin],
      [demo, "https://www.raceson.com"], [{ ...demo, supabaseUrl: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, demo.origin]] as const)
      expect(() => rewardPrivyConfiguration(id, target, origin)).toThrow("reward_privy_configuration_required");
  });
  it("accepts only a scoped, unexpired asymmetric token for the exact demo user", () => {
    expect(isRewardPrivyToken(token(), issuer, userId)).toBe(true);
    for (const payload of [{ iss: "https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1" }, { sub: "other" }, { role: "service_role" },
      { aud: "anon" }, { is_anonymous: true }, { exp: 1 }, { exp: "9999999999" }, { session_id: null }])
      expect(isRewardPrivyToken(token(payload), issuer, userId)).toBe(false);
    expect(isRewardPrivyToken(token({}, { alg: "HS256" }), issuer, userId)).toBe(false);
    expect(isRewardPrivyToken("malformed", issuer, userId)).toBe(false);
  });
});
