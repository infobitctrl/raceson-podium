import assert from "node:assert/strict";
import { prepareAthleteWalletProof,verifyAthleteWalletProof } from "../../../apps/api/dist/features/rewards/athlete-wallet-service.js";
import { submitAthleteRewardDestination } from "../../../apps/api/dist/features/rewards/athlete-destination-service.js";
import { reviewAthleteRewardReadiness } from "../../../apps/api/dist/features/rewards/athlete-readiness-service.js";
import { prepareAthleteRewardClaim,athleteRewardClaimExpectation } from "../../../apps/api/dist/features/rewards/athlete-claim-service.js";
import { submitAthleteRewardClaimProof,loadVerifiedAthleteRewardClaimProofs } from "../../../apps/api/dist/features/rewards/athlete-claim-proof-service.js";
import { recordSignedAthleteRewardPayment,loadVerifiedAthleteRewardPaymentAttempt } from "../../../apps/api/dist/features/rewards/athlete-payment-service.js";
import { paymentIntentSystemScenarios } from "./reward-payment-intent-system-scenarios.mjs";
import { paymentJobSystemScenarios } from "./reward-payment-job-system-scenarios.mjs";
import { paymentHoldSystemScenarios } from "./reward-payment-hold-system-scenarios.mjs";
import { claimHistorySystemScenarios } from "./reward-claim-history-system-scenarios.mjs";
import { claimHttpFixture, claimConsentReviewScenarios, signingFromClaimPreview } from "./reward-claim-consent-system-scenarios.mjs";
import { getAthleteRewardClaims } from "../../../apps/api/dist/features/rewards/athlete-claim-history-service.js";
import { readRewardAthleteReviewContext,readRewardAthleteClaimContext,storeRewardAthleteClaimIntent,
  readRewardAthleteClaimProofs,storeRewardAthleteClaimProof,reserveRewardAthletePaymentIntent,storeRewardAthletePaymentAttempt } from "../dist/rewards/index.js";
import { readVerifiedRewardAthleteClaim,verifyRewardClaimEoaProof,requireLiveRewardClaim,encodeRewardClaim,
  rewardPaymentFromReceipt,readVerifiedRewardCampaign,rewardCampaignAbi,encodeRewardAthletePayment,
  verifySignedRewardAthletePayment,readVerifiedRewardAthletePayment } from "../../rewards-chain/dist/index.js";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

// Actual private SQL and a parent-owned unforked chain. All identity/evidence
// fixtures and signing below are synthetic, NOT operated recipient approval.
export async function claimSystemScenarios({harness,scenario,chain,entries,programmeId}){
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  const {publicClient,operatorClient,relayerClient,testClient,operator,artifact}=chain;
  const identity={userId:id(4),sessionId:id(99201)};
  const recipient={userId:id(5),sessionId:id(99202)};const profile=id(1000);const signer=fixtureSigner(996);
  const config={chainId:31337,origin:"http://127.0.0.1:5173",rpc};
  const deps={...config,reader:publicClient,creationCode:artifact.bytecode.object};
  const claimHttp=claimHttpFixture({harness,chain,config,recipient});
  const finalize=()=>testClient.mine({blocks:96,interval:1});
  const count=()=>scalar("select count(*) from app_private.reward_athlete_claim_intents");
  const reserved=await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const roleBefore=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(recipient.sessionId)},${literal(recipient.userId)},clock_timestamp()+interval '1 hour');
    update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${literal(recipient.userId)} where id=${literal(profile)};`);
  const challenge=await prepareAthleteWalletProof(recipient,{address:signer.address,idempotencyKey:"claim-system-wallet"},config);
  await verifyAthleteWalletProof(recipient,{challengeId:challenge.challengeId,signature:await signer.signMessage({message:challenge.message})},config);
  const destination=await submitAthleteRewardDestination(recipient,{challengeId:challenge.challengeId,athleteProfileId:profile,idempotencyKey:"claim-system-destination"},config);
  const attestation={schemaVersion:1,policy:"operator-observed-external-wallet-v1",verifiedDateOfBirth:"1990-01-01",
    identityEvidenceRef:id(99301),adultEvidenceRef:id(99302),walletMfaEvidenceRef:id(99303),walletRecoveryEvidenceRef:id(99304)};
  const review=async key=>{
    const c=await readRewardAthleteReviewContext(identity,programmeId,destination.requestId,rpc);
    return reviewAthleteRewardReadiness(identity,{programmeId,requestId:destination.requestId,
      expectedProfileFingerprintSha256:c.profileFingerprintSha256,expectedRevision:c.latestReview?.revision??0,attestation,idempotencyKey:key},config);
  };
  const entitlementFor=entry=>scalar(`select e.id from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id
    where b.campaign_id=${literal(entry.campaign.id)} and b.kind='athlete' and b.entity_id=${literal(profile)}`);
  let readiness=await review("claim-system-readiness");const entry=entries[0];
  let input={reviewId:readiness.reviewId,entitlementId:await entitlementFor(entry),idempotencyKey:"claim-system-first"};
  const firstRequest=structuredClone(input);
  const read=(request=input)=>readRewardAthleteClaimContext(identity,request,rpc);
  const prepare=(request=input,dependencies=deps)=>prepareAthleteRewardClaim(identity,request,dependencies);
  const expectation=async request=>athleteRewardClaimExpectation(await read(request));
  const observe=async request=>readVerifiedRewardAthleteClaim(publicClient,await expectation(request),artifact.bytecode.object);
  let first,second,renewed;

  await scenario("reviewed athlete claim preparation binds real SQL award and active chain; concurrent exact retries produce one immutable message pair",async()=>{
    await assert.rejects(prepareAthleteRewardClaim(recipient,input,deps),{code:"reward_operator_permission_required"});
    await assert.rejects(readRewardAthleteClaimContext({...identity,sessionId:recipient.sessionId},input,rpc),{code:"reward_account_session_required"});
    await assert.rejects(prepare({...input,entitlementId:id(99999)}),{code:"reward_claim_scope_required"});
    const club=await scalar(`select e.id from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id
      where b.campaign_id=${literal(entry.campaign.id)} and b.kind='club' limit 1`);
    await assert.rejects(prepare({...input,entitlementId:club}),{code:"reward_claim_scope_required"});
    const results=await Promise.all([prepare(),prepare()]);assert.deepEqual(results[0],results[1]);first=results[0];
    assert.equal(await count(),1);assert.equal(first.claim.nonce,0n);assert.equal(first.claim.expiresAt-first.claim.issuedAt,86400n);
    assert.equal(first.claim.recipient.toLowerCase(),signer.address.toLowerCase());
    assert.equal(first.claim.amount,(await read()).entitlement.amountWei);assert.equal(first.claim.pot,"race");
    assert.equal(first.messages.consent.primaryType,"ReceiveReward");assert.equal(first.messages.authorization.primaryType,"ClaimAuthorization");
    assert.deepEqual(await prepare(input,{...deps,reader:{}}),first,"Exact history needs no fresh chain observation");
    const doc=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_read_reward_athlete_claim_context",{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,
        p_review_id:input.reviewId,p_entitlement_id:input.entitlementId,p_idempotency_key:input.idempotencyKey})}rollback;`));
    assert.equal(doc.intent.intentId,first.intentId);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    await assert.rejects(query(`update app_private.reward_athlete_claim_intents set nonce=1 where id=${literal(first.intentId)}`),{code:"reward_ledger_is_immutable"});
    await assert.rejects(query(`delete from app_private.reward_athlete_claim_intents where id=${literal(first.intentId)}`),{code:"reward_ledger_is_immutable"});
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),reserved);
  });
  await claimHistorySystemScenarios({harness,scenario,recipient,identity,profile,first,config});
  await claimConsentReviewScenarios({harness,scenario,chain,config,recipient,identity,profile,first,request:claimHttp});
  await scenario("claim preparation rejects altered witnesses, signatures, scopes, code, stale observations and overlapping attempts",async()=>{
    const witness=await observe(input);const fresh={...input,idempotencyKey:"claim-overlap"};
    await assert.rejects(prepare(fresh),{code:"reward_claim_already_prepared"});
    for(const mutate of [w=>{w.award.amount++;},w=>{w.award.paid=true;},w=>{w.recipient=chain.treasury.toLowerCase();},
      w=>{w.observation.accounting.allocationDigest=`0x${"ab".repeat(32)}`;},w=>{w.observation.finalizedBlock.number=0n;},
      w=>{w.deployment.contractAddress=chain.treasury.toLowerCase();},w=>{w.extra=true;}]){
      const w=structuredClone(witness);mutate(w);
      await assert.rejects(storeRewardAthleteClaimIntent(identity,{...fresh,witness:w,observedAt:new Date().toISOString()},rpc));
    }
    await assert.rejects(storeRewardAthleteClaimIntent(identity,{...fresh,witness,observedAt:"2020-01-01T00:00:00Z"},rpc),{code:"reward_claim_observation_stale"});
    for(const mutate of [c=>{c.entitlement.amountWei="1";},c=>{c.reviewContext.challenge.proof.signature=`0x${"ff".repeat(65)}`;},
      c=>{c.reviewContext.challenge.proof.messageHash=`0x${"ab".repeat(32)}`;},c=>{c.intent.recipientAddress=chain.treasury.toLowerCase();},
      c=>{c.intent.expiresAt=String(BigInt(c.intent.expiresAt)-1n);},c=>{c.lifecycleContext.upload.body.budgets[0]="1";}]){
      const transport=async(name,args)=>{const result=await rpc(name,args);if(name==="service_read_reward_athlete_claim_context"&&!result.error)mutate(result.data);return result;};
      await assert.rejects(prepare(input,{...deps,rpc:transport}));
    }
    for(const configPatch of [{chainId:10143},{origin:"http://localhost:5173"}])await assert.rejects(prepare(input,{...deps,...configPatch}),{code:"reward_wallet_context_mismatch"});
    for(const address of [operator.address,signer.address]){
      const reader={...publicClient,getCode:async args=>args.address.toLowerCase()===address.toLowerCase()?"0xef010000":publicClient.getCode(args)};
      await assert.rejects(prepare(fresh,{...deps,reader}),{code:address===operator.address?"reward_claim_eoa_operator_required":"reward_claim_eoa_recipient_required"});
    }
    const reader={...publicClient,readContract:async args=>{const row=await publicClient.readContract(args);
      return args.functionName==="entitlements"?[row[0],row[1]+1n,...row.slice(2)]:row;}};
    await assert.rejects(prepare(fresh,{...deps,reader}),{code:"reward_claim_award_mismatch"});
    const broken={...publicClient,getCode:async()=>{throw new Error("Synthetic private RPC diagnostics must not escape");}};
    await assert.rejects(prepare(fresh,{...deps,reader:broken}),e=>!e.message.includes("diagnostics"));
    assert.equal(await count(),1);
  });
  await scenario("claim writes recheck ownership and session after real database lock waits; historical retries never renew approval",async()=>{
    const w=await observe(input);const request={...input,idempotencyKey:"claim-blocked-owner",witness:w,observedAt:new Date().toISOString()};
    const release=await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(profile)}`);
    const pending=assert.rejects(storeRewardAthleteClaimIntent(identity,request,rpc),{code:"reward_claim_readiness_required"});pending.catch(()=>{});
    try{await waiting(1);}finally{await release();}await pending;
    assert.deepEqual(await prepare(input,{...deps,reader:{}}),first);
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(recipient.userId)} where id=${literal(profile)}`);
    readiness=await review("claim-readiness-after-ownership");
    const fresh={...input,reviewId:readiness.reviewId,idempotencyKey:"claim-fresh-review"};
    await assert.rejects(prepare(fresh),{code:"reward_claim_already_prepared"});
    const unlock=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const expired=assert.rejects(storeRewardAthleteClaimIntent(identity,{...fresh,witness:w,observedAt:new Date().toISOString()},rpc),{code:"reward_account_session_required"});expired.catch(()=>{});
    try{await waiting(1);}finally{await unlock();}await expired;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
    assert.equal(await count(),1);input=fresh;
  });
  await scenario("finalized on-chain revocation allows exactly one new intent; old nonce and forked same-height observations are rejected",async()=>{
    const oldWitness=(await read(firstRequest)).intent.chainWitness;
    const hash=await operatorClient.writeContract({address:first.context.verifyingContract,abi:rewardCampaignAbi,
      functionName:"revokeAuthorization",args:[first.claim.entitlementId]});
    assert.equal((await publicClient.waitForTransactionReceipt({hash,timeout:10000})).status,"success");await finalize();
    const requests=[{...input,idempotencyKey:"claim-revoked-a"},{...input,idempotencyKey:"claim-revoked-b"}];
    const competing=await Promise.allSettled(requests.map(r=>prepare(r)));
    assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(competing.find(r=>r.status==="rejected").reason.code,"reward_claim_already_prepared");
    const winner=competing.findIndex(r=>r.status==="fulfilled");input=requests[winner];second=competing[winner].value;
    assert.equal(second.claim.nonce,1n);assert.equal(await count(),2);
    assert.deepEqual(await prepare(firstRequest,{...deps,reader:{}}),first);
    await assert.rejects(storeRewardAthleteClaimIntent(identity,{...input,idempotencyKey:"claim-regressed-nonce",
      witness:oldWitness,observedAt:new Date().toISOString()},rpc),{code:"reward_claim_observation_regressed"});
    const forked=(await read(input)).intent.chainWitness;forked.observation.finalizedBlock.hash=`0x${"cd".repeat(32)}`;
    await assert.rejects(storeRewardAthleteClaimIntent(identity,{...input,idempotencyKey:"claim-forked-block",
      witness:forked,observedAt:new Date().toISOString()},rpc),{code:"reward_claim_observation_regressed"});
  });
  await scenario("paused claims cannot prepare; unpausing does not extend consent, and expired consent renews the existing award without consuming it twice",async()=>{
    const invoke=async name=>{const hash=await operatorClient.writeContract({address:first.context.verifyingContract,abi:rewardCampaignAbi,functionName:name});
      assert.equal((await publicClient.waitForTransactionReceipt({hash,timeout:10000})).status,"success");await finalize();};
    await invoke("pause");
    assert.equal((await claimHttp("GET",second.intentId)).body.error.code,"reward_claim_campaign_unavailable");
    await assert.rejects(prepare({...input,idempotencyKey:"claim-while-paused"}),{code:"reward_claim_campaign_unavailable"});
    assert.deepEqual(await prepare(input,{...deps,reader:{}}),second,"Historical messages are not live authorization");
    await invoke("resume");
    await testClient.setNextBlockTimestamp({timestamp:second.claim.expiresAt+1n});await finalize();
    assert.equal((await claimHttp("GET",second.intentId)).body.error.code,"reward_claim_not_live");
    const latest=await publicClient.getBlock({blockTag:"finalized"});
    const checkpoint=await readVerifiedRewardCampaign(publicClient,await expectation(input).then(e=>e.deployment),artifact.bytecode.object);
    assert.throws(()=>requireLiveRewardClaim(second.context,second.claim,latest.timestamp,checkpoint.observation.accounting.claimDeadline),{code:"reward_claim_not_live"});
    input={...input,idempotencyKey:"claim-renew-expired"};renewed=await prepare(input);
    assert.equal(renewed.claim.nonce,second.claim.nonce);assert(renewed.claim.issuedAt>=second.claim.expiresAt);
    assert.equal(renewed.claim.entitlementId,second.claim.entitlementId);assert.equal(renewed.claim.amount,second.claim.amount);
    assert.equal(await count(),3);assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),reserved);
  });
  await scenario("award consent requires the actual recipient session and exact signature; concurrent retries store one private proof",async()=>{
    const request={intentId:renewed.intentId,role:"recipient",signature:await signer.signTypedData(renewed.messages.consent),idempotencyKey:"claim-recipient-consent"};
    const operatorRequest={intentId:renewed.intentId,role:"operator",signature:await operator.signTypedData(renewed.messages.authorization),idempotencyKey:"claim-operator-approval"};
    await assert.rejects(submitAthleteRewardClaimProof(identity,operatorRequest,deps),{code:"reward_claim_recipient_consent_required"});
    await assert.rejects(submitAthleteRewardClaimProof(identity,request,deps),{code:"reward_claim_proof_scope_required"});
    await assert.rejects(submitAthleteRewardClaimProof(recipient,operatorRequest,deps),{code:"reward_claim_proof_scope_required"});
    await assert.rejects(submitAthleteRewardClaimProof({...recipient,sessionId:identity.sessionId},request,deps),{code:"reward_account_session_required"});
    await assert.rejects(submitAthleteRewardClaimProof(recipient,{...request,signature:operatorRequest.signature},deps),{code:"reward_claim_signature_mismatch"});
    await assert.rejects(submitAthleteRewardClaimProof(recipient,{...request,intentId:second.intentId,signature:await signer.signTypedData(second.messages.consent)},deps),{code:"reward_claim_not_live"});
    const preview=await claimHttp("GET",renewed.intentId);assert.equal(preview.statusCode,200);
    const browserSignature=await signer.signTypedData(signingFromClaimPreview(preview.body.data));assert.equal(browserSignature,request.signature);
    const post=async()=>{const r=await claimHttp("POST",renewed.intentId,{signature:browserSignature,idempotencyKey:request.idempotencyKey});
      assert.equal(r.statusCode,200);return r.body.data;};
    const results=await Promise.all([post(),post()]);
    assert.deepEqual(results[0],results[1]);assert.deepEqual(Object.keys(results[0]).sort(),["expiresAt","intentId","proofId","recordedAt","role"]);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_proofs"),1);
    const recorded=await claimHttp("GET",renewed.intentId,null,{claimReader:{}});
    assert.equal(recorded.statusCode,200);assert.equal(recorded.body.data.state,"consent_recorded");
    assert.equal(recorded.body.data.signing,null);assert.equal(recorded.body.data.operatorApprovalRecordedAt,null);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_intents"),0,"Recipient HTTP consent does not queue or pay");
    assert.deepEqual(await submitAthleteRewardClaimProof(recipient,request,{...deps,reader:{}}),results[0]);
    await assert.rejects(submitAthleteRewardClaimProof(recipient,{...request,idempotencyKey:"claim-conflicting-retry"},deps),{code:"reward_ledger_idempotency_conflict"});
    const context=await readRewardAthleteClaimProofs(recipient,request,rpc);assert.equal(context.actorUserId,recipient.userId);
    assert.equal(context.proofs[0].recordedByUserId,recipient.userId);assert.equal(context.proofs[0].recordedSessionId,recipient.sessionId);
    const doc=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_read_reward_athlete_claim_proofs",{p_actor_user_id:recipient.userId,p_actor_session_id:recipient.sessionId,p_intent_id:renewed.intentId,p_role:"recipient"})}rollback;`));
    assert.equal(doc.proofs.length,1);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    await assert.rejects(query(`update app_private.reward_athlete_claim_proofs set signature='0x'||repeat('00',65) where claim_intent_id=${literal(renewed.intentId)}`),{code:"reward_ledger_is_immutable"});
    await assert.rejects(query(`delete from app_private.reward_athlete_claim_proofs where claim_intent_id=${literal(renewed.intentId)}`),{code:"reward_ledger_is_immutable"});
  });
  await scenario("operator approval reverifies stored consent and current session after locks; altered evidence fails and exact inputs are frozen",async()=>{
    const request={intentId:renewed.intentId,role:"operator",signature:await operator.signTypedData(renewed.messages.authorization),idempotencyKey:"claim-operator-approval"};
    for(const mutate of [c=>{c.actorUserId=recipient.userId;},c=>{c.intent.expiresAt=String(BigInt(c.intent.expiresAt)-1n);},
      c=>{c.proofs[0].digest=`0x${"ab".repeat(32)}`;},c=>{c.proofs[0].signature=`0x${"ff".repeat(65)}`;},
      c=>{c.proofs[0].recordedByUserId=identity.userId;},c=>{c.upload.body.awards[0].amount="1";},
      c=>{c.proofs[0].chainWitness.observation.accounting.budgets[0]="1";},c=>{c.proofs.push(structuredClone(c.proofs[0]));}]){
      const transport=async(name,args)=>{const result=await rpc(name,args);if(name==="service_read_reward_athlete_claim_proofs"&&!result.error)mutate(result.data);return result;};
      await assert.rejects(submitAthleteRewardClaimProof(identity,request,{...deps,rpc:transport}));
    }
    const proof=await verifyRewardClaimEoaProof(renewed.context,renewed.claim,"operator",operator.address,request.signature);
    const witness=await observe(input);
    for(const mutate of [w=>{w.award.nonce++;},w=>{w.award.amount++;},w=>{w.recipient=chain.treasury.toLowerCase();}]){
      const w=structuredClone(witness);mutate(w);
      await assert.rejects(storeRewardAthleteClaimProof(identity,{...request,proof,witness:w,observedAt:new Date().toISOString()},rpc));
    }
    await assert.rejects(storeRewardAthleteClaimProof(identity,{...request,proof,witness,observedAt:"2020-01-01T00:00:00Z"},rpc),{code:"reward_claim_observation_stale"});
    const release=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=assert.rejects(storeRewardAthleteClaimProof(identity,{...request,proof,witness,observedAt:new Date().toISOString()},rpc),{code:"reward_account_session_required"});pending.catch(()=>{});
    try{await waiting(1);}finally{await release();}await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_proofs"),1);
    let unfreeze,entered;const ready=new Promise(r=>{entered=r;});const gate=new Promise(r=>{unfreeze=r;});
    const transport=async(name,args)=>{if(name==="service_read_reward_athlete_claim_proofs"){entered();await gate;}return rpc(name,args);};
    const mutable={...request};const actor={...identity};const saved=submitAthleteRewardClaimProof(actor,mutable,{...deps,rpc:transport});
    await ready;mutable.intentId=first.intentId;mutable.signature="0x";mutable.idempotencyKey="changed-input";actor.userId=recipient.userId;unfreeze();
    const result=await saved;assert.equal(result.intentId,renewed.intentId);assert.equal(result.role,"operator");
    const loaded=await loadVerifiedAthleteRewardClaimProofs(identity,request,config);assert.equal(loaded.context.proofs.length,2);
    assert.equal(loaded.context.proofs.find(p=>p.role==="operator").idempotencyKey,request.idempotencyKey);
    const history=(await getAthleteRewardClaims(recipient,null,config)).items.find(i=>i.intentId===renewed.intentId);
    assert.equal(history.recipientConsentRecordedAt,loaded.context.proofs.find(p=>p.role==="recipient").recordedAt);
    assert.equal(history.operatorApprovalRecordedAt,loaded.context.proofs.find(p=>p.role==="operator").recordedAt);
  });
  const approveClaim=async claim=>{
    for(const role of ["recipient","operator"]){
      const signature=role==="recipient"?await signer.signTypedData(claim.messages.consent):await operator.signTypedData(claim.messages.authorization);
      await submitAthleteRewardClaimProof(role==="recipient"?recipient:identity,{intentId:claim.intentId,role,signature,idempotencyKey:`payment-proof-${role}`},deps);
    }
    return claim;
  };
  const storedPayment=await paymentIntentSystemScenarios({harness,scenario,chain,identity,recipient,deps,config,renewed,observe:()=>observe(input),programmeId,
    approveAdditional:async n=>approveClaim(await prepare({reviewId:readiness.reviewId,entitlementId:await entitlementFor(entries[n]),idempotencyKey:`claim-payment-other-${n}`}))});
  const paymentJobs=await paymentJobSystemScenarios({harness,scenario,chain,identity,recipient,deps,storedPayment,finalize,programmeId});
  const paymentHolds=paymentHoldSystemScenarios({harness,scenario,chain,identity,deps,paymentJobs,programmeId,entries,finalize});
  await scenario("durable payment pays exactly one synthetic athlete; independent replay reverts and every other reserve reconciles",async()=>{
    const operatorProof=await operator.signTypedData(renewed.messages.authorization);
    const recipientProof=await signer.signTypedData(renewed.messages.consent);
    const loaded=await loadVerifiedAthleteRewardClaimProofs(identity,{intentId:renewed.intentId,role:"operator"},config);
    const signatures=Object.fromEntries(loaded.context.proofs.map(p=>[p.role,p.signature]));
    assert.deepEqual(signatures,{operator:operatorProof,recipient:recipientProof});assert.deepEqual(loaded.claim,renewed.claim);
    const stored=await loadVerifiedAthleteRewardPaymentAttempt(identity,{claimIntentId:renewed.intentId,paymentIntentId:storedPayment.payment.paymentIntentId,
      attemptId:storedPayment.attempt.attemptId},config);
    const plan=stored.plan;const fees=storedPayment.fees;
    const encoded=encodeRewardAthletePayment(plan);assert.equal(encoded.data,encodeRewardClaim(renewed.context,loaded.claim,signatures));
    const signed=stored.verified.signedTransaction;const attempt=stored.verified;
    const hash=attempt.transactionHash;
    const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:10000});
    assert.equal(receipt.status,"success");await finalize();
    const block=await publicClient.getBlock({blockNumber:receipt.blockNumber});const head=await publicClient.getBlock({blockTag:"finalized"});
    const paid=rewardPaymentFromReceipt(renewed.context,renewed.claim,hash,{receipt,observedChainId:await publicClient.getChainId(),
      canonicalBlockHash:block.hash,finalizedBlockNumber:head.number});
    const verified=await readVerifiedRewardAthletePayment(publicClient,plan,signed,artifact.bytecode.object);
    assert.equal(verified.payment.amount,paid.amount);assert.equal(verified.payment.transactionHash,hash);
    assert.equal(verified.payment.authorizationNonce,renewed.claim.nonce);assert.equal(verified.payment.nonce,plan.nonce);
    assert.equal(paid.amount,renewed.claim.amount);assert.equal(await publicClient.getBalance({address:signer.address}),paid.amount);
    assert.equal(await publicClient.getTransactionCount({address:signer.address}),0,"Recipient pays no gas or transaction nonce");
    // Separate synthetic EOA: the negative replay must not consume nonce slots
    // already reserved to other campaigns in the real relayer book.
    const replaySigner=fixtureSigner(997);await testClient.setBalance({address:replaySigner.address,value:1000000000000000000n});
    const duplicatePlan={...plan,relayerAddress:replaySigner.address.toLowerCase(),nonce:0n};const duplicateSigned=await replaySigner.signTransaction({...encodeRewardAthletePayment(duplicatePlan),...fees});
    const duplicate=await relayerClient.sendRawTransaction({serializedTransaction:duplicateSigned});
    assert.equal((await publicClient.waitForTransactionReceipt({hash:duplicate,timeout:10000})).status,"reverted");await finalize();
    await assert.rejects(readVerifiedRewardAthletePayment(publicClient,duplicatePlan,duplicateSigned,artifact.bytecode.object),{code:"reward_payment_reverted"});
    await assert.rejects(prepare({...input,idempotencyKey:"claim-already-paid"}),{code:"reward_claim_already_paid"});
    assert.deepEqual(await prepare(input,{...deps,reader:{}}),renewed);
    const history=await submitAthleteRewardClaimProof(recipient,{intentId:renewed.intentId,role:"recipient",signature:recipientProof,idempotencyKey:"claim-recipient-consent"},{...deps,reader:{}});
    assert.equal(history.intentId,renewed.intentId,"Retry preserves history after payment, not a new send permission");
    assert.deepEqual(await recordSignedAthleteRewardPayment(identity,{claimIntentId:renewed.intentId,paymentIntentId:storedPayment.payment.paymentIntentId,
      idempotencyKey:"payment-main-attempt",signedTransaction:signed},{...deps,reader:{}}),storedPayment.attempt,
      "An exact attempt retry remains readable after payment without a fresh nonce or RPC");
    let balances=0n;let paidTotal=0n;let budgets=0n;
    for(const campaign of entries){
      const c=await readVerifiedRewardCampaign(publicClient,{...campaign.plan.deployment,deploymentNonce:campaign.plan.nonce,
        deploymentTransactionHash:campaign.attempt.transactionHash},artifact.bytecode.object);
      const a=c.observation.accounting;balances+=a.nativeBalance;paidTotal+=a.paid[0]+a.paid[1];budgets+=campaign.campaign.budgetWei;
      assert.equal(a.nativeBalance+a.paid[0]+a.paid[1],campaign.campaign.budgetWei);
    }
    const clubPaid=BigInt(await scalar("select coalesce(sum((payment_body->>'amount')::numeric),0)::text from app_private.reward_club_payment_confirmations"));
    assert.equal(paidTotal,paid.amount+clubPaid);assert.equal(balances+paidTotal,budgets);
    assert.equal(await count(),5);assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),reserved);
  });
  await scenario("committed source correction and destination withdrawal are rechecked after blocked claim writes; held shares remain reserved",async()=>{
    const next={reviewId:readiness.reviewId,entitlementId:await entitlementFor(entries[1]),idempotencyKey:"claim-corrected-source"};
    const nextIntent=await prepare({...next,idempotencyKey:"claim-proof-corrected-source"});
    const leagueRequest={reviewId:readiness.reviewId,entitlementId:await entitlementFor(entries[5]),idempotencyKey:"claim-payment-source-corrected"};
    const leagueIntent=await approveClaim(await prepare(leagueRequest));const leagueWitness=await observe(leagueRequest);
    const nextProof=await verifyRewardClaimEoaProof(nextIntent.context,nextIntent.claim,"recipient",operator.address,await signer.signTypedData(nextIntent.messages.consent));
    const witness=await observe(next);
    const race=await scalar(`select ec.id from public.event_categories ec join public.league_round_events lre on lre.event_edition_id=ec.event_edition_id
      where lre.id=${literal(entries[1].campaign.roundIds[0])} order by ec.id limit 1`);
    const release=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
      update public.result_rows set finish_time_ms=finish_time_ms+1 where id=(select id from public.result_rows where event_category_id=${literal(race)} and finish_time_ms>0 order by id limit 1)`);
    const changed=assert.rejects(storeRewardAthleteClaimIntent(identity,{...next,witness,observedAt:new Date().toISOString()},rpc),{code:"reward_review_source_changed"});changed.catch(()=>{});
    const changedProof=assert.rejects(storeRewardAthleteClaimProof(recipient,{intentId:nextIntent.intentId,role:"recipient",idempotencyKey:"proof-source-changed",
      proof:nextProof,witness,observedAt:new Date().toISOString()},rpc),{code:"reward_review_source_changed"});changedProof.catch(()=>{});
    const changedPayment=assert.rejects(reserveRewardAthletePaymentIntent(identity,{claimIntentId:leagueIntent.intentId,relayerAddress:chain.relayer.address.toLowerCase(),
      idempotencyKey:"payment-source-changed",observedChainId:31337,pendingNonce:2n,witness:leagueWitness,observedAt:new Date().toISOString()},rpc),{code:"reward_review_source_changed"});changedPayment.catch(()=>{});
    try{await waiting(3);}finally{await release();}await Promise.all([changed,changedProof,changedPayment]);
    const untouched={...next,entitlementId:await entitlementFor(entries[2]),idempotencyKey:"claim-withdrawn-destination"};
    const untouchedIntent=await prepare({...untouched,idempotencyKey:"claim-proof-withdrawn-destination"});
    const untouchedProof=await verifyRewardClaimEoaProof(untouchedIntent.context,untouchedIntent.claim,"recipient",operator.address,await signer.signTypedData(untouchedIntent.messages.consent));
    const current=await observe(untouched);
    const other=storedPayment.additionalPayments.find(p=>p.plan.nonce===2n);assert(other);
    const otherWitness=await readVerifiedRewardAthleteClaim(publicClient,{deployment:other.plan.deployment,upload:other.plan.upload,
      entitlementId:other.plan.claim.entitlementId,recipient:other.plan.claim.recipient},artifact.bytecode.object);
    const otherSigned=await chain.relayer.signTransaction({...encodeRewardAthletePayment(other.plan),...storedPayment.fees,maxFeePerGas:30000000000n});
    const otherAttempt=await verifySignedRewardAthletePayment(other.plan,otherSigned);
    await paymentHolds.beforeWithdrawal();
    const unlock=await lock(`select public.service_withdraw_reward_athlete_destination(${literal(recipient.userId)},${literal(recipient.sessionId)},${literal(destination.requestId)})`);
    const withdrawn=assert.rejects(storeRewardAthleteClaimIntent(identity,{...untouched,witness:current,observedAt:new Date().toISOString()},rpc),{code:"reward_claim_readiness_required"});withdrawn.catch(()=>{});
    const withdrawnProof=assert.rejects(storeRewardAthleteClaimProof(recipient,{intentId:untouchedIntent.intentId,role:"recipient",idempotencyKey:"proof-destination-withdrawn",
      proof:untouchedProof,witness:current,observedAt:new Date().toISOString()},rpc),{code:"reward_claim_readiness_required"});withdrawnProof.catch(()=>{});
    const withdrawnPayment=assert.rejects(storeRewardAthletePaymentAttempt(identity,{claimIntentId:other.claimIntentId,paymentIntentId:other.paymentIntentId,
      idempotencyKey:"payment-destination-withdrawn",attempt:otherAttempt,witness:otherWitness,observedAt:new Date().toISOString()},rpc),{code:"reward_claim_readiness_required"});withdrawnPayment.catch(()=>{});
    try{await waiting(3);}finally{await unlock();}await Promise.all([withdrawn,withdrawnProof,withdrawnPayment]);
    assert.equal((await read(untouched)).reviewContext.reviewState,"request_withdrawn");
    assert.equal(await count(),8);assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_proofs"),8);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_intents"),3);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),reserved);
    assert.equal(await scalar("select count(*) from public.athlete_profiles where slug like 'reward-integration-athlete-%' and not is_claimed"),6);
  });
  try{await paymentHolds.afterWithdrawal();}finally{await paymentHolds.restoreMining();}
}
