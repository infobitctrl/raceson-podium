import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, parseEther, stringToHex, zeroAddress } from "viem";
import { createRewardAllocationRehearsalV3 } from "../../domain/dist/rewards/allocation-rehearsal-v3.js";
import { previewRewardAllocationV3 } from "../../domain/dist/rewards/allocation-preview-v3.js";
import { canonicalRewardJson } from "../dist/canonical.js";
import { rewardCampaignV3Abi as abi, rewardAllocationCommitmentV3, rewardClaimMessagesV3, encodeRewardClaimV3, verifyRewardClaimEoaProofV3 } from "../dist/campaign-v3.js";
import { rewardClaimMessages } from "../dist/claims.js";
import { readVerifiedRewardProgrammeV3 } from "../dist/programme-v3.js";
import { readVerifiedRewardProgrammeAthleteClaimV3 } from "../dist/claim-reader-v3.js";
import { encodeRewardProgrammeLifecycleV3, verifySignedRewardProgrammeLifecycleV3,
  readRewardProgrammeLifecyclePrestateV3, readVerifiedRewardProgrammeLifecycleV3 } from "../dist/programme-lifecycle-v3.js";
import { publicPackage, lifecycleFees } from "../test/programme-lifecycle-fixture-v3.mjs";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";
import { programmeClubPaymentCasesV3 } from "./programme-club-payment-cases-v3.mjs";

// This entry point can only start its own fresh, non-forked, loopback simulator.
// No supplied endpoint, wallet, imported athlete, Auth or production DB is read.
// Synthetic consent below is NEVER exported or usable on public chain 10143.
const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
const hash = value => keccak256(stringToHex(typeof value === "string" ? value : canonicalRewardJson(value)));
const funder = fixtureSigner(0xCC001);

test("100 local MON: calculated 20-athlete rounds → V3 escrows → consented payouts and retained shares", { timeout: 240000 }, async t => {
  const chain = await startOwnedRewardChain({ retainLifecycleHistory: true });
  try {
    const c = chain.publicClient, budget = parseEther("100"), records = [], expectedBalances = new Map();
    const fixture = scenario => createRewardAllocationRehearsalV3(scenario, "compact_20");
    const full = fixture("five_rounds"), four = fixture("four_rounds");
    const preview = f => previewRewardAllocationV3(f.rules, f.mapping, f.source);
    const all = preview(full), waveOne = preview(four);
    assert.equal(await c.getChainId(), 31337); assert.equal(all.payableWei, 0n);
    assert.equal(all.budgetWei, budget); assert.equal(waveOne.league.proposedWei, 0n);
    assert.equal(full.source.rounds.flatMap(r => r.results).length, 100);
    const people = full.source.rounds[0].results;
    const minors = new Set(people.filter(p => full.source.categories.slice(0, 2).some(c => c.id === p.categoryId)).map(p => p.athleteId));
    const walletless = people.find(p => p.categoryId === full.source.categories[2].id).athleteId;
    const ageUnknown = people.find(p => p.categoryId === full.source.categories[3].id).athleteId;
    const held = new Set([...minors, walletless, ageUnknown]);
    // Local-only synthetic adult-control decisions, not an inference from a
    // public category or an implementation of real account/age verification.
    const signers = new Map(people.filter(p => !held.has(p.athleteId)).map((p, i) => [p.athleteId, fixtureSigner(0xCC100 + i)]));
    assert.equal(signers.size, 14); assert.equal(held.size, 6);
    const safe = await deployOriginalClubSafeFixture(chain), clubId = people[0].clubId;
    const finalize = async () => chain.testClient.mine({ blocks: 96, interval: 1 });
    async function receipt(pending) {
      const r = await c.waitForTransactionReceipt({ hash: await pending, timeout: 10000 });
      assert.equal(r.status, "success"); await finalize();
      assert.ok((await c.getBlock({ blockTag: "finalized" })).number >= r.blockNumber);
      assert.equal((await c.getBlock({ blockNumber: r.blockNumber })).hash, r.blockHash);
      return r;
    }
    await chain.testClient.setBalance({ address: funder.address, value: budget + parseEther("10") });
    const nonce = BigInt(await c.getTransactionCount({ address: chain.operator.address }));
    // The runner explicitly approves ONLY this synthetic, zero-window local
    // experiment. Imported results, announced review clocks and public trials
    // never enter this path. Full rules/source stay bound to this manifest.
    const programmeId = hash("compact-20-local-programme-v3"), manifest = hash({ kind: "local-synthetic-only", rules: full.rules, source: full.source });
    const campaignIds = [1, 2, 3, 4, 5, "league"].map(slot => hash(`${programmeId}:${slot}`));
    const input = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object,
      args: [funder.address, chain.operator.address, programmeId, manifest, budget, campaignIds, Array(6).fill(0n)] });
    const deployment = await receipt(chain.operatorClient.sendTransaction({ data: input }));
    const address = getAddress(deployment.contractAddress);
    assert.equal(address, getContractAddress({ from: chain.operator.address, nonce }));
    const spec = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: address },
      funderAddress: funder.address, operatorAddress: chain.operator.address, programmeId, programmeManifestHash: manifest,
      budgetWei: budget, campaignIds, reviewPeriods: Array(6).fill(0n), deploymentTransactionHash: deployment.transactionHash, deploymentNonce: nonce };
    const parent = (name, args = [], options = {}) => receipt(chain.operatorClient.writeContract({ address, abi: artifact.abi, functionName: name, args, ...options }));
    await parent("deposit", [0n], { account: funder, value: budget });
    const children = Array.from({ length: 6 }, (_, slot) => ({ context: { ...spec.context, verifyingContract: getContractAddress({ from: address, nonce: BigInt(slot + 1) }) },
      programmeId, programmeManifestHash: manifest, campaignId: campaignIds[slot], operatorAddress: chain.operator.address,
      treasuryAddress: address, enabledPot: slot === 5 ? 1 : 0, reviewPeriod: 0n }));
    const read = (f, name, args = []) => c.readContract({ address: f.context.verifyingContract, abi, functionName: name, args });
    const write = (f, name, args = []) => receipt(chain.operatorClient.writeContract({ address: f.context.verifyingContract, abi, functionName: name, args }));
    const uploads = new Map(), plans = new Map(), stages = new Map(), lifecycleAttempts = [];
    async function executeLifecycle(slot, upload, action, extra = {}) {
      const p = { protocolVersion: 3, programme: spec, slot, upload, action, ...extra, fees: { ...lifecycleFees },
        nonce: BigInt(await c.getTransactionCount({ address: chain.operator.address })) };
      const before = await readRewardProgrammeLifecyclePrestateV3(c, p);
      assert.equal(before.provenance.kind, "programme-child");
      const serialized = await chain.operator.signTransaction({ ...encodeRewardProgrammeLifecycleV3(p), type: "eip1559",
        gas: lifecycleFees.gasLimit, maxFeePerGas: lifecycleFees.maxFeePerGas, maxPriorityFeePerGas: lifecycleFees.maxPriorityFeePerGas });
      const signed = await verifySignedRewardProgrammeLifecycleV3(p, serialized);
      const r = await receipt(chain.operatorClient.sendRawTransaction({ serializedTransaction: signed.signedTransaction }));
      const proof = await readVerifiedRewardProgrammeLifecycleV3(c, p, serialized);
      assert.equal(proof.transactionHash, r.transactionHash); assert.equal(proof.blockHash, r.blockHash);
      assert.equal(proof.provenance.slot, slot); assert.equal(proof.accountingAtReceiptBlock.paid[children[slot].enabledPot], 0n);
      assert.ok(proof.feeWei <= lifecycleFees.maxGasCostWei);
      assert.ok(!("signedTransaction" in proof));
      lifecycleAttempts.push({ plan: p, serialized, proof }); // In-memory test-only; never log signed payloads.
      await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, p), error =>
        ["reward_lifecycle_state_mismatch", "reward_lifecycle_prefix_mismatch"].includes(error.code));
      return r;
    }
    function rowsFor(slot, calculated) {
      const pot = slot === 5 ? calculated.league : calculated.rounds[slot];
      const recipients = new Map();
      const add = (id, kind, amountWei, explanation) => {
        if (!amountWei) return;
        const key = `${kind}:${id}`, row = recipients.get(key) ?? { id, kind, amount: 0n, explanations: [] };
        row.amount += amountWei; row.explanations.push(explanation); recipients.set(key, row);
      };
      for (const family of pot.families) for (const category of family.categories) {
        assert.equal(category.hold, null);
        for (const award of category.awards) add(award.beneficiaryId, category.target === "club" ? 1 : 0, award.amountWei,
          { family: family.key, categoryId: category.categoryId, ...award });
      }
      if (slot === 5) {
        assert.equal(pot.participation.hold, null);
        for (const award of pot.participation.awards) add(award.beneficiaryId, 0, award.amountWei, { family: "participation_metres", ...award });
      }
      const rows = [...recipients.values()].map(row => ({ ...row, award: { entitlementId: hash(`${campaignIds[slot]}:${row.kind}:${row.id}`),
        beneficiaryId: hash(`${programmeId}:${row.kind}:${row.id}`), amount: row.amount, beneficiaryKind: row.kind,
        pot: children[slot].enabledPot, explanationHash: hash(row.explanations) } }));
      assert.equal(rows.reduce((sum, r) => sum + r.amount, 0n), pot.proposedWei);
      return rows;
    }
    async function activate(slot, calculated) {
      const f = children[slot], pot = slot === 5 ? calculated.league : calculated.rounds[slot];
      await parent("routePot", [slot]);
      const rows = rowsFor(slot, calculated), block = await c.getBlock({ blockTag: "finalized" });
      const u = rewardAllocationCommitmentV3({ ...f, budget: pot.budgetWei, snapshotDigest: hash({ manifest, slot, pot }),
        awards: rows.map(r => r.award).sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0), reviewStartedAt: block.timestamp, officialPublishedAt: block.timestamp,
        publicationEvidenceHash: hash({ syntheticApproval: true, manifest, slot, block: block.hash }) });
      plans.set(slot, rows); uploads.set(slot, u);
      const upload = publicPackage(spec, slot, u.awards, u.snapshotDigest);
      await executeLifecycle(slot, upload, "complete_funding");
      await executeLifecycle(slot, upload, "upload_awards", { batchStart: 0, batchSize: u.awards.length });
      const publication = { reviewPeriod: u.reviewPeriod, reviewStartedAt: u.reviewStartedAt,
        officialPublishedAt: u.officialPublishedAt, publicationEvidenceHash: u.publicationEvidenceHash };
      const stage = await executeLifecycle(slot, upload, "stage_allocation", { publication });
      stages.set(slot, stage.transactionHash);
      assert.equal(await read(f, "allocationDigest"), u.allocationDigest);
      await executeLifecycle(slot, upload, "activate", { publication });
    }
    async function checkProgrammeClaimBoundary(expected, witness) {
      const target = witness.campaign.context.verifyingContract;
      const observe = client => readVerifiedRewardProgrammeAthleteClaimV3(client, expected);
      await t.test("programme claim reads parent, children, award and review at one finalized block", async () => {
        const blocks = [];
        const observed = await observe({ ...c,
          readContract: args => { blocks.push(args.blockNumber); return c.readContract(args); },
          getBalance: args => { blocks.push(args.blockNumber); return c.getBalance(args); },
          getCode: args => { blocks.push(args.blockNumber); return c.getCode(args); },
        });
        assert.ok(blocks.length > 100);
        assert.ok(blocks.every(b => b === observed.observation.finalizedBlock.number));
        assert.deepEqual(observed, witness);
      });
      await t.test("programme claim captures mutable caller input before provider IO", async () => {
        const input = structuredClone(expected); let changed = false;
        const observed = await readVerifiedRewardProgrammeAthleteClaimV3({ ...c, getChainId: async () => {
          if (!changed) { changed = true; input.programme.campaignIds[0] = hash("changed");
            input.programme.context.chainId = 143; input.upload.awards[0].amount++;
            input.slot = 5; input.recipient = funder.address; input.stageTransactionHash = hash("changed"); }
          return c.getChainId();
        } }, input);
        assert.deepEqual(observed, witness);
      });
      await t.test("wrong parent/child runtime and damaged factory provenance fail closed", async () => {
        for (const targetAddress of [address, target, children[4].context.verifyingContract]) {
          await assert.rejects(observe({ ...c, getCode: args => args.address === targetAddress
            ? Promise.resolve("0x6000") : c.getCode(args) }));
        }
        await assert.rejects(observe({ ...c, getTransactionReceipt: async args => {
          const receipt = structuredClone(await c.getTransactionReceipt(args));
          if (args.hash === spec.deploymentTransactionHash) receipt.logs.pop(); return receipt;
        } }), { code: "invalid_reward_programme_v3" });
      });
      await t.test("programme child rejects missing approval event and another pot's staging destination", async () => {
        await assert.rejects(observe({ ...c, getTransactionReceipt: async args => {
          const receipt = structuredClone(await c.getTransactionReceipt(args));
          if (args.hash === expected.stageTransactionHash) receipt.logs.pop(); return receipt;
        } }), { code: "reward_claim_stage_event_mismatch" });
        await assert.rejects(observe({ ...c, getTransaction: async args => {
          const tx = await c.getTransaction(args);
          return args.hash === expected.stageTransactionHash ? { ...tx, to: children[1].context.verifyingContract } : tx;
        } }), { code: "reward_claim_stage_transaction_mismatch" });
      });
      await t.test("programme claim rejects changed allocation, review evidence, EOA delegation and paid flag", async () => {
        for (const [name, change, code] of [
          ["snapshotDigest", () => hash("wrong"), "reward_claim_package_mismatch"],
          ["publicationEvidenceHash", () => hash("wrong"), "reward_claim_publication_mismatch"],
          ["PROTOCOL_VERSION", () => 2n, "wrong_reward_review_protocol"],
          ["entitlements", row => row.map((v, i) => i === 6 ? true : v), "reward_claim_already_paid"],
        ]) await assert.rejects(observe({ ...c, readContract: async args => {
          const value = await c.readContract(args);
          return args.address === target && args.functionName === name ? change(value) : value;
        } }), { code });
        await assert.rejects(observe({ ...c, getCode: args => args.address === expected.recipient
          ? Promise.resolve("0xef0100" + "11".repeat(20)) : c.getCode(args) }), { code: "reward_claim_eoa_recipient_required" });
      });
      await t.test("programme claim detects reorg or network drift after its parent verification", async () => {
        for (const drift of ["chain", "finality", "deployment", "stage"]) {
          let claimRead = false;
          await assert.rejects(observe({ ...c, readContract: args => {
            if (args.functionName === "entitlements") claimRead = true; return c.readContract(args);
          }, getChainId: () => claimRead && drift === "chain" ? Promise.resolve(143) : c.getChainId(),
          getBlock: async args => {
            const b = await c.getBlock(args); if (!claimRead) return b;
            if (drift === "finality" && args.blockTag === "finalized") return { ...b, timestamp: 0n };
            if (drift === "deployment" && args.blockNumber === witness.provenance.deploymentBlockNumber) return { ...b, hash: hash("reorg") };
            if (drift === "stage" && args.blockNumber === witness.observation.review.stageBlockNumber) return { ...b, hash: hash("reorg") };
            return b;
          } }));
        }
      });
      await t.test("actual child pause blocks programme claims; resuming preserves allocation and nonce", async () => {
        await write(children[expected.slot], "pause");
        await assert.rejects(observe(c), { code: "reward_claim_campaign_unavailable" });
        await write(children[expected.slot], "resume");
        const resumed = await observe(c);
        assert.equal(resumed.award.nonce, witness.award.nonce);
        assert.equal(resumed.observation.accounting.allocationDigest, witness.observation.accounting.allocationDigest);
        assert.ok(resumed.observation.accounting.claimDeadline >= witness.observation.accounting.claimDeadline);
      });
    }
    let previousClaimData;
    const clubPayments = [];
    async function pay(slot) {
      const f = children[slot], u = uploads.get(slot);
      for (const row of plans.get(slot)) {
        const signer = row.kind === 0 ? signers.get(row.id) : null;
        if (!signer && !(row.kind === 1 && row.id === clubId)) continue;
        const recipient = signer?.address ?? safe.expected.context.verifyingContract;
        const expectation = { protocolVersion: 3, programme: spec, slot, upload: u,
          stageTransactionHash: stages.get(slot), entitlementId: row.award.entitlementId, recipient };
        if (!signer) {
          const club = await programmeClubPaymentCasesV3({ chain, expectation, safe, adversarial: slot === 0, t });
          const p = club.result.payment;
          expectedBalances.set(recipient, (expectedBalances.get(recipient) ?? 0n) + row.amount);
          records.push({ slot: slot === 5 ? "league" : slot + 1, kind: "club", beneficiaryId: row.id,
            recipient, amountWei: row.amount.toString(), transactionHash: p.transactionHash,
            blockNumber: p.blockNumber.toString(), blockHash: p.blockHash });
          clubPayments.push(club); previousClaimData = club.data;
          continue;
        }
        let witness = await readVerifiedRewardProgrammeAthleteClaimV3(c, expectation);
        if (witness) {
          assert.equal(witness.provenance.kind, "programme-child");
          assert.equal(witness.provenance.slot, slot);
          assert.equal(witness.campaign.context.verifyingContract, f.context.verifyingContract);
          assert.equal(witness.observation.accounting.allocationDigest, u.allocationDigest);
          assert.equal(witness.award.amount, row.amount); assert.equal(witness.award.paid, false);
          assert.equal(witness.recipient, recipient.toLowerCase());
          if (!records.length) {
            await checkProgrammeClaimBoundary(expectation, witness);
            witness = await readVerifiedRewardProgrammeAthleteClaimV3(c, expectation);
          }
        }
        const now = witness?.observation.finalizedBlock.timestamp ?? (await c.getBlock({ blockTag: "finalized" })).timestamp;
        const claim = { entitlementId: row.award.entitlementId, recipient, amount: row.amount, pot: slot === 5 ? "league" : "race",
          nonce: witness?.award.nonce ?? 0n, issuedAt: now, expiresAt: now + 3600n, allocationDigest: u.allocationDigest };
        const messages = rewardClaimMessagesV3(f.context, claim);
        const consent = await signer.signTypedData(messages.consent);
        await verifyRewardClaimEoaProofV3(f.context, claim, "recipient", chain.operator.address, consent);
        const operator = await chain.operator.signTypedData(messages.authorization);
        await verifyRewardClaimEoaProofV3(f.context, claim, "operator", chain.operator.address, operator);
        const data = encodeRewardClaimV3(f.context, claim, { operator, recipient: consent });
        if (!records.length) {
          const old = await chain.operator.signTypedData(rewardClaimMessages(f.context, claim).authorization);
          await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract,
            data: encodeRewardClaimV3(f.context, claim, { operator: old, recipient: consent }) }));
          await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract,
            data: encodeRewardClaimV3(f.context, { ...claim, recipient: funder.address }, { operator, recipient: consent }) }));
        }
        if (previousClaimData && slot > 0) await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract, data: previousClaimData }));
        const before = await c.getBalance({ address: recipient });
        const request = await chain.relayerClient.prepareTransactionRequest({ to: f.context.verifyingContract, data });
        const signed = await chain.relayerClient.signTransaction(request), transactionHash = keccak256(signed);
        if (!records.length) await assert.rejects(async () => {
          await c.sendRawTransaction({ serializedTransaction: signed });
          throw new Error("synthetic_lost_send_response");
        }, /synthetic_lost_send_response/);
        else assert.equal(await c.sendRawTransaction({ serializedTransaction: signed }), transactionHash);
        // The first send deliberately loses its response. Reconcile the saved
        // exact hash without signing/rebroadcasting a second payment.
        const paid = await receipt(Promise.resolve(transactionHash));
        assert.equal((await c.getTransactionReceipt({ hash: transactionHash })).blockHash, paid.blockHash);
        assert.equal(await c.getBalance({ address: recipient }), before + row.amount);
        expectedBalances.set(recipient, (expectedBalances.get(recipient) ?? 0n) + row.amount);
        records.push({ slot: slot === 5 ? "league" : slot + 1, kind: row.kind === 0 ? "athlete" : "club", beneficiaryId: row.id,
          recipient, amountWei: row.amount.toString(), transactionHash, blockNumber: paid.blockNumber.toString(), blockHash: paid.blockHash });
        await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract, data }));
        if (signer && !records.slice(0, -1).some(r => r.slot === (slot === 5 ? "league" : slot + 1) && r.kind === "athlete")) {
          await assert.rejects(readVerifiedRewardProgrammeAthleteClaimV3(c, expectation), { code: "reward_claim_already_paid" });
        }
        previousClaimData = data;
      }
    }
    async function reconcile(slots) {
      const observed = await readVerifiedRewardProgrammeV3(c, spec);
      for (const slot of slots) {
        const f = children[slot], rows = plans.get(slot), paid = records.filter(r => r.slot === (slot === 5 ? "league" : slot + 1)).reduce((s, r) => s + BigInt(r.amountWei), 0n);
        assert.equal(observed.pots[slot].paidWei, paid);
        assert.equal(await c.getBalance({ address: f.context.verifyingContract }), observed.pots[slot].capWei - paid);
        for (const row of rows) {
          const entry = await read(f, "entitlements", [row.award.entitlementId]), payment = records.find(r => r.slot === (slot === 5 ? "league" : slot + 1) && r.beneficiaryId === row.id);
          assert.equal(entry[1], row.amount); assert.equal(entry[6], !!payment);
          assert.equal(getAddress(entry[4]), payment ? getAddress(payment.recipient) : zeroAddress);
        }
      }
      return observed;
    }
    for (let slot = 0; slot < 4; slot++) { await activate(slot, waveOne); await pay(slot); }
    const first = await reconcile([0, 1, 2, 3]);
    assert.equal(first.pendingFundingWei, parseEther("60"));
    for (const slot of [4, 5]) { assert.equal(first.pots[slot].routed, false); assert.equal(await read(children[slot], "state"), 0); }
    t.diagnostic(JSON.stringify({ wave: "four_rounds", claims: records.length, finaleAndLeagueHeldWei: first.pendingFundingWei.toString() }));
    for (const slot of [4, 5]) { await activate(slot, all); await pay(slot); }
    const final = await reconcile([0, 1, 2, 3, 4, 5]);
    const paidWei = records.reduce((s, r) => s + BigInt(r.amountWei), 0n), reservedWei = all.proposedWei - paidWei;
    assert.equal(final.pendingFundingWei, 0n); assert.equal(final.pots.reduce((s, p) => s + p.paidWei, 0n), paidWei);
    assert.equal(paidWei + reservedWei + all.retainedWei, budget);
    assert.ok(reservedWei > 0n); assert.ok(all.retainedWei > 0n);
    assert.equal(records.filter(r => r.kind === "athlete").length, 81);
    assert.equal(records.filter(r => r.kind === "club").length, 6);
    for (const [recipient, amount] of expectedBalances) assert.equal(await c.getBalance({ address: recipient }), amount);
    assert.equal(new Set(records.filter(r => r.kind === "athlete").map(r => r.recipient)).size, 14);
    assert.equal(new Set(records.map(r => r.transactionHash)).size, records.length);
    await t.test("six V3 club payments reconcile after both waves without another signature or send", async () => {
      assert.equal(clubPayments.length, 6);
      const nonceBefore = await c.getTransactionCount({ address: chain.relayer.address });
      for (const club of clubPayments) {
        const recovered = await club.observe();
        assert.deepEqual({ ...recovered.payment, finalizedBlock: club.result.payment.finalizedBlock }, club.result.payment);
      }
      assert.equal(await c.getTransactionCount({ address: chain.relayer.address }), nonceBefore);
    });
    await t.test("24 exact lifecycle receipts reconcile after all 87 payouts without another signature or send", async () => {
      assert.equal(lifecycleAttempts.length, 24);
      const nonceBefore = await c.getTransactionCount({ address: chain.operator.address });
      for (const { plan, serialized, proof } of lifecycleAttempts) {
        const recovered = await readVerifiedRewardProgrammeLifecycleV3(c, plan, serialized);
        assert.deepEqual({ ...recovered, finalizedBlock: proof.finalizedBlock }, proof);
      }
      assert.equal(await c.getTransactionCount({ address: chain.operator.address }), nonceBefore);
    });
    await t.test("lifecycle receipts reject forged events, wrong tx fields and a reorg after chain IO", async () => {
      const attempt = lifecycleAttempts.find(a => a.plan.action === "stage_allocation"), hash = attempt.proof.transactionHash;
      const observe = reader => readVerifiedRewardProgrammeLifecycleV3(reader, attempt.plan, attempt.serialized);
      await observe(c);
      for (const mutate of [r => r.logs.pop(), r => r.logs.reverse(), r => r.logs[0].removed = true,
        r => r.logs[0].data += "00", r => r.logs[0].topics[1] = manifest, r => r.logs[0].address = address,
        r => r.gasUsed = 0n, r => r.effectiveGasPrice = lifecycleFees.maxFeePerGas + 1n, r => r.status = "reverted"])
        await assert.rejects(observe({ ...c, getTransactionReceipt: async args => {
          const r = structuredClone(await c.getTransactionReceipt(args)); if (args.hash === hash) mutate(r); return r;
        } }));
      for (const patch of [{ nonce: 999999 }, { to: address }, { from: funder.address }, { value: 1n }, { input: "0x" },
        { gas: 1n }, { chainId: 143 }, { type: "legacy" }, { transactionIndex: 99 }])
        await assert.rejects(observe({ ...c, getTransaction: async args => {
          const tx = await c.getTransaction(args); return args.hash === hash ? { ...tx, ...patch } : tx;
        } }));
      for (const drift of ["chain", "finality", "deployment", "receipt"]) {
        let targetRead = false;
        await assert.rejects(observe({ ...c, getTransactionReceipt: async args => {
          if (args.hash === hash) targetRead = true; return c.getTransactionReceipt(args);
        }, getChainId: () => targetRead && drift === "chain" ? Promise.resolve(143) : c.getChainId(),
        getBlock: async args => {
          const b = await c.getBlock(args); if (!targetRead) return b;
          if (drift === "finality" && args.blockTag === "finalized") return { ...b, number: 0n };
          if (drift === "deployment" && args.blockNumber === deployment.blockNumber) return { ...b, hash: manifest };
          if (drift === "receipt" && args.blockNumber === attempt.proof.blockNumber) return { ...b, hash: manifest };
          return b;
        } }));
      }
    });
    t.diagnostic(JSON.stringify({ environment: "owned-local-simulation-only", chainId: 31337, budgetWei: budget.toString(),
      entries: 100, recurringAthletes: 20, finishes: 97, participationMetres: all.league.participation.totalMetres.toString(),
      claims: records.length, paidWei: paidWei.toString(), reservedWei: reservedWei.toString(), unallocatedWei: all.retainedWei.toString(),
      protected: { minorProfiles: minors.size, walletlessProfiles: 1, ageUnknownProfiles: 1, ownerlessClubs: 3 },
      deploymentTransactionHash: deployment.transactionHash, programmeAddress: address, receipts: records }));
  } finally { await chain.stop(); }
});
