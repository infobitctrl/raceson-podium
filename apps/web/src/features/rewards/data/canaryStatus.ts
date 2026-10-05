import { decodeCanaryStatus } from "@raceson/domain/rewards/canary";
import { decodeFinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";
import { assertPublicEnvironmentOrigin, publicEnv } from "@/lib/public-env";

export async function getCanaryStatus(signal: AbortSignal) {
  return decodeCanaryStatus(await readStatus("canary", signal));
}
export async function getFinalResultsCanaryStatus(signal: AbortSignal) {
  return decodeFinalResultsCanaryStatus(await readStatus("canary/final-results", signal));
}
async function readStatus(path: "canary" | "canary/final-results", signal: AbortSignal): Promise<unknown> {
  assertPublicEnvironmentOrigin();
  const demo = publicEnv.rewardDemo;
  if (!demo || demo.chainId !== 10143) throw new Error("canary_testnet_required");
  // The environment policy binds this base to the isolated demo's own origin.
  // Public infrastructure status never sends an athlete session or wallet data.
  const response = await fetch(`${demo.apiBaseUrl}/v1/rewards/${path}`, {
    method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("canary_observation_unavailable");
  const envelope: unknown = await response.json();
  if (!envelope || typeof envelope !== "object" || !("data" in envelope)) throw new Error("invalid_canary_response");
  return envelope.data;
}
