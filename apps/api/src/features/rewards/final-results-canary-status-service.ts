import { canaryPublicClient } from "@raceson/rewards-chain/canary-public-client";
import { readFinalResultsCanaryStatus } from "@raceson/rewards-chain/final-results-canary-status";
import type { FinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";

// Independent V3 throttle/flight: a V2 response must never populate this view.
// No successful observation is cached beyond concurrent callers.
let inflight: Promise<FinalResultsCanaryStatus> | null = null;
let nextAllowed = 0;
export async function publicFinalResultsCanaryStatus(): Promise<FinalResultsCanaryStatus> {
  if (inflight) return inflight;
  if (Date.now() < nextAllowed) throw new Error("canary_rate_limited");
  nextAllowed = Date.now() + 3000;
  inflight = readFinalResultsCanaryStatus(canaryPublicClient);
  try { return await inflight; } finally { inflight = null; }
}
