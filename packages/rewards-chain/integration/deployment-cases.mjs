import assert from "node:assert/strict";
import { getAddress, getContractAddress, keccak256, serializeTransaction } from "viem";
import { encodeRewardDeployment, readVerifiedRewardDeployment, requireRewardBuildArtifact, rewardCampaignBuild, RewardProtocolError, verifyRewardDeployment, verifyRewardRuntime } from "../dist/index.js";
import { h, proposalFor } from "../test/fixtures.mjs";
import { canonicalRewardJson, verifySignedRewardDeployment } from "../dist/index.js";
import { recordSignedRewardDeployment, loadVerifiedRewardDeploymentAttempt } from "../../../apps/api/dist/features/rewards/deployment-service.js";

const rejectsCode = (code) => (error) => error instanceof RewardProtocolError && error.code === code;
const mutateByte = (code, byte) => {
  const i = 2 + byte * 2;
  return `${code.slice(0, i)}${code.slice(i, i + 2) === "00" ? "01" : "00"}${code.slice(i + 2)}`;
};

// Called only by the owned Anvil harness. All addresses/results are synthetic.
export async function deploymentCases({ t, artifact, publicClient, testClient, operatorClient, operator, relayer, treasury, receipt }) {
  requireRewardBuildArtifact(artifact);
  const proposal = proposalFor();
  const nonce = BigInt(await publicClient.getTransactionCount({ address: operator.address }));
  const address = getContractAddress({ from: operator.address, nonce });
  const spec = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: address },
    operatorAddress: operator.address, treasuryAddress: treasury, programmeId: proposal.programmeId, campaignId: proposal.campaignId,
    programmeManifestHash: proposal.programmeManifestHash, enabledPot: proposal.enabledPot };
  const creationCode = artifact.bytecode.object;
  const txReceipt = await receipt(await operatorClient.sendTransaction({ data: encodeRewardDeployment(spec, creationCode) }));
  assert.equal(getAddress(txReceipt.contractAddress), address);
  const expected = { ...spec, deploymentNonce: nonce, deploymentTransactionHash: txReceipt.transactionHash };
  await testClient.mine({ blocks: 96, interval: 1 });
  const finalized = await publicClient.getBlock({ blockTag: "finalized" });
  assert(finalized.number > txReceipt.blockNumber, "Adversarial cases require distinct deployment and finalized checkpoint blocks");
  const observation = { observedChainId: await publicClient.getChainId(), transaction: await publicClient.getTransaction({ hash: txReceipt.transactionHash }),
    receipt: txReceipt, canonicalDeploymentBlockHash: (await publicClient.getBlock({ blockNumber: txReceipt.blockNumber })).hash,
    finalizedBlock: { number: finalized.number, hash: finalized.hash, timestamp: finalized.timestamp },
    runtimeCode: await publicClient.getCode({ address, blockNumber: finalized.number }) };
  const verify = (observed = observation, input = expected) => verifyRewardDeployment(input, creationCode, observed);

  const plan = { network: { environment: "local-simulation", chainId: 31337 }, nonce, operatorAddress: operator.address,
    treasuryAddress: treasury, programmeId: proposal.programmeId, campaignId: proposal.campaignId,
    programmeManifestHash: proposal.programmeManifestHash, enabledPot: proposal.enabledPot };
  const signingInput = { type: "eip1559", chainId: 31337, nonce: Number(nonce), gas: 5000000n, maxFeePerGas: 10000000000n,
    maxPriorityFeePerGas: 100000000n, value: 0n, data: encodeRewardDeployment(spec, creationCode) };
  const signed = await operator.signTransaction(signingInput);

  await t.test("operator-signed deployment bytes bind exact frozen creation parameters and allow fee replacements only", async () => {
    const verified = await verifySignedRewardDeployment(plan, signed);
    assert.equal(verified.transactionHash, keccak256(signed)); assert.equal(verified.nonce, nonce);
    assert.equal(verified.operatorAddress, operator.address.toLowerCase()); assert.equal(verified.contractAddress, address.toLowerCase());
    assert.equal(verified.calldataHash, keccak256(signingInput.data)); assert.equal(verified.signedTransaction, signed);
    const replacement = await verifySignedRewardDeployment(plan, await operator.signTransaction({ ...signingInput, maxFeePerGas: 20000000000n }));
    assert.notEqual(replacement.transactionHash, verified.transactionHash); assert.equal(replacement.calldataHash, verified.calldataHash);
    assert.equal(replacement.nonce, nonce); assert.equal(replacement.contractAddress, verified.contractAddress);
    await assert.rejects(verifySignedRewardDeployment(plan, serializeTransaction(signingInput)), rejectsCode("reward_unsigned_deployment"));
    await assert.rejects(verifySignedRewardDeployment(plan, await relayer.signTransaction(signingInput)), rejectsCode("reward_deployment_sender_mismatch"));
    for (const [change, code] of [
      [{ chainId: 143 }, "reward_deployment_transaction_chain_mismatch"],
      [{ nonce: Number(nonce) + 1 }, "reward_deployment_nonce_mismatch"],
      [{ to: treasury }, "reward_not_direct_deployment"],
      [{ value: 1n }, "reward_not_direct_deployment"],
      [{ accessList: [{ address: treasury, storageKeys: [] }] }, "reward_not_direct_deployment"],
      [{ data: "0x" }, "reward_deployment_input_mismatch"],
      [{ data: mutateByte(signingInput.data, 0) }, "reward_creation_code_mismatch"],
      [{ data: encodeRewardDeployment({ ...spec, campaignId: h("wrong campaign") }, creationCode) }, "reward_deployment_input_mismatch"],
      [{ data: encodeRewardDeployment({ ...spec, treasuryAddress: relayer.address }, creationCode) }, "reward_deployment_input_mismatch"],
      [{ gas: 0n }, "invalid_reward_deployment_fees"],
    ]) await assert.rejects(verifySignedRewardDeployment(plan, await operator.signTransaction({ ...signingInput, ...change })), rejectsCode(code), code);
  });

  await t.test("API stores validated signed attempts, returns metadata only and revalidates private worker reads", async () => {
    const id = (n) => `79000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const session = { account: { userId: id(1) } };
    const input = { campaignId:id(2),intentId:id(3),idempotencyKey:"real-signed-attempt",signedTransaction:signed };
    const context = { schemaVersion:1,programmeId:id(4),campaignId:id(2),chainId:31337,environment:"local_simulation",
      operatorAddress:operator.address.toLowerCase(),treasuryAddress:treasury.toLowerCase(),programmeOnChainId:proposal.programmeId,
      campaignOnChainId:proposal.campaignId,manifestHash:proposal.programmeManifestHash,pot:"race",budgetWei:"12000000000000000000",
      intent:{id:id(3),nonce:nonce.toString(),buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,
        createdByUserId:id(1),createdAt:"2026-09-08T01:00:00Z",idempotencyKey:"synthetic-plan"} };
    let stored; let writes=0; let corrupt=false;
    const rpc=async(name,args)=>{
      assert.equal(args.p_campaign_id,id(2)); assert.equal(args.p_actor_user_id,id(1)); assert.equal(args.p_intent_id,id(3));
      if(name==="service_read_reward_deployment_context") return {data:structuredClone(context),error:null};
      if(name==="service_record_reward_deployment_attempt") {
        writes++; stored=structuredClone(args.p_attempt);
        return {data:{attemptId:id(5),intentId:id(3),campaignId:id(2),recordedByUserId:id(1),recordedAt:"2026-09-08T01:00:01Z",transactionHash:stored.transactionHash},error:null};
      }
      if(name==="service_read_reward_deployment_attempt") {
        assert.equal(args.p_attempt_id,id(5)); const body=structuredClone(stored); if(corrupt) body.calldataHash=h("corrupt stored witness");
        return {data:{context:structuredClone(context),attempt:{id:id(5),intentId:id(3),body,recordedByUserId:id(1),recordedAt:"2026-09-08T01:00:01Z",idempotencyKey:input.idempotencyKey}},error:null};
      }
      assert.fail(`Unexpected signed-attempt RPC ${name}`);
    };
    const result=await recordSignedRewardDeployment(session,input,rpc);
    assert.equal(writes,1); assert.equal(result.transactionHash,keccak256(signed));
    assert.doesNotMatch(JSON.stringify(result),/signedTransaction|privateKey|calldata/);
    const loaded=await loadVerifiedRewardDeploymentAttempt(session,{campaignId:id(2),intentId:id(3),attemptId:id(5)},rpc);
    assert.equal(loaded.verified.signedTransaction,signed); assert.equal(canonicalRewardJson(loaded.verified),canonicalRewardJson(stored));
    corrupt=true;
    await assert.rejects(loadVerifiedRewardDeploymentAttempt(session,{campaignId:id(2),intentId:id(3),attemptId:id(5)},rpc),error=>error.code==="reward_stored_deployment_attempt_mismatch");
    await assert.rejects(recordSignedRewardDeployment(session,{...input,signedTransaction:await relayer.signTransaction(signingInput)},rpc),rejectsCode("reward_deployment_sender_mismatch"));
    assert.equal(writes,1);
  });

  await t.test("compiled creation, immutable layout and every runtime word match the reviewed build", () => {
    assert.equal(requireRewardBuildArtifact(artifact), undefined);
    assert.equal(verifyRewardRuntime(spec, observation.runtimeCode), keccak256(observation.runtimeCode));
    const declarations = artifact.ast.nodes.filter((node) => node.nodeType === "ContractDefinition")
      .flatMap((node) => node.nodes).filter((node) => node.nodeType === "VariableDeclaration" && node.mutability === "immutable");
    assert.deepEqual(declarations.map((node) => node.name), ["operator", "treasury", "programmeId", "campaignId", "programmeManifestHash", "enabledPot"]);
    for (const node of declarations) assert(artifact.deployedBytecode.immutableReferences[node.id]?.length > 0);
    for (const refs of Object.values(artifact.deployedBytecode.immutableReferences)) {
      for (const { start } of refs) assert.throws(() => verifyRewardRuntime(spec, mutateByte(observation.runtimeCode, start)), rejectsCode("reward_runtime_immutable_mismatch"));
    }
    for (const offset of [0, 15, rewardCampaignBuild.runtimeBytes - 1]) {
      assert.throws(() => verifyRewardRuntime(spec, mutateByte(observation.runtimeCode, offset)), rejectsCode("reward_runtime_code_mismatch"));
    }
    assert.throws(() => verifyRewardRuntime(spec, `${observation.runtimeCode}00`), rejectsCode("reward_runtime_code_mismatch"));
    for (const field of ["programmeId", "campaignId", "programmeManifestHash"]) assert.throws(() => verifyRewardRuntime({ ...spec, [field]: h("different") }, observation.runtimeCode), rejectsCode("reward_runtime_immutable_mismatch"));
    for (const field of ["operatorAddress", "treasuryAddress"]) assert.throws(() => verifyRewardRuntime({ ...spec, [field]: address }, observation.runtimeCode), rejectsCode("reward_runtime_immutable_mismatch"));
    assert.throws(() => verifyRewardRuntime({ ...spec, enabledPot: 1 }, observation.runtimeCode), rejectsCode("reward_runtime_immutable_mismatch"));
    assert.throws(() => verifyRewardRuntime({ ...spec, context: { ...spec.context, environment: "monad-testnet", chainId: 10143 } }, observation.runtimeCode), rejectsCode("reward_runtime_immutable_mismatch"));
  });

  await t.test("artifact substitution, link references and compiler layout drift are rejected", () => {
    for (const [change, code] of [
      [(a) => { a.bytecode.object = mutateByte(a.bytecode.object, 0); }, "reward_creation_code_mismatch"],
      [(a) => { a.deployedBytecode.object = mutateByte(a.deployedBytecode.object, 0); }, "reward_runtime_template_mismatch"],
      [(a) => { a.bytecode.linkReferences = { library: {} }; }, "reward_unexpected_link_references"],
      [(a) => { a.deployedBytecode.linkReferences = { library: {} }; }, "reward_unexpected_link_references"],
      [(a) => { Object.values(a.deployedBytecode.immutableReferences)[0][0].length = 31; }, "reward_immutable_layout_mismatch"],
      [(a) => { Object.values(a.deployedBytecode.immutableReferences)[0][0].start++; }, "reward_immutable_layout_mismatch"],
      [(a) => { delete a.deployedBytecode.immutableReferences[Object.keys(a.deployedBytecode.immutableReferences)[0]]; }, "reward_immutable_layout_mismatch"],
    ]) {
      const copy = structuredClone(artifact); change(copy);
      assert.throws(() => requireRewardBuildArtifact(copy), rejectsCode(code));
    }
  });

  await t.test("direct deployment provenance is bound to nonce, constructor, operator, receipt and canonical finality", () => {
    const result = verify();
    assert.equal(result.buildId, rewardCampaignBuild.id);
    assert.equal(result.deploymentTransactionHash, txReceipt.transactionHash);
    assert.equal(result.runtimeCodeHash, keccak256(observation.runtimeCode));
    assert.deepEqual(result.finalizedBlock, observation.finalizedBlock);
    for (const [change, code] of [
      [(o) => { o.observedChainId = 143; }, "reward_observed_chain_mismatch"],
      [(o) => { o.transaction.chainId = 10143; }, "reward_deployment_transaction_chain_mismatch"],
      [(o) => { delete o.transaction.chainId; }, "reward_deployment_transaction_chain_mismatch"],
      [(o) => { o.receipt.status = "reverted"; }, "reward_deployment_reverted"],
      [(o) => { o.transaction.hash = h("other tx"); }, "reward_deployment_transaction_mismatch"],
      [(o) => { o.receipt.transactionHash = h("other tx"); }, "reward_deployment_transaction_mismatch"],
      [(o) => { o.transaction.to = address; }, "reward_not_direct_deployment"],
      [(o) => { o.receipt.to = address; }, "reward_not_direct_deployment"],
      [(o) => { o.transaction.value = 1n; }, "reward_not_direct_deployment"],
      [(o) => { o.transaction.from = address; }, "reward_deployment_sender_mismatch"],
      [(o) => { o.receipt.from = address; }, "reward_deployment_sender_mismatch"],
      [(o) => { o.transaction.nonce++; }, "reward_deployment_nonce_mismatch"],
      [(o) => { o.transaction.nonce = Number.MAX_SAFE_INTEGER + 1; }, "reward_deployment_nonce_mismatch"],
      [(o) => { o.receipt.contractAddress = treasury; }, "reward_deployment_address_mismatch"],
      [(o) => { o.receipt.contractAddress = null; }, "reward_deployment_address_mismatch"],
      [(o) => { o.transaction.input = `${o.transaction.input}00`; }, "reward_deployment_input_mismatch"],
      [(o) => { o.transaction.input = encodeRewardDeployment({ ...spec, campaignId: h("wrong campaign") }, creationCode); }, "reward_deployment_input_mismatch"],
      [(o) => { o.transaction.blockNumber++; }, "reward_deployment_receipt_mismatch"],
      [(o) => { o.transaction.blockHash = null; }, "reward_deployment_receipt_mismatch"],
      [(o) => { o.transaction.transactionIndex++; }, "reward_deployment_receipt_mismatch"],
      [(o) => { o.receipt.transactionIndex = -1; }, "reward_deployment_receipt_mismatch"],
      [(o) => { o.canonicalDeploymentBlockHash = h("reorg"); }, "reward_deployment_not_canonical"],
      [(o) => { o.finalizedBlock.number = o.receipt.blockNumber - 1n; }, "reward_deployment_not_finalized"],
      [(o) => { o.finalizedBlock.number = o.receipt.blockNumber; }, "reward_deployment_not_canonical"],
    ]) {
      const copy = structuredClone(observation); change(copy);
      assert.throws(() => verify(copy), rejectsCode(code), code);
    }
  });

  await t.test("worker reader pins code reads to one finalized block and copies input before asynchronous IO", async () => {
    const reads = [];
    const input = structuredClone(expected);
    let chainCalls = 0;
    const reader = { ...publicClient,
      async getChainId() { chainCalls++; input.context.chainId = 143; input.campaignId = h("mutated"); input.deploymentTransactionHash = h("mutated"); return publicClient.getChainId(); },
      async getCode(args) { reads.push(args); return publicClient.getCode(args); },
    };
    const result = await readVerifiedRewardDeployment(reader, input, creationCode);
    assert.equal(chainCalls, 2);
    assert.deepEqual(result, verify());
    assert.deepEqual(reads, [{ address, blockNumber: finalized.number }]);
  });

  await t.test("worker reader rejects wrong network, missing code, unfinalized deployment and RPC failure without fallback", async () => {
    let furtherReads = 0;
    await assert.rejects(readVerifiedRewardDeployment({ ...publicClient, getChainId: async () => 143,
      getBlock() { furtherReads++; throw new Error("must not read"); } }, expected, creationCode), rejectsCode("reward_observed_chain_mismatch"));
    assert.equal(furtherReads, 0);
    for (const runtimeCode of [undefined, "0x"]) await assert.rejects(readVerifiedRewardDeployment({ ...publicClient, getCode: async () => runtimeCode }, expected, creationCode),
      rejectsCode(runtimeCode === undefined ? "reward_deployment_code_missing" : "invalid_reward_bytecode"));
    let finalizedReads = 0;
    await assert.rejects(readVerifiedRewardDeployment({ ...publicClient, getBlock(args) { finalizedReads++; assert.equal(args.blockTag, "finalized"); throw new Error("synthetic credential-bearing RPC error"); } }, expected, creationCode),
      (error) => rejectsCode("reward_deployment_observation_unavailable")(error) && error.cause === undefined && !error.stack.includes("credential-bearing"));
    assert.equal(finalizedReads, 1);
    await assert.rejects(readVerifiedRewardDeployment({ ...publicClient, getBlock: async () => ({ number: null, hash: null }) }, expected, creationCode), rejectsCode("reward_finalized_block_missing"));
    await assert.rejects(readVerifiedRewardDeployment({ ...publicClient,
      getBlock(args) { return args.blockTag === "finalized" ? { ...finalized, number: txReceipt.blockNumber - 1n } : publicClient.getBlock(args); },
    }, expected, creationCode), rejectsCode("reward_deployment_not_finalized"));
  });

  await t.test("worker reader rejects network drift, regressed finality and changing canonical block identities", async () => {
    let chainCalls = 0;
    await assert.rejects(readVerifiedRewardDeployment({ ...publicClient, async getChainId() { return ++chainCalls === 1 ? 31337 : 10143; } }, expected, creationCode), rejectsCode("reward_observed_chain_mismatch"));
    for (const variant of ["regression", "finalized hash", "checkpoint hash", "checkpoint time", "deployment hash"]) {
      const counts = new Map();
      const reader = { ...publicClient, async getBlock(args) {
        const key = args.blockTag || String(args.blockNumber); counts.set(key, (counts.get(key) || 0) + 1);
        const block = await publicClient.getBlock(args);
        if (variant === "regression" && key === "finalized" && counts.get(key) === 2) return { ...block, number: block.number - 1n };
        if (variant === "finalized hash" && key === "finalized" && counts.get(key) === 2) return { ...block, hash: h("drift") };
        if (variant === "checkpoint hash" && args.blockNumber === finalized.number) return { ...block, hash: h("drift") };
        if (variant === "checkpoint time" && args.blockNumber === finalized.number) return { ...block, timestamp: block.timestamp + 1n };
        if (variant === "deployment hash" && args.blockNumber === txReceipt.blockNumber && counts.get(key) === 2) return { ...block, hash: h("drift") };
        return block;
      } };
      await assert.rejects(readVerifiedRewardDeployment(reader, expected, creationCode), rejectsCode(variant === "regression" ? "reward_finality_regressed" : "reward_chain_changed_during_observation"), variant);
    }
  });
}
