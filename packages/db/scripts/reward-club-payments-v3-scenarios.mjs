import assert from "node:assert/strict";
import { parseEther } from "viem";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { encodeRewardProgrammeClubPaymentV3 } from "../../rewards-chain/dist/index.js";
import { clubPaymentLedgerV3,readClubPaymentStatusV3,listRewardClubAllocationsV3,copyRewardLedgerDocument as copy,createClubPaymentSigningClientV3,createClubPaymentOperatorClientV3 } from "../dist/rewards/index.js";
import { prepareClubPaymentV3,loadClubPaymentV3,recordClubPaymentAttemptV3,queueClubPaymentV3 } from "../../../apps/api/dist/features/rewards/club-payment-v3-service.js";
import { runClubPaymentJobV3 } from "../../../apps/api/dist/features/rewards/club-payment-worker-v3.js";
import { inspectClubPaymentSigningV3,signClubPaymentV3 } from "../../../apps/api/dist/features/rewards/club-payment-signing-v3.js";
import { runAuthenticatedClubPaymentOperatorV3 } from "../../../apps/api/dist/features/rewards/club-payment-operator-v3.js";
import { programmeOperatorAuthFixtureV3 } from "../../../apps/api/test/fixtures/reward-programme-operator-v3.mjs";
import { dispatchClubPaymentActionsV3 } from "../../../apps/api/dist/routes/rewards/club-payment-actions-v3.js";
import { dispatchClubClaimsV3 } from "../../../apps/api/dist/routes/rewards/club-claims-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id=n=>`8fb00000-0000-4000-8000-${String(n).padStart(12,"0")}`;

// SQL and chain snapshots belong to this disposable fixture only.
export async function clubPaymentsV3Scenarios({query,rpc,scope,operator,owner,other,runtime,deps,sourceHoldSql,draftId}){
  const s={...scope,paymentId:id(1)},attemptId=id(2),jobId=id(3),workerId=id(4),relayer=fixtureSigner(0xFEED72);
  const options={...deps,rpc,chainId:31337,origin:"http://127.0.0.1:3101"};
  const chain=runtime.chain,reader=runtime.reader,snapshot=await chain.testClient.snapshot();
  await query("savepoint club_payment_fixture;");
  try{
    await chain.testClient.setBalance({address:relayer.address,value:parseEther("5")});
    const fees={gasLimit:"600000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"0",maxGasCostWei:"18000000000000000"};
    const denied=async(code,fn)=>{await query("savepoint club_payment_denied;");try{await assert.rejects(fn,code?{code}:undefined);}
      finally{await query("rollback to savepoint club_payment_denied;");}};
    const held=async fn=>{await query(`savepoint club_payment_held;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`}`);
      try{await fn();}finally{await query("rollback to savepoint club_payment_held;");}};
    const own=()=>readClubPaymentStatusV3(owner,{...scope,role:"recipient"},rpc);
    const clubId=JSON.parse(await query(`select to_jsonb(club_id) from app_private.reward_club_treasury_requests where id=${q(scope.requestId)};`));
    const discover=async(who=owner)=>(await listRewardClubAllocationsV3(who,{chainId:31337,clubId},rpc)).items.find(a=>a.entitlementId===s.entitlementId);
    const discovered=await discover();assert.equal(discovered.claimAccess,"available");assert.equal(discovered.claim.claimId,s.claimId);
    assert.equal(discovered.claim.recipientConsented,true);assert.equal(discovered.claim.operatorApproved,true);assert.equal(discovered.payment,null);
    const read=()=>clubPaymentLedgerV3(operator,s,undefined,rpc);
    const http=async(who,body,status=false)=>{
      const res={headers:{}},base=`${options.origin}/api/v1/${status?"club":"organizer"}/rewards/uploads/${s.uploadId}/club-treasuries/${s.requestId}/awards/${s.entitlementId}/claims/${s.claimId}`;
      const dispatch=status?dispatchClubClaimsV3:dispatchClubPaymentActionsV3;
      await query("savepoint club_payment_http;");
      assert.equal(await dispatch({method:body===undefined?"GET":"POST"},res,new URL(`${base}/${status?"payment":`payment-actions/${s.paymentId}`}`),{
        config:()=>options,requireIdentity:async()=>who,readJsonBody:async()=>body,rpc,clubPaymentReaderV3:reader,
        applyPrivateSessionHeaders:r=>r.headers["Cache-Control"]="private, no-store",
        sendSuccess:(r,data)=>{r.status=200;r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={code};}
      }),true);
      if(res.status!==200)await query("rollback to savepoint club_payment_http;");
      assert.match(res.headers["Cache-Control"],/no-store/);
      assert.doesNotMatch(JSON.stringify(res),/signature|signedTransaction|sessionId|leaseToken|EvidenceRef|privateKey/);return res;
    };
    assert.equal((await own()).state,"not_prepared");
    assert.equal((await http(other)).status,404);assert.equal((await http(owner)).status,404);
    assert.equal((await http(other,undefined,true)).status,404);
    const before=await read(),claim=before.claimContext.intent;
    const prepare={kind:"prepare",recipientAddress:claim.recipientAddress,amountWei:claim.witness.amountWei.toString(),relayerAddress:relayer.address.toLowerCase(),fees};
    assert.equal((await http(operator,{...prepare,amountWei:"1"})).status,409);
    assert.equal((await http(operator,{...prepare,nonce:"0"})).status,400);
    await held(()=>denied("reward_claim_readiness_required",()=>prepareClubPaymentV3(operator,{...s,...prepare},options)));
    assert.equal((await http(operator,prepare)).body.state,"prepared");
    assert.equal((await discover()).payment.state,"prepared");assert.equal((await discover()).payment.transactionHash,null);
    const prepared=await prepareClubPaymentV3(operator,{...s,...prepare},options);
    assert.deepEqual(await prepareClubPaymentV3(operator,{...s,...prepare},options),prepared);
    await denied("reward_payment_conflict",()=>prepareClubPaymentV3(operator,{...s,...prepare,fees:{...fees,gasLimit:"599999"}},options));
    const loaded=await loadClubPaymentV3(operator,s,options),nonce=loaded.plan.nonce;
    assert.equal(nonce,0n);assert.equal(loaded.plan.expectation.award.beneficiaryKind,1);
    assert.equal(JSON.parse(await query(`select to_jsonb(count(*)) from app_private.reward_relayer_nonce_slots where club_payment_v3_id=${q(s.paymentId)};`)),1);
    const signedTransaction=await relayer.signTransaction({...encodeRewardProgrammeClubPaymentV3(loaded.plan),type:"eip1559",
      gas:BigInt(fees.gasLimit),maxFeePerGas:BigInt(fees.maxFeePerGas),maxPriorityFeePerGas:0n});
    const signed={...s,attemptId,signedTransaction};
    await held(()=>denied("reward_claim_readiness_required",()=>recordClubPaymentAttemptV3(operator,signed,options)));
    // Actual SDK JWT verification plus rollback-only SQL, not a hosted login.
    const signingAuth=programmeOperatorAuthFixtureV3(operator,rpc,createClubPaymentSigningClientV3),controller=new AbortController();
    const signingClient=signingAuth.clientFactory({target:signingAuth.target,...signingAuth.credentials,signal:controller.signal});
    const signingIdentity=(await signingClient.authenticate(signingAuth.credentials.accessToken,operator.userId)).identity;
    const signingDeps={...options,rpc:signingClient.rpc},signingScope={...s,attemptId};
    const inspected=await inspectClubPaymentSigningV3(signingIdentity,signingScope,signingDeps);
    assert.equal(inspected.recorded,false);assert.equal(inspected.plan.recipientAddress,prepare.recipientAddress);
    assert.equal(inspected.plan.amountWei,prepare.amountWei);assert.equal(inspected.plan.treasuryReviewId,claim.reviewId);
    assert.equal(inspected.plan.safeExecutionNonce,claim.witness.treasury.executionNonce.toString());
    assert.equal(inspected.plan.wrappedRecipientDigest,before.claimContext.proofs.find(p=>p.role==="recipient").proof.wrappedDigest);
    assert.deepEqual(inspected.plan.consentCheckpoint,{number:loaded.plan.consentCheckpoint.number.toString(),hash:loaded.plan.consentCheckpoint.hash,
      timestamp:loaded.plan.consentCheckpoint.timestamp.toString()});
    assert.doesNotMatch(JSON.stringify(inspected),/signature|signedTransaction|sessionId/);
    let keyReads=0,signs=0;
    const loadSigner=async()=>{keyReads++;return{address:relayer.address,signTransaction:async tx=>{signs++;return relayer.signTransaction(tx);}};};
    const signRequest={...signingScope,planHash:inspected.plan.planHash},signOptions={...signingDeps,signal:controller.signal,loadSigner};
    await assert.rejects(signClubPaymentV3(signingIdentity,{...signRequest,planHash:"0x"+"a".repeat(64)},signOptions),/reward_payment_signing_plan_changed/);
    assert.equal(keyReads,0);
    await assert.rejects(signClubPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{throw Error("private-key-sentinel");}}),
      {message:"reward_payment_signer_unavailable"});
    await assert.rejects(signClubPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>({address:runtime.operator.address,signTransaction:()=>assert.fail("no signing")})}),
      /reward_payment_signer_mismatch/);
    const cancelSigning=new AbortController();
    await assert.rejects(signClubPaymentV3(signingIdentity,signRequest,{...signOptions,signal:cancelSigning.signal,
      loadSigner:async()=>{cancelSigning.abort();return relayer;}}),/reward_payment_signing_stopped/);
    await denied("reward_claim_readiness_required",()=>signClubPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{
      await query(sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`);return relayer;}}));
    await denied("reward_account_session_required",()=>signClubPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{
      await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operator.sessionId)};`);return relayer;}}));
    assert.equal(signs,0);
    const stored=await signClubPaymentV3(signingIdentity,signRequest,signOptions);assert.equal(stored.state,"signed");assert.equal(keyReads,1);assert.equal(signs,1);
    assert.equal((await discover()).payment.state,"signed");assert.equal((await discover()).payment.transactionHash,stored.transactionHash);
    assert.deepEqual(await signClubPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:()=>assert.fail("no retry key read")}),stored);
    assert.equal((await inspectClubPaymentSigningV3(signingIdentity,signingScope,signingDeps)).plan.planHash,inspected.plan.planHash);
    controller.abort();
    assert.deepEqual(await recordClubPaymentAttemptV3(operator,signed,options),stored);
    const attempt=(await read()).attempt,body=copy(attempt.body);
    assert.equal(body.wrappedRecipientDigest,before.claimContext.proofs.find(p=>p.role==="recipient").proof.wrappedDigest);
    await denied("reward_payment_conflict",()=>recordClubPaymentAttemptV3(operator,{...signed,attemptId:id(9)},options));
    const queue={...s,jobId,attemptId};
    await held(()=>denied("reward_claim_readiness_required",()=>queueClubPaymentV3(operator,queue,options)));
    const queueBody={kind:"queue",jobId,attemptId,transactionHash:stored.transactionHash};
    assert.equal((await http(operator,{...queueBody,transactionHash:"0x"+"a".repeat(64)})).status,409);
    assert.equal((await http(operator,queueBody)).body.state,"queued");
    assert.deepEqual(await queueClubPaymentV3(operator,queue,options),await queueClubPaymentV3(operator,queue,options));
    assert.equal((await own()).state,"queued");assert.equal((await own()).confirmed,false);
    assert.equal((await discover()).payment.state,"queued");assert.equal((await discover()).payment.confirmed,false);
    let sends=0;
    const broadcast=async bytes=>{sends++;assert.equal(bytes,signedTransaction);
      await reader.sendRawTransaction({serializedTransaction:bytes});throw Error("synthetic_lost_club_payment_reply");};
    const work=(extra={})=>runClubPaymentJobV3(operator,{...s,jobId,workerId},{...options,broadcast,...extra});
    const aborted=new AbortController();aborted.abort();assert.equal((await work({signal:aborted.signal})).outcome,"cancelled");
    await held(async()=>{assert.equal((await work()).outcome,"held");assert.equal(sends,0);});
    const payload={jobId,workerId,leaseToken:null,execution:null,receipt:null,observedAt:null};
    const lease=await clubPaymentLedgerV3(operator,s,{action:"lease",payload},rpc);
    assert.equal(await clubPaymentLedgerV3(operator,s,{action:"lease",payload:{...payload,workerId:id(5)}},rpc),null);
    for(const kind of ["athlete","club","athlete-v3"])
      assert.equal(JSON.parse(await query(`select to_jsonb(app_private.reward_relayer_lane_busy(31337,${q(relayer.address.toLowerCase())},${q(kind)},${q(id(8))}));`)),true);
    assert.equal(JSON.parse(await query(`select to_jsonb(app_private.reward_relayer_lane_busy(31337,${q(relayer.address.toLowerCase())},'club-v3',${q(jobId)}));`)),false);
    await denied("reward_payment_lease_lost",()=>clubPaymentLedgerV3(operator,s,{action:"submitted",payload:{...payload,leaseToken:id(9)}},rpc));
    await denied("invalid_reward_payment_v3",()=>clubPaymentLedgerV3(operator,s,{action:"confirm",payload:{...payload,leaseToken:lease.job.leaseToken,receipt:{payment:{},accounting:{}}}},rpc));
    // A late session loss must roll back the arm and prevent any broadcast.
    await query("savepoint club_payment_late_auth;");
    let changed=false;
    const lateReader={...reader,getChainId:async()=>{if(!changed){changed=true;await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operator.sessionId)};`);}return 31337;}};
    await denied("reward_account_session_required",()=>work({reader:lateReader}));
    await query("rollback to savepoint club_payment_late_auth;");assert.equal(sends,0);
    const cancel=new AbortController(),cancelRpc=async(name,args)=>{const r=await rpc(name,args);
      if(name==="service_change_reward_club_payment_v3" && args.p_action==="arm" && !r.error)cancel.abort();return r;};
    assert.equal((await work({rpc:cancelRpc,signal:cancel.signal})).outcome,"cancelled");assert.equal(sends,0);
    assert.equal((await read()).job.mayHaveBroadcast,true);
    const unavailable={...reader,getTransaction:async()=>{throw Error("unavailable");}};
    assert.equal((await work({reader:unavailable})).outcome,"unavailable");assert.equal(sends,0);
    const auth=programmeOperatorAuthFixtureV3(operator,rpc,createClubPaymentOperatorClientV3);
    const operatorInput={target:auth.target,...auth.credentials,draftId,
      programmeAddress:loaded.plan.expectation.programme.context.verifyingContract.toLowerCase(),
      operatorAddress:loaded.plan.expectation.programme.operatorAddress.toLowerCase(),relayerAddress:relayer.address.toLowerCase(),
      operatorUserId:operator.userId,workerId,durationMs:60000,maxGasCostWei:BigInt(fees.maxGasCostWei),maxPayoutWei:claim.witness.amountWei,
      jobs:[{uploadId:s.uploadId,requestId:s.requestId,entitlementId:s.entitlementId,claimId:s.claimId,paymentId:s.paymentId,attemptId,jobId,
        transactionHash:stored.transactionHash,recipientAddress:claim.recipientAddress,amountWei:claim.witness.amountWei.toString()}]};
    const deliver=(patch={})=>runAuthenticatedClubPaymentOperatorV3({...operatorInput,...patch},{reader,broadcast},auth.clientFactory);
    const eventCount=()=>query(`select count(*) from app_private.reward_club_payment_events_v3 where job_id=${q(jobId)};`),eventsBefore=await eventCount();
    for(const patch of [{maxGasCostWei:BigInt(fees.maxGasCostWei)-1n},{maxPayoutWei:claim.witness.amountWei-1n},
      {programmeAddress:'0x'+'a'.repeat(40)},{jobs:[{...operatorInput.jobs[0],amountWei:(claim.witness.amountWei+1n).toString()}]},
      {jobs:[{...operatorInput.jobs[0],attemptId:id(99)}]}]){
      const r=await deliver(patch);assert.equal(r.stop,"attention_required");assert.equal(r.entries.length,0);assert.equal(sends,0);
    }
    assert.equal(await eventCount(),eventsBefore);
    const balance=await reader.getBalance({address:claim.recipientAddress});
    const sent=await deliver();assert.equal(sent.stop,"deferred");assert.equal(sent.entries[0].outcome,"broadcast_unknown");assert.equal(sends,1);
    assert.equal(sent.verifiedPayoutWei,claim.witness.amountWei.toString());assert.equal(sent.verifiedGasCeilingWei,fees.maxGasCostWei);
    assert.doesNotMatch(JSON.stringify(sent),/accessToken|serverKey|sessionId|signedTransaction|signature|sb_secret/);
    const receipt=await reader.waitForTransactionReceipt({hash:stored.transactionHash});assert.equal(receipt.status,"success");
    await chain.testClient.mine({blocks:96,interval:1});
    await held(async()=>{
      assert.equal((await deliver()).stop,"jobs_confirmed");
      const paid=await read(),status=await own();
      assert.equal(paid.receipt.payment.safeReceivedLogIndex,paid.receipt.payment.logIndex+1);
      assert.equal(status.confirmed,true);assert.equal(status.readinessHeld,true);assert.equal(status.transactionHash,stored.transactionHash);
      assert.equal((await http(owner,undefined,true)).body.confirmed,true);
      const item=await discover();assert.equal(item.payment.state,"confirmed");assert.equal(item.payment.confirmed,true);
      assert.equal(item.payment.transactionHash,stored.transactionHash);assert.equal(item.payment.blockNumber,receipt.blockNumber.toString());
    });
    // Rollback above removed only SQL confirmation; recover the same receipt again.
    assert.equal((await deliver()).stop,"jobs_confirmed");assert.equal(sends,1);
    assert.equal(await reader.getBalance({address:claim.recipientAddress}),balance+claim.witness.amountWei);
    assert.equal(await reader.getTransactionCount({address:relayer.address}),Number(nonce)+1);
    assert.equal((await own()).readinessHeld,false);assert.equal((await own()).blockNumber,receipt.blockNumber.toString());
    const history=await discover();
    await query(`savepoint club_paid_owner;update public.athlete_profiles set claimed_by_user_id=${q(other.userId)}
      where claimed_by_user_id=${q(owner.userId)} and id in(select athlete_profile_id from public.club_memberships where club_id=${q(clubId)});`);
    await denied("reward_club_owner_required",()=>discover());
    const successor=await discover(other);assert.equal(successor.claimAccess,"organizer_required");assert.equal(successor.claim,null);
    assert.deepEqual(successor.payment,history.payment);
    assert.doesNotMatch(JSON.stringify(successor),/claimId|requestId|ownerIdentity|sessionId|signature|signedTransaction|leaseToken|jobId/);
    await query("rollback to savepoint club_paid_owner;");
    await query(`savepoint club_paid_revision;insert into app_private.reward_allocation_approvals_v3
      (id,draft_id,slot,previous_approval_id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id)
      select ${q(id(90))},draft_id,slot,id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id
      from app_private.reward_allocation_approvals_v3 where id=${q(history.approvalId)};`);
    const old=await discover();assert.equal(old.allocationRevision,"superseded");assert.deepEqual(old.payment,history.payment);
    await query("rollback to savepoint club_paid_revision;");
    assert.equal((await work({reader:{},broadcast:()=>assert.fail("no confirmed resend")})).outcome,"confirmed");
    for(const table of ["reward_club_payments_v3","reward_club_payment_attempts_v3","reward_club_payment_receipts_v3","reward_club_payment_events_v3"])
      await denied("reward_ledger_is_immutable",()=>query(`delete from app_private.${table};`));
    for(const role of ["anon","authenticated"]){
      for(const table of ["reward_club_payments_v3","reward_club_payment_attempts_v3","reward_club_payment_jobs_v3","reward_club_payment_receipts_v3","reward_club_payment_events_v3"])
        assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
      assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_change_reward_club_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,jsonb)','EXECUTE'));`)),false);
    }
    await query(`savepoint club_payment_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(owner.sessionId)};`);
    await denied("reward_account_session_required",()=>own());await query("rollback to savepoint club_payment_session;");
  }finally{
    await query("rollback to savepoint club_payment_fixture;");
    await chain.testClient.revert({id:snapshot});
  }
}
