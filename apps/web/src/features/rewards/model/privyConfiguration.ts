import { rewardDemoTarget, type RewardDemoBrowserEnvironment } from "@raceson/domain/rewards/environment";

export type RewardPrivyConfiguration = Readonly<{ appId: string; origin: string; issuer: string }>;

/** Optional provider setup, never a fallback to production or local chain 31337.
 * A configured app ID is not provider activation/recovery or release evidence. */
export function rewardPrivyConfiguration(
  appId: string | undefined, demo: RewardDemoBrowserEnvironment | null, actualOrigin: string,
): RewardPrivyConfiguration | null {
  if (!appId) return null;
  if (!/^[a-z0-9]{20,64}$/.test(appId) || !demo || demo.chainId !== 10143
    || !rewardDemoTarget(demo) || demo.origin !== actualOrigin)
    throw new Error("reward_privy_configuration_required");
  return Object.freeze({ appId, origin: demo.origin, issuer: `${demo.supabaseUrl}/auth/v1` });
}

/** This is a disclosure/scope guard, NOT JWT signature verification. Privy
 * verifies the signature; the reward API independently authorizes RacesOn Auth.
 * Never expose a production, anonymous, symmetric or another user's token. */
export function isRewardPrivyToken(token: unknown, issuer: string, userId: string, now = Date.now()): token is string {
  try {
    if (typeof token !== "string" || token.length > 16384 || token.split(".").length !== 3) return false;
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const [header, payload] = token.split(".").slice(0, 2).map(decode);
    return ["ES256", "RS256"].includes(header.alg) && typeof header.kid === "string" && header.kid.length > 0
      && payload.iss === issuer && payload.sub === userId && payload.role === "authenticated"
      && payload.aud === "authenticated" && payload.is_anonymous !== true
      && typeof payload.session_id === "string" && /^[0-9a-f-]{36}$/i.test(payload.session_id)
      && Number.isSafeInteger(payload.exp) && payload.exp > Math.floor(now / 1000) + 30;
  } catch { return false; }
}
