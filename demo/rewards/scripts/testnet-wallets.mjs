import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const helper = resolve(root, "demo/rewards/local/.artifacts/operator-keychain");
export const testnetRoles = ["funder", "operator", "relayer"];
export const testnetKeychainService = "RacesOn Monad Testnet Operators 2026-09-09";
function call(action, role, input) {
  assert.ok(testnetRoles.includes(role));
  assert.equal(process.platform, "darwin");
  assert.ok(existsSync(helper) && lstatSync(helper).isFile() && realpathSync(helper) === helper, "Compile the reviewed local Keychain helper first");
  try { return execFileSync(helper, [action, role], { cwd: root, input, encoding: "utf8", maxBuffer: 4096,
    env: Object.fromEntries(["PATH", "HOME", "TMPDIR"].filter(k => process.env[k]).map(k => [k, process.env[k]])),
    stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 }).trim(); }
  catch { throw new Error(`Testnet ${role} Keychain operation failed. No secret or child error was logged.`); }
}
export function publicTestnetWallet(role) {
  const value = call("public", role);
  if (value === "missing") return null;
  assert.match(value, /^0x[0-9a-fA-F]{40}$/); return value;
}
// Called only by explicitly authorized local operator tooling, never web/API.
// No secret export to console, files, environment variables or shell arguments.
export function loadTestnetOperatorAccount(role) {
  const address = publicTestnetWallet(role); assert.ok(address, "Testnet role is not provisioned");
  const key = call("read-pipe", role);
  assert.match(key, /^0x[0-9a-f]{64}$/);
  const account = privateKeyToAccount(key);
  assert.equal(account.address, address, "Keychain public identity mismatch");
  return account;
}
async function main() {
  const [action, ...rest] = process.argv.slice(2); assert.equal(rest.length, 0);
  assert.ok(["create", "public", "verify"].includes(action), "Usage: testnet-wallets.mjs create|public|verify");
  const output = [];
  for (const role of testnetRoles) {
    let address = publicTestnetWallet(role), created = false;
    if (action === "create" && !address) {
      const privateKey = generatePrivateKey(), account = privateKeyToAccount(privateKey);
      assert.equal(call("create", role, JSON.stringify({ privateKey, address: account.address })), "stored");
      address = publicTestnetWallet(role); assert.equal(address, account.address); created = true;
    }
    if (action !== "public" && address) assert.equal(loadTestnetOperatorAccount(role).address, address);
    output.push({ role, address, created, verified: action !== "public" && !!address });
  }
  assert.equal(new Set(output.filter(r => r.address).map(r => r.address)).size, output.filter(r => r.address).length);
  console.log(JSON.stringify({ network: "Monad testnet only", chainId: 10143, keychainService: testnetKeychainService,
    custody: "local Mac login Keychain with dedicated helper ACL; not athlete wallets or hardware custody", wallets: output }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error("Testnet wallet operation failed. No private key or child output was logged."); process.exitCode = 1;
});
