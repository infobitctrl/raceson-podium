import assert from "node:assert/strict";
import { createPublicClient, defineChain, http } from "viem";
import { createRewardOperatorClient } from "../dist/rewards/index.js";
import { runAuthenticatedRewardOperator } from "../../../apps/api/dist/features/rewards/operator-command.js";

// Only the owned local rehearsal may launch this test child. It has no database
// credentials or signer keys. Auth GET/SQL POST traffic is an explicit IPC test
// adapter, not actual Supabase HTTP or a bypass in the public testnet command.
if (!process.send || process.env.RACESON_REWARD_OWNED_PROCESS_TEST !== "1") process.exit(1);
let sequence = 0; const pending = new Map();
const bridge = (kind, value) => new Promise((accept, reject) => {
  const id = ++sequence; pending.set(id, { accept, reject });
  process.send({ kind, id, ...value }, error => { if (error) { pending.delete(id); reject(new Error("owned IPC failed")); } });
});
process.on("disconnect", () => process.exit(1));
const response = (url, value, status = 200) => {
  const result = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  Object.defineProperty(result, "url", { value: url }); return result;
};
let started = false;
process.on("message", async message => {
  if (message.kind === "response") {
    const request = pending.get(message.id); if (!request) return process.exit(1);
    pending.delete(message.id); request.accept(message.value); return;
  }
  if (started || message.kind !== "start") return process.exit(1);
  started = true;
  try {
    const { input, jwk, endpoint, creationCode, gasPolicy } = message;
    const url = new URL(endpoint);
    assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
    assert.equal(input.target.mode, "local"); assert.equal(input.target.chainId, 31337);
    const chain = defineChain({ id: 31337, name: "Owned reward process test", nativeCurrency: { name: "Test MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [endpoint] } } });
    const reader = createPublicClient({ chain, transport: http(endpoint, { timeout: 5000, retryCount: 0 }), cacheTime: 0 });
    assert.equal(await reader.getChainId(), 31337);
    const clientFactory = options => createRewardOperatorClient(options, async request => {
      if (request.url === `${input.target.supabaseUrl}/auth/v1/.well-known/jwks.json`) {
        assert.equal(request.method, "GET"); assert.equal(request.headers.get("apikey"), input.publishableKey);
        return response(request.url, { keys: [jwk] });
      }
      assert.equal(request.method, "POST"); assert.equal(request.headers.get("apikey"), input.serverKey);
      const method = request.url.slice(`${input.target.supabaseUrl}/rest/v1/rpc/`.length);
      assert.equal(request.url, `${input.target.supabaseUrl}/rest/v1/rpc/${method}`);
      const value = await bridge("rpc", { method, args: await request.json() });
      return response(request.url, value.error ?? value.data, value.error ? 400 : 200);
    });
    const result = await runAuthenticatedRewardOperator(input, { reader, creationCode, gasPolicy,
      broadcast: bytes => bridge("broadcast", { bytes }) }, clientFactory);
    process.send({ kind: "complete", result }, error => process.exit(error ? 1 : 0));
  } catch {
    process.send({ kind: "failed" }, () => process.exit(1));
  }
});
