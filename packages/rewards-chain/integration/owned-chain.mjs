import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Test-only deterministic identities. Never use these on a public network.
export const fixtureSigner = n => privateKeyToAccount(toHex(BigInt(n), { size: 32 }));

// No endpoint, key, fork, state-file or signer input is accepted.
export async function startOwnedRewardChain({ chainId = 31337, retainLifecycleHistory = false } = {}) {
  // Both IDs still launch our own fresh loopback node; no external endpoint.
  assert.ok(chainId === 31337 || chainId === 10143);
  assert.equal(typeof retainLifecycleHistory, "boolean");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const contractRoot = resolve(root, "contracts");
  const artifact = JSON.parse(readFileSync(resolve(contractRoot, "out/RacesOnRewardCampaign.sol/RacesOnRewardCampaign.json"), "utf8"));
  // Never real keys. Only these synthetic signers are used on a fresh, loopback-only,
  // non-forked Anvil instance, with balances set by local test RPC.
  const operator = fixtureSigner(0xA11CE);
  const relayer = fixtureSigner(0xFEED);
  const clubOwners = [0x1111, 0x2222, 0x3333].map(fixtureSigner);
  const treasury = fixtureSigner(0x777).address;
  let node;
  let publicClient;
  let testClient;
  let operatorClient;
  let relayerClient;

  async function stopOwnedNode() {
    if (!node || !node.pid || node.exitCode !== null || node.signalCode !== null) return;
    await new Promise((done) => {
      const timeout = setTimeout(() => { node.kill("SIGKILL"); }, 3000);
      node.once("exit", () => { clearTimeout(timeout); done(); });
      node.kill("SIGTERM");
    });
  }
  try {
    const binary = resolve(contractRoot, ".toolchain/foundry-v1.8.0/anvil");
    const version = execFileSync(binary, ["--version"], { encoding: "utf8" });
    assert.match(version, /anvil Version: 1\.8\.0/);
    assert.match(version, /61ae26af36320d4fa1020f7db53785885e29eeb5/);
    const endpoint = await new Promise((accept, reject) => {
      // No --fork-url, keystore, account-generation or state-persistence option.
      // Long receipt-recovery tests need earlier eth_call state, not only block
      // headers/receipts. Keep a bounded in-memory history with disk persistence
      // disabled by --prune-history. No state file, fork or real signer is used.
      node = spawn(binary, ["--port", "0", "--host", "127.0.0.1", "--accounts", "0", "--chain-id", String(chainId), "--network", "monad", "--timestamp", "1801000000", "--color", "never", "--disable-console-log", "--no-cors",
        ...(retainLifecycleHistory ? ["--prune-history", "16384"] : [])], { cwd: contractRoot, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let diagnostic = "";
      const timeout = setTimeout(() => { reject(new Error("Owned local Anvil did not report its listening port within 15 seconds")); node.kill("SIGTERM"); }, 15_000);
      node.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-1500); });
      node.once("error", (error) => { clearTimeout(timeout); reject(error); });
      node.once("exit", (code, signal) => { clearTimeout(timeout); reject(new Error(`Owned Anvil exited (${code ?? signal}): ${diagnostic}`)); });
      node.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-5000);
        const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timeout); accept(`http://127.0.0.1:${match[1]}`); }
      });
    });
    const chain = defineChain({ id: chainId, name: "Disposable RacesOn Monad simulation", nativeCurrency: { name: "Test MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [endpoint] } } });
    const transport = http(endpoint, { retryCount: 0, timeout: 5000 });
    publicClient = createPublicClient({ chain, transport, pollingInterval: 10, cacheTime: 0 });
    testClient = createTestClient({ mode: "anvil", chain, transport });
    operatorClient = createWalletClient({ account: operator, chain, transport });
    relayerClient = createWalletClient({ account: relayer, chain, transport });
    assert.equal(await publicClient.getChainId(), chainId);
    await testClient.setBalance({ address: operator.address, value: 500n * 10n ** 18n });
    await testClient.setBalance({ address: relayer.address, value: 20n * 10n ** 18n });
    return { artifact, operator, relayer, clubOwners, treasury, publicClient, testClient, operatorClient, relayerClient, stop: stopOwnedNode };
  } catch (error) {
    await stopOwnedNode();
    throw error;
  }
}
