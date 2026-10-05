// Human-operated only, after explicit approval of the documented bounded plan.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { executeContractCanary, publicCanaryExecution } from "./contract-canary-executor.mjs";
import { prepareCanarySourcePackage, exportCanarySourcePackage, observeCanaryExplorerSource } from "./contract-canary-source.mjs";

export async function main(args) {
  const [action, flag, approvedManifestHash, ...rest] = args;
  assert.equal(rest.length, 0);
  const readOnly = ["inspect", "prepare-source", "inspect-source"].includes(action);
  assert.ok(readOnly ? args.length === 1 : ["deploy", "stage", "activate"].includes(action) && flag === "--approved-manifest" && args.length === 3,
    "Usage: contract-canary.mjs inspect | prepare-source | inspect-source | (deploy|stage|activate) --approved-manifest EXACT_OWNER_APPROVED_HASH");
  const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url), "utf8"));
  const execution = publicCanaryExecution(artifact);
  if (!readOnly) assert.equal(approvedManifestHash, execution.spec.programmeManifestHash);
  const pack = action.includes("source") || ["stage", "activate"].includes(action) ? prepareCanarySourcePackage(artifact,
    fileURLToPath(new URL("../../../contracts", import.meta.url))) : null;
  if (action === "prepare-source") {
    const directory = exportCanarySourcePackage(pack);
    console.log(JSON.stringify({ status: "prepared-not-published", chainId: 10143, directory,
      packageHash: pack.packageHash, sourceCount: Object.keys(pack.input.sources).length }, null, 2));
    return;
  }
  const journalDirectory = fileURLToPath(new URL("../local/.artifacts/contract-canary-20260909", import.meta.url));
  const client = createPublicClient({ chain: monadTestnet, cacheTime: 0,
    transport: http("https://testnet-rpc.monad.xyz", { timeout: 15000, retryCount: 0 }) });
  const result = await executeContractCanary({ execution, client, journalDirectory,
    action: action === "inspect-source" ? "inspect" : action, approvedManifestHash,
    verifySource: pack ? expected => observeCanaryExplorerSource(pack, expected, client) : undefined,
    onProgress: progress => console.log(JSON.stringify(progress)),
    signerForRole: async role => (await import("./testnet-wallets.mjs")).loadTestnetOperatorAccount(role) });
  if (action === "inspect-source") {
    const deployment = result.receipts?.find(receipt => receipt.id === "deploy");
    console.log(JSON.stringify(deployment ? await observeCanaryExplorerSource(pack,
      { ...execution.spec, deploymentNonce: 0n, deploymentTransactionHash: deployment.transactionHash }, client)
      : { status: "awaiting-verified-deployment", chainId: 10143, executionStatus: result.status }, null, 2));
  } else console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(() => {
  console.error("Contract canary stopped. No replacement transaction was authorized. Preserve the private journal; inspect the exact saved hash, chain state and any live process before retrying. Signing/provider errors are not logged.");
  process.exitCode = 1;
});
