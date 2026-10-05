import { assertRewardDemoBrowserOrigin, type RewardDemoBrowserEnvironment } from "@raceson/domain/rewards/environment";

/** Applied to both authenticated and public SDK clients in the demo only. */
export function demoSupabaseFetch(demo: RewardDemoBrowserEnvironment): typeof fetch {
  return async (input, init) => {
    assertRewardDemoBrowserOrigin(demo, typeof window === "undefined" ? null : window.location.origin);
    let target: URL;
    try {
      target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    } catch { throw new Error("reward_demo_database_target_mismatch"); }
    if (target.origin !== demo.supabaseUrl || target.username || target.password) {
      throw new Error("reward_demo_database_target_mismatch");
    }
    return fetch(input, { ...init, redirect: "error" });
  };
}
