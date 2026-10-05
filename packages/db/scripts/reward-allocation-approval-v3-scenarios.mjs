import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import { allocationApprovalV3 } from "../../../apps/api/dist/features/rewards/allocation-approval-v3-service.js";
import { prepareProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { recordSignedProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-attempt-v3-service.js";
import { queueVerifiedProgrammeDeploymentV3, runProgrammeDeploymentJobV3 } from "../../../apps/api/dist/features/rewards/programme-worker-v3.js";
import { rewardHistoricalSourceV3, rewardProgrammeApprovalV3, readAllocationApprovalV3 } from "../dist/rewards/index.js";
import { canonicalRewardJson } from "../../rewards-chain/dist/index.js";
import { encodeRewardProgrammeDeploymentV3, rewardProgrammeV3Abi } from "../../rewards-chain/dist/programme-v3.js";
import { startOwnedRewardChain, fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { literal as q } from "./reward-integration-fixture.mjs";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { allocationUploadV3, composeAllocationUploadV3 } from "../../../apps/api/dist/features/rewards/allocation-upload-v3-service.js";
import { readAllocationUploadV3, allocationDocumentHashV3 } from "../dist/rewards/index.js";
import { rewardCampaignV3Abi } from "../../rewards-chain/dist/campaign-v3.js";
import { programmeLifecycleV3Scenarios } from "./reward-programme-lifecycle-v3-scenarios.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Continues the actual imported-four + explicitly bound native-finale fixture.
// Its programme, six children and funding receipts are real on an owned LOCAL
// chain. No injected registry, public RPC, copied athlete keys or fake paid flags.
export async function allocationApprovalV3Scenarios({ harness, scenario, fixture, after }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const { identity, draftId, editionId, raceId, intentId, approvalId } = fixture;
  const scope = { chainId: 31337, draftId, slot: 1 }, operator = fixtureSigner(0x8c0001), funder = fixtureSigner(0x8c0002);
  const chain = await startOwnedRewardChain({ retainLifecycleHistory: true });
  const deps = { rpc, reader: chain.publicClient }, table = "app_private.reward_allocation_approvals_v3";
  const read = () => allocationApprovalV3(identity, scope, undefined, deps);
  const http = async body => {
    const response = {};
    const handled = await dispatchRewardPlanningRoutes({ method: body ? "POST" : "GET" }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/allocation-approval/1`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, readJsonBody: async () => body,
        applyPrivateSessionHeaders: () => response.private = true, sendSuccess: (_, data) => Object.assign(response, { status: 200, data }),
        sendError: (_, status, code) => Object.assign(response, { status, code }), rpc, programmeFundingReader: chain.publicClient });
    assert.equal(handled, true); assert.equal(response.private, true); return response;
  };
  const count = () => scalar(`select count(*) from ${table} where draft_id=${q(draftId)}`);
  const review = async (slot, decision, requestId) => {
    const v = await rewardHistoricalSourceV3(identity, 31337, draftId, undefined, rpc);
    return rewardHistoricalSourceV3(identity, 31337, draftId, { slot, decision, requestId,
      expectedReviewId: v.decisions.find(d => d.slot === slot)?.id ?? null, contextHash: v.contextHash }, rpc);
  };
  let first, saved, funding, uploadChange, uploadScope, uploaded;
  const sql = (change, document, observed = funding) => rpcSql("service_approve_reward_allocation_v3", {
    p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId,
    p_slot: 1, p_request_id: change.requestId, p_expected_approval_id: change.expectedApprovalId,
    p_context_hash: change.contextHash, p_document_text: canonicalRewardJson(document), p_funding: observed });
  try {
    await scenario("allocation quote before programme deployment is retained and cannot be approved", async () => {
      await review(1, "confirmed_final", id(982001));
      const v = await read(); assert.equal(v.document.binding, null); assert.ok(v.reasons.includes("funding_required"));
      const change = { requestId: id(982002), expectedApprovalId: null, contextHash: v.contextHash, documentHash: v.documentHash };
      await assert.rejects(allocationApprovalV3(identity, scope, change, deps), { code: "reward_allocation_not_ready" });
      assert.equal(await count(), 0);
    });
    await scenario("combined-source programme is deployed by the private worker and funded with 100,000 local MON", async () => {
      await chain.testClient.setBalance({ address: operator.address, value: 500n * 10n ** 18n });
      await chain.testClient.setBalance({ address: funder.address, value: 100010n * 10n ** 18n });
      const approval = await rewardProgrammeApprovalV3(identity, 31337, draftId, undefined, rpc);
      const prepared = await prepareProgrammeDeploymentV3(identity, { chainId: 31337, draftId, requestId: intentId,
        approvalId, contextHash: approval.contextHash, maximumGasCostWei: 10n ** 18n }, deps);
      const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
      const data = encodeRewardProgrammeDeploymentV3(prepared.plan, artifact.bytecode.object);
      const gas = (await chain.publicClient.estimateGas({ account: operator.address, data })) * 12n / 10n;
      const signedTransaction = await operator.signTransaction({ chainId: 31337, type: "eip1559", nonce: Number(prepared.plan.deploymentNonce),
        data, value: 0n, gas, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
      const job = { chainId: 31337, draftId, intentId, attemptId: id(982003), jobId: id(982004), workerId: id(982005) };
      await recordSignedProgrammeDeploymentV3(identity, { ...job, signedTransaction }, rpc);
      await queueVerifiedProgrammeDeploymentV3(identity, job, rpc);
      const workerDeps = { ...deps, broadcast: signed => chain.publicClient.sendRawTransaction({ serializedTransaction: signed }) };
      assert.equal((await runProgrammeDeploymentJobV3(identity, job, workerDeps)).outcome, "submitted");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await runProgrammeDeploymentJobV3(identity, job, workerDeps)).outcome, "confirmed");
      // A registered but empty programme is not sufficient to approve prizes.
      const empty = await read(); assert.ok(empty.reasons.includes("funding_not_available"));
      const address = prepared.plan.context.verifyingContract;
      const send = async (account, functionName, args, value = 0n) => {
        const data = encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName, args });
        const gas = (await chain.publicClient.estimateGas({ account: account.address, to: address, data, value })) * 12n / 10n;
        const signed = await account.signTransaction({ chainId: 31337, type: "eip1559", to: address, data, value, gas,
          nonce: await chain.publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
          maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
        const hash = await chain.publicClient.sendRawTransaction({ serializedTransaction: signed });
        assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
      };
      await send(funder, "deposit", [0n], 100000n * 10n ** 18n);
      for (let slot = 0; slot < 6; slot++) await send(operator, "routePot", [slot]);
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      const funded = await read(); assert.deepEqual(funded.reasons, []); assert.equal(funded.document.binding.programmeAddress, address.toLowerCase());
      assert.equal(funded.stageReady, false); assert.equal(funded.payableWei, "0");
    });
    await scenario("exact concurrent allocation approvals persist one document and stable opaque walletless recipients", async () => {
      const v = await read();
      first = { requestId: id(982010), expectedApprovalId: null, contextHash: v.contextHash, documentHash: v.documentHash };
      const routeView = await http(); assert.equal(routeView.status, 200); assert.equal(routeView.data.documentHash, v.documentHash);
      const pair = await Promise.all([allocationApprovalV3(identity, scope, first, deps), allocationApprovalV3(identity, scope, first, deps)]);
      assert.equal(pair[0].recorded.id, pair[1].recorded.id); saved = pair[0].recorded;
      assert.equal(await count(), 1); assert.equal(saved.document.calculation.budgetWei, 10000n * 10n ** 18n);
      funding = await scalar(`select funding_observation from ${table} where id=${q(first.requestId)}`);
      const recipientSql = `select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount_wei',r.amount_wei::text) order by source_beneficiary_id) from app_private.reward_allocation_recipients_v3 r where approval_id=${q(first.requestId)}`;
      const recipients = await scalar(recipientSql);
      assert.ok(recipients.length > 0);
      assert.equal(new Set(recipients.map(r => r.entitlement_id)).size, recipients.length);
      assert.equal(recipients.reduce((n, r) => n + BigInt(r.amount_wei), 0n), saved.document.calculation.proposedWei);
      const historical = await allocationApprovalV3(identity, scope, first, { rpc, reader: { getChainId() { throw Error("retry must not query chain"); } } });
      assert.equal(historical.recorded.id, first.requestId);
      assert.deepEqual(await scalar(recipientSql), recipients);
      const routeRetry = await http(first); assert.equal(routeRetry.status, 200); assert.equal(routeRetry.data.recorded.id, first.requestId);
      assert.equal(routeRetry.data.payableWei, "0"); assert.equal(routeRetry.data.stageReady, false);
    });
    await scenario("later native-finale publication counters and another round review preserve approved historical prizes", async () => {
      const before = await read();
      await query(`update public.event_editions set status='completed' where id=${q(editionId)};`);
      await review(2, "confirmed_final", id(982011));
      const after = await read(); assert.equal(after.contextHash, before.contextHash); assert.equal(after.documentHash, before.documentHash);
      assert.equal(after.approval.current, true); assert.equal(after.approval.id, first.requestId);
      // Compare real database context helpers with changed publication metadata,
      // without fabricating an actual race publication or overwriting the import.
      const h = await scalar(`select public.service_read_reward_historical_source_v3(${q(identity.userId)},${q(identity.sessionId)},31337,${q(draftId)})`);
      const changed = structuredClone(h); Object.assign(changed.workspace.catalogue.rounds[4].races[0], { publicationId: id(982099), publicationState: "official", resultCount: 100 });
      changed.workspace.catalogueHash = "b".repeat(64);
      assert.equal(await scalar(`select app_private.reward_historical_source_context_v3(${q(JSON.stringify(h))}::jsonb)=app_private.reward_historical_source_context_v3(${q(JSON.stringify(changed))}::jsonb)`), true);
      changed.workspace.catalogue.rounds[4].races[0].distanceMetres = "6000";
      assert.equal(await scalar(`select app_private.reward_historical_source_context_v3(${q(JSON.stringify(h))}::jsonb)=app_private.reward_historical_source_context_v3(${q(JSON.stringify(changed))}::jsonb)`), false);
      assert.ok(raceId);
    });
    await scenario("V3 upload rejects substituted rows, amount edits and clocks, then persists one exact concurrent preparation", async () => {
      uploadScope = { ...scope, approvalId: first.requestId };
      const facts = await readAllocationUploadV3(identity, uploadScope, rpc), package_ = composeAllocationUploadV3(facts);
      uploadChange = { requestId: id(983001), contextHash: facts.contextHash, documentHash: facts.documentHash };
      const raw = p => rpcSql("service_prepare_reward_allocation_upload_v3", {
        p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId,
        p_slot: 1, p_approval_id: first.requestId, p_request_id: uploadChange.requestId, p_context_hash: facts.contextHash,
        p_document_hash: facts.documentHash, p_package_text: canonicalRewardJson(p) });
      for (const mutate of [p => p.awards[0].amount = "1", p => p.awards[0].beneficiaryId = `0x${"f".repeat(64)}`,
        p => p.awards[0].beneficiaryKind = 7, p => p.awards.reverse(), p => p.awards.pop(), p => p.chainId = 10143,
        p => p.protocolVersion = 1, p => p.officialPublishedAt = "1", p => p.campaignAddress = package_.programmeAddress,
        p => p.reviewPeriod = "0", p => p.snapshotDigest = `0x${"0".repeat(64)}`]) {
        const changed = structuredClone(package_); mutate(changed);
        await assert.rejects(query(raw(changed)), /invalid_reward_allocation_upload/);
      }
      const table = "app_private.reward_allocation_uploads_v3";
      const release = await lock(`lock table ${table} in share mode`);
      const pending = assert.rejects(query(raw(package_)), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending;
      assert.equal(await scalar(`select count(*) from ${table}`), 0);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      await assert.rejects(query(`begin;
        create function pg_temp.synthetic_upload_drift() returns trigger language plpgsql as $$ begin
          update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
        create trigger synthetic_upload_drift after insert on ${table} for each row execute function pg_temp.synthetic_upload_drift();
        ${raw(package_)} rollback;`), /reward_planning_revision_changed/);
      assert.equal(await scalar(`select count(*) from ${table}`), 0);
      const pair = await Promise.all([allocationUploadV3(identity, uploadScope, uploadChange, rpc), allocationUploadV3(identity, uploadScope, uploadChange, rpc)]);
      assert.deepEqual(pair[0], pair[1]); uploaded = pair[0];
      assert.equal(uploaded.prepared.id, uploadChange.requestId); assert.equal(uploaded.stageReady, false); assert.equal(uploaded.payableWei, "0");
      assert.equal(await scalar(`select count(*) from ${table}`), 1);
      assert.deepEqual(await allocationUploadV3(identity, uploadScope, undefined, rpc), uploaded);
      assert.equal(BigInt(uploaded.allocatedWei) + BigInt(uploaded.unallocatedWei), BigInt(uploaded.budgetWei));
      assert.doesNotMatch(JSON.stringify(uploaded), /snapshotSalt|explanationSalt|opaqueBeneficiaryId|sourceBeneficiaryId|awards|privateKey/);
      const after = await readAllocationUploadV3(identity, uploadScope, rpc);
      assert.deepEqual(after.recipients, facts.recipients); assert.equal(after.snapshotSalt, facts.snapshotSalt);
      assert.deepEqual(after.prepared.package, package_);
      // Even a structurally valid stored package with a matching transport hash
      // is not trusted: recompose its salted commitments from the private source.
      for (const mutate of [p => p.snapshotDigest = `0x${"e".repeat(64)}`,
        p => p.awards[0].explanationHash = `0x${"e".repeat(64)}`]) {
        const alteredRpc = async (fn, args) => {
          const result = await rpc(fn, args), changed = structuredClone(result);
          if (fn === "service_read_reward_allocation_upload_v3" && changed.data?.prepared) {
            mutate(changed.data.prepared.package);
            changed.data.prepared.packageHash = allocationDocumentHashV3(changed.data.prepared.package);
          }
          return changed;
        };
        await assert.rejects(allocationUploadV3(identity, uploadScope, undefined, alteredRpc), { code: "invalid_reward_allocation_upload" });
      }
      for (const mutate of [f => f.recipients.pop(), f => f.recipients[0].amountWei += 1n,
        f => f.recipients[1].opaqueBeneficiaryId = f.recipients[0].opaqueBeneficiaryId,
        f => f.recipients[1].explanationSalt = f.recipients[0].explanationSalt]) {
        const altered = structuredClone(facts); mutate(altered); assert.throws(() => composeAllocationUploadV3(altered));
      }
      const response = {};
      await dispatchRewardPlanningRoutes({ method: "GET" }, response,
        new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/allocation-upload/1/${first.requestId}`), {
          config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, rpc,
          applyPrivateSessionHeaders: () => response.private = true, sendSuccess: (_, data) => response.data = data,
          sendError: (_, status, code) => Object.assign(response, { status, code }) });
      assert.equal(response.private, true); assert.deepEqual(response.data, uploaded);
      await assert.rejects(allocationUploadV3(identity, uploadScope, { ...uploadChange, requestId: id(983002) }, rpc), { code: "reward_allocation_upload_conflict" });
      for (const role of ["anon", "authenticated"]) {
        assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
        for (const fn of ["public.service_read_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid)",
          "public.service_prepare_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text)"]) {
          assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`), false);
          assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), false);
        }
      }
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`), true);
      await assert.rejects(query(`delete from ${table}`), /reward_ledger_is_immutable/);
      await assert.rejects(readAllocationUploadV3(identity, { ...uploadScope, chainId: 10143 }, rpc), { code: "reward_planning_not_found" });
      await assert.rejects(readAllocationUploadV3(identity, { ...uploadScope, slot: 2 }, rpc), { code: "reward_allocation_upload_not_found" });
    });
    await scenario("selected source hold invalidates authority while exact retry preserves original approval history", async () => {
      await review(1, "held", id(982012)); const held = await read();
      assert.equal(held.approval.current, false); assert.equal(held.document.calculation.proposedWei, 0n);
      const retry = await allocationApprovalV3(identity, scope, first, deps);
      assert.equal(retry.recorded.id, first.requestId); assert.equal(retry.recorded.current, false); assert.equal(await count(), 1);
      const oldUpload = await allocationUploadV3(identity, uploadScope, uploadChange, rpc);
      assert.equal(oldUpload.current, false); assert.deepEqual(oldUpload.prepared, uploaded.prepared);
      assert.equal(oldUpload.payableWei, "0");
      await review(1, "confirmed_final", id(982013));
    });
    await scenario("SQL rejects incomplete funding anchors and malformed amounts without inserting approval or recipients", async () => {
      const v = await read(), change = { ...first, requestId: id(982014), expectedApprovalId: first.requestId, contextHash: v.contextHash, documentHash: v.documentHash };
      for (const key of ["state", "blockHash", "blockNumber", "blockTimestamp", "capWei", "address", "routed", "remainingWei"]) {
        const observed = { ...funding }; delete observed[key];
        await assert.rejects(query(sql(change, v.document, observed)), /reward_allocation_not_ready/);
      }
      for (const mutate of [d => delete d.calculation.budgetWei, d => d.calculation.retainedWei = "-1", d => d.mappingRevision = 999,
        d => d.binding.fundingContextHash = "b".repeat(64), d => d.binding.reviewSeconds = 0]) {
        const document = JSON.parse(canonicalRewardJson(v.document)); mutate(document);
        await assert.rejects(query(sql(change, document)), /invalid_reward_allocation_approval/);
      }
      assert.equal(await count(), 1);
    });
    await scenario("allocation write rechecks Auth after a lock wait and rolls back on source drift after insertion", async () => {
      const v = await read(), change = { ...first, requestId: id(982015), expectedApprovalId: first.requestId, contextHash: v.contextHash, documentHash: v.documentHash };
      const release = await lock(`lock table ${table} in share mode`);
      const pending = assert.rejects(query(sql(change, v.document)), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending; assert.equal(await count(), 1);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      await assert.rejects(query(`begin;
        create function pg_temp.synthetic_allocation_drift() returns trigger language plpgsql as $$ begin
          update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
        create trigger synthetic_allocation_drift after insert on ${table} for each row execute function pg_temp.synthetic_allocation_drift();
        ${sql(change, v.document)} rollback;`), /reward_planning_revision_changed/);
      assert.equal(await count(), 1);
    });
    await scenario("allocation evidence and opaque recipients are immutable and private, with cross-chain reads rejected", async () => {
      for (const t of [table, "app_private.reward_allocation_recipients_v3"]) {
        assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${t}'::regclass`), true);
        await assert.rejects(query(`delete from ${t}`), /reward_ledger_is_immutable/);
        for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_table_privilege('${role}','${t}','SELECT,INSERT,UPDATE,DELETE')`), false);
      }
      for (const fn of ["public.service_read_reward_allocation_approval_v3(uuid,uuid,integer,uuid,integer,uuid)", "public.service_approve_reward_allocation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,jsonb)"]) {
        assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), false);
        for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`), false);
      }
      await assert.rejects(readAllocationApprovalV3(identity, { ...scope, chainId: 10143 }, rpc), { code: "reward_planning_not_found" });
    });
    await scenario("fresh stored V3 approval and saved random IDs upload exact awards to the actual registered local child without staging", async () => {
      const v = await read();
      const approved = await allocationApprovalV3(identity, scope, { requestId: id(983010), expectedApprovalId: first.requestId,
        contextHash: v.contextHash, documentHash: v.documentHash }, deps);
      const selected = { ...scope, approvalId: approved.recorded.id };
      await allocationUploadV3(identity, selected, { requestId: id(983011), contextHash: approved.contextHash, documentHash: approved.documentHash }, rpc);
      const facts = await readAllocationUploadV3(identity, selected, rpc), p = facts.prepared.package;
      await programmeLifecycleV3Scenarios({ harness, scenario, identity, scope: { ...selected, uploadId: facts.prepared.id },
        chain, operator, facts, review });
      const get = (functionName, args = []) => chain.publicClient.readContract({ address: p.campaignAddress, abi: rewardCampaignV3Abi, functionName, args });
      assert.equal(await get("uploadDigest"), p.uploadDigest); assert.equal(await get("entitlementCount"), BigInt(p.entitlementCount));
      assert.equal(await get("allocated", [0]), BigInt(p.allocatedWei)); assert.equal(await get("paid", [0]), 0n);
      assert.equal(await get("reviewStartedAt"), 0n); assert.equal(await get("officialPublishedAt"), 0n);
      const after = await allocationUploadV3(identity, selected, undefined, rpc);
      assert.equal(after.prepared.packageHash, facts.prepared.packageHash); assert.equal(after.stageReady, false);
      // Closure and upload use the persistent V3 worker, leases and atomic
      // receipts on the owned local chain. No public execution or staging.
    });
    if (after) await after({ reader: chain.publicClient, chain, operator });
  } finally { await chain.stop(); }
}
