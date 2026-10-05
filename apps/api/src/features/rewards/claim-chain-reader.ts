import { createPublicClient, http } from "viem";
import { RewardProtocolError, type RewardCampaignReader, type RewardClubSafeDeploymentReader, type RewardClubClaimReader } from "@raceson/rewards-chain";
import type { RewardPortalConfig } from "./request-identity.js";
import { acquireTestnetRead } from "./testnet-read-pacing.js";

export const REWARD_CLAIM_TESTNET_RPC = "https://testnet-rpc.monad.xyz/";
const unavailable = () => new RewardProtocolError("reward_claim_transport_unavailable");
function endpoint(value: string): string {
  if (value === REWARD_CLAIM_TESTNET_RPC) return value;
  try {
    const url = new URL(value);
    if (url.href === value && url.protocol === "http:" && url.hostname === "127.0.0.1"
      && /^[1-9][0-9]{0,4}$/.test(url.port) && Number(url.port) <= 65535 && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash) return value;
  } catch { /* Fail closed; never return the rejected URL. */ }
  throw unavailable();
}
const methods = new Set(["eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBalance"]);

/** No signing, wallet or broadcast RPC. Limit the complete response, including
 * stalled bodies, and all calls in one review to the same fixed time budget. */
export function rewardClaimChainFetch(url: string, fetchImpl: typeof fetch = globalThis.fetch, timeoutMs = 10000) {
  return readOnlyChainFetch(url, methods, fetchImpl, timeoutMs);
}
/** Club verification additionally reads pinned Safe storage; it still cannot
 * request account access, sign, estimate/send transactions or select a URL. */
export function rewardClubReviewChainFetch(url: string, fetchImpl: typeof fetch = globalThis.fetch, timeoutMs = 10000) {
  return readOnlyChainFetch(url, new Set([...methods, "eth_getStorageAt"]), fetchImpl, timeoutMs);
}
function readOnlyChainFetch(url: string, allowed: ReadonlySet<string>, fetchImpl: typeof fetch, timeoutMs: number) {
  const target = endpoint(url), deadline = Date.now() + 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw unavailable();
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    let request: Request;
    try {
      if (typeof init?.body !== "string" || Buffer.byteLength(init.body) > 65536) throw unavailable();
      const body = JSON.parse(init.body);
      if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" || !allowed.has(body.method)
        || !Array.isArray(body.params ?? []) || Object.keys(body).some(key => !["jsonrpc", "id", "method", "params"].includes(key))) throw unavailable();
      request = new Request(input, init);
      let unexpectedHeader = false;
      request.headers.forEach((_, key) => { if (!["content-type", "accept"].includes(key)) unexpectedHeader = true; });
      if (request.url !== target || request.method !== "POST" || request.signal.aborted
        || unexpectedHeader) throw unavailable();
    } catch { throw unavailable(); }
    const remaining = Math.min(timeoutMs, deadline - Date.now());
    if (remaining <= 0) throw unavailable();
    const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let release: (() => void) | undefined;
    let onAbort: () => void = () => {}; let timer: ReturnType<typeof setTimeout>;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(unavailable()); signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), remaining);
    });
    const read = async () => {
      if (target === REWARD_CLAIM_TESTNET_RPC) release = await acquireTestnetRead(signal);
      if (signal.aborted) throw unavailable();
      const response = await fetchImpl(request, { signal, redirect: "error", credentials: "omit", cache: "no-store" });
      if (signal.aborted || !response.ok || response.redirected || response.url !== target
        || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable();
      const limit = 8 * 1024 * 1024, declared = response.headers.get("content-length");
      if (!response.body || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))) throw unavailable();
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read(); if (signal.aborted) throw unavailable(); if (part.done) break;
        size += part.value.byteLength; if (size > limit) throw unavailable(); chunks.push(part.value);
      }
      return new Response(Buffer.concat(chunks, size), { status: response.status, headers: { "content-type": "application/json" } });
    };
    try { return await Promise.race([read(), stopped]); }
    catch { throw unavailable(); }
    finally { clearTimeout(timer!); signal.removeEventListener("abort", onAbort); controller.abort(); release?.(); if (reader) void reader.cancel().catch(() => {}); }
  };
}

/** Called only after demo configuration/auth/input validation. Never accepts a
 * URL from an athlete request or falls back to a generic/provider wallet client. */
export function createRewardClaimReader(config: RewardPortalConfig, values: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch): RewardCampaignReader {
  return createReadOnlyClient(config, values, fetchImpl, rewardClaimChainFetch);
}
export function createRewardClubReviewReader(config: RewardPortalConfig, values: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch): RewardClubSafeDeploymentReader {
  return createReadOnlyClient(config, values, fetchImpl, rewardClubReviewChainFetch);
}
export function createRewardClubClaimReader(config: RewardPortalConfig, values: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch): RewardClubClaimReader {
  return createReadOnlyClient(config, values, fetchImpl, rewardClubReviewChainFetch);
}
function createReadOnlyClient(config: RewardPortalConfig, values: Record<string, string | undefined>, fetchImpl: typeof fetch | undefined,
  transportFetch: typeof rewardClaimChainFetch) {
  const local = values.RACESON_REWARD_LOCAL_RPC_URL;
  let url: string;
  if (config.chainId === 10143 && local === undefined) url = REWARD_CLAIM_TESTNET_RPC;
  else if (config.chainId === 31337 && values.NODE_ENV !== "production" && typeof local === "string") {
    url = endpoint(local); if (url === REWARD_CLAIM_TESTNET_RPC) throw unavailable();
  } else throw unavailable();
  return createPublicClient({ cacheTime: 0, transport: http(url, { retryCount: 0, timeout: 10000,
    fetchFn: transportFetch(url, fetchImpl) }) });
}
