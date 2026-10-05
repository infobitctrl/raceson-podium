import type { Hex } from "viem";
import { canaryPublicClient } from "@raceson/rewards-chain/canary-public-client";
import { readCanaryStatus } from "@raceson/rewards-chain/canary-status";
import type { CanaryStatus } from "@raceson/domain/rewards/canary";

// Public aggregate only: never cache/share an authenticated Supabase client.
// Coalesce concurrent reads, but never serve an old success after an RPC failure.
let inflight: Promise<CanaryStatus> | null = null;
let nextAllowed = 0;
export async function publicCanaryStatus(): Promise<CanaryStatus> {
  if (inflight) return inflight;
  if (Date.now() < nextAllowed) throw new Error("canary_rate_limited");
  nextAllowed = Date.now() + 3000;
  const configured = process.env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH;
  if (configured !== undefined && !/^0x[0-9a-f]{64}$/.test(configured)) throw new Error("invalid_canary_deployment_hash");
  inflight = readCanaryStatus(canaryPublicClient, (configured as Hex | undefined) ?? null);
  try { return await inflight; } finally { inflight = null; }
}
