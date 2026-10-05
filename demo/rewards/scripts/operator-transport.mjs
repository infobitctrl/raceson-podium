export const REWARD_OPERATOR_RPC_URL = "https://testnet-rpc.monad.xyz";
const unavailable = () => new Error("reward_operator_chain_unavailable");
const methods = new Set(["eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_getBalance",
  "eth_estimateGas", "eth_sendRawTransaction"]);
const clubMethods = new Set([...methods, "eth_getStorageAt"]);

/** Dedicated testnet transport. Bounds headers AND body; the SDK's header
 * timeout alone does not cover a stalled body. No wallet RPCs or fallback URL.
 * This only transports already signed bytes; workers own execution authority. */
export function rewardOperatorChainFetch(signal, fetchImpl = globalThis.fetch, timeoutMs = 10000) {
  return scopedOperatorChainFetch(methods, signal, fetchImpl, timeoutMs);
}
// Original Safe verification requires storage reads. Keep that capability out
// of the existing athlete/operator transport.
export function rewardClubOperatorChainFetch(signal, fetchImpl = globalThis.fetch, timeoutMs = 10000) {
  return scopedOperatorChainFetch(clubMethods, signal, fetchImpl, timeoutMs);
}
function scopedOperatorChainFetch(allowedMethods, signal, fetchImpl, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw unavailable();
  return async (input, init) => {
    let request;
    try {
      if (typeof init?.body !== "string" || Buffer.byteLength(init.body) > 1024 * 1024) throw unavailable();
      const body = JSON.parse(init.body);
      if (!body || body.jsonrpc !== "2.0" || !allowedMethods.has(body.method) || !Array.isArray(body.params ?? [])) throw unavailable();
      request = new Request(input, init);
      if (request.url !== new URL(REWARD_OPERATOR_RPC_URL).href || request.method !== "POST"
        || ["authorization", "apikey", "cookie"].some(key => request.headers.has(key))) throw unavailable();
    } catch { throw unavailable(); }
    if (signal.aborted || request.signal.aborted) throw unavailable();
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, request.signal, controller.signal]);
    let reader; let onAbort; let timer;
    const stopped = new Promise((_, reject) => {
      onAbort = () => reject(unavailable());
      combined.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
    });
    const read = async () => {
      const response = await fetchImpl(request, { redirect: "error", credentials: "omit", cache: "no-store", signal: combined });
      if (combined.aborted || response.redirected || response.url !== request.url
        || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable();
      const limit = 8 * 1024 * 1024;
      const declared = response.headers.get("content-length");
      if (!response.body || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))) throw unavailable();
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const part = await reader.read();
        if (combined.aborted) throw unavailable();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw unavailable();
        chunks.push(part.value);
      }
      return new Response(Buffer.concat(chunks, size), { status: response.status, headers: { "content-type": "application/json" } });
    };
    try { return await Promise.race([read(), stopped]); }
    catch { throw unavailable(); }
    finally {
      clearTimeout(timer); combined.removeEventListener("abort", onAbort); controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  };
}
