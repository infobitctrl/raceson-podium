import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, existsSync, lstatSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http } from "viem";
import { fixtureSigner } from "../../../packages/rewards-chain/integration/owned-chain.mjs";
import { root, cleanEnvironment } from "./local-demo.mjs";

export const LOCAL_PROGRAMME_READ_PORT = 18546;
export const LOCAL_PROGRAMME_READ_URL = `http://127.0.0.1:${LOCAL_PROGRAMME_READ_PORT}`;
const methods = new Set(["eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_getBalance", "eth_getStorageAt"]);
export function validateLocalProgrammeRead(request, origin, host) {
  assert.equal(origin, undefined, "Browser-origin RPC access is forbidden");
  assert.match(host ?? "", /^127\.0\.0\.1:\d+$/);
  assert.ok(request && !Array.isArray(request) && request.jsonrpc === "2.0" && methods.has(request.method)
    && (request.params === undefined || Array.isArray(request.params)) && ["string", "number"].includes(typeof request.id));
  assert.ok(Object.keys(request).every(k => ["jsonrpc", "method", "params", "id"].includes(k)));
}

/** LOCAL SIMULATION ONLY. Owns a fresh-or-restored, non-forked Anvil child.
 * No caller-supplied RPC, chain, key, funding destination or public transaction.
 * The read proxy cannot sign, broadcast, mine, reset or mutate chain state.
 * directory/port overrides exist only for disposable integration tests. */
export async function startProgrammeLocalChain({ directory = join(root, "demo/rewards/local/.artifacts/programme-chain-v3"), readPort = LOCAL_PROGRAMME_READ_PORT } = {}) {
  assert.equal(resolve(directory), directory);
  assert.ok(directory.startsWith(join(root, "demo/rewards/local/.artifacts/") ) || directory.startsWith("/private/tmp/raceson-programme-chain-"));
  assert.ok(Number.isInteger(readPort) && (readPort === 0 || readPort === LOCAL_PROGRAMME_READ_PORT));
  const previousMask = process.umask(0o077);
  let node, server, walletRpc, walletClock, lock, stopped = false, openingWallet = false;
  const state = join(directory, "state.json"), lockPath = join(directory, "running.lock");
  const fresh = !existsSync(state);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assert.equal(realpathSync(directory), directory); assert.equal(lstatSync(directory).mode & 0o077, 0);
    if (existsSync(state)) { assert.ok(lstatSync(state).isFile() && !lstatSync(state).isSymbolicLink()); assert.equal(lstatSync(state).mode & 0o077, 0); }
    // Do not infer a stale lock from a timeout or delete another runtime's lock.
    lock = openSync(lockPath, "wx", 0o600);
    const binary = join(root, "contracts/.toolchain/foundry-v1.8.0/anvil");
    const version = execFileSync(binary, ["--version"], { env: cleanEnvironment(), encoding: "utf8" });
    assert.match(version, /anvil Version: 1\.8\.0/); assert.match(version, /61ae26af36320d4fa1020f7db53785885e29eeb5/);
    const endpoint = await new Promise((resolve, reject) => {
      node = spawn(binary, ["--host", "127.0.0.1", "--port", "0", "--accounts", "0", "--chain-id", "31337", "--network", "monad",
        "--timestamp", "1801000000", "--state", state, "--state-interval", "60", "--preserve-historical-states",
        "--color", "never", "--disable-console-log", "--no-cors"], { env: cleanEnvironment(), cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => reject(Error("local_programme_start_timeout")), 15000);
      node.once("error", () => { clearTimeout(timer); reject(Error("local_programme_start_failed")); });
      node.once("exit", () => { clearTimeout(timer); reject(Error("local_programme_stopped")); });
      node.stderr.on("data", () => {}); // Never echo runtime state/transaction payloads.
      node.stdout.on("data", chunk => {
        output = (output + chunk).slice(-3000);
        const found = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
        if (found) { clearTimeout(timer); resolve(`http://127.0.0.1:${found[1]}`); }
      });
    });
    const chain = defineChain({ id: 31337, name: "RacesOn local MON simulation", nativeCurrency: { name: "Local MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [endpoint] } } });
    const transport = http(endpoint, { retryCount: 0, timeout: 10000 });
    const reader = createPublicClient({ chain, transport, cacheTime: 0, pollingInterval: 100 });
    const test = createTestClient({ mode: "anvil", chain, transport });
    assert.equal(await reader.getChainId(), 31337);
    const operator = fixtureSigner(0xA11CE), funder = fixtureSigner(0x777);
    server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
      try {
        assert.ok(!stopped && node.exitCode === null && node.signalCode === null);
        assert.equal(req.method, "POST"); assert.equal(req.url, "/");
        assert.ok(!req.headers.authorization && !req.headers.cookie && !req.headers.apikey);
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; assert.ok(size <= 65536); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        validateLocalProgrammeRead(body, req.headers.origin, req.headers.host);
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
        const payload = await response.text(); assert.ok(response.ok && payload.length <= 8 * 1024 * 1024);
        res.end(payload);
      } catch { res.statusCode = 503; res.end(JSON.stringify({ error: "local_programme_read_unavailable" })); }
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(readPort, "127.0.0.1", resolve); });
    node.once("exit", () => { clearInterval(walletClock); walletRpc?.stop(); server.close(); server.closeAllConnections(); });
    async function stop() {
      if (stopped) return; stopped = true;
      clearInterval(walletClock); walletRpc?.stop(); server.close(); server.closeAllConnections();
      if (node.exitCode === null && node.signalCode === null) await new Promise(resolve => {
        // Preserved historical states can exceed 100 MB even in the compact
        // fixture. Give Anvil a bounded minute to flush; a forced stop still
        // fails below and retains the lock for inspection. Never report a
        // truncated snapshot as a successful graceful shutdown.
        const timer = setTimeout(() => node.kill("SIGKILL"), 60000);
        node.once("exit", () => { clearTimeout(timer); resolve(); }); node.kill("SIGTERM");
      });
      assert.notEqual(node.signalCode, "SIGKILL", "Local state flush failed; runtime lock retained for inspection");
      closeSync(lock); lock = undefined; unlinkSync(lockPath);
      process.umask(previousMask);
    }
    return { reader, test, operator, funder, fresh, operatorWallet: createWalletClient({ account: operator, chain, transport }),
      funderWallet: createWalletClient({ account: funder, chain, transport }), readUrl: `http://127.0.0.1:${server.address().port}`, stop,
      openWalletRpc: async ({ binding, access, review, alive }) => {
        assert.ok(!stopped && !walletRpc && !openingWallet, "local_wallet_rpc_already_open");
        openingWallet = true;
        try {
          const { startProgrammeWalletRpc } = await import("./programme-wallet-rpc.mjs");
          const connection = await startProgrammeWalletRpc({ client: reader, binding, access, review,
            journalDirectory: join(directory, "wallet-deposits"), ...(readPort === 0 ? { port: 0 } : {}),
            alive: () => !stopped && node.exitCode === null && node.signalCode === null && alive() });
          walletRpc = { ...connection, blockIntervalSeconds: 1,
            stop: () => { clearInterval(walletClock); connection.stop(); } };
          if (stopped) { walletRpc.stop(); throw Error("local_wallet_session_closed"); }
          // One ordinary empty simulator block per wall-clock second while this
          // explicit wallet session is alive. No accelerated time, catch-up
          // batches or HTTP mining controls. Never overlap provider requests.
          let mining = false;
          walletClock = setInterval(async () => {
            if (mining) return;
            mining = true;
            try {
              if (stopped || node.exitCode !== null || node.signalCode !== null || !alive()) { walletRpc.stop(); return; }
              await test.mine({ blocks: 1, interval: 1 });
            } catch {
              walletRpc.stop();
              console.error("Local wallet connection stopped: simulator block progression failed. Inspect owned state before reopening.");
            } // Never log provider errors or transaction payloads.
            finally { mining = false; }
          }, 1000);
          return walletRpc;
        } finally { openingWallet = false; }
      } };
  } catch (error) {
    clearInterval(walletClock); walletRpc?.stop(); server?.close(); server?.closeAllConnections();
    if (node && node.exitCode === null && node.signalCode === null) await new Promise(resolve => { node.once("exit", resolve); node.kill("SIGTERM"); });
    if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
    process.umask(previousMask); throw error;
  }
}
