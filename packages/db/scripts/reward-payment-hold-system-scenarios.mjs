import assert from "node:assert/strict";
import { TransactionNotFoundError } from "viem";
import { runAthleteRewardPaymentJob } from "../../../apps/api/dist/features/rewards/athlete-payment-worker.js";
import { readRewardAthletePaymentJob } from "../dist/rewards/index.js";
import { readVerifiedRewardCampaign } from "../../rewards-chain/dist/index.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

// Coordinates with the parent scenario's real, committed destination withdrawal.
// No real identity, wallet, remote database or public-chain signer is accepted.
export function paymentHoldSystemScenarios({harness,scenario,chain,identity,deps,paymentJobs,programmeId,entries,finalize}){
  const {query,scalar,rpc,lock,waiting}=harness;const {publicClient,testClient,relayerClient,artifact}=chain;
  const pending=paymentJobs.additionalJobs.find(p=>p.payment.plan.nonce===1n);
  const unsent=paymentJobs.additionalJobs.find(p=>p.payment.plan.nonce===2n);assert(pending&&unsent);
  let sends=0;const workerId=id(99421);const config={...deps,gasPolicy:paymentJobs.gasPolicy,broadcast:async signed=>{
    assert.equal(signed,pending.signed,"Only the originally authorized pending attempt may be released");sends++;
    return relayerClient.sendRawTransaction({serializedTransaction:signed});
  }};
  const run=(entry=pending,options={})=>runAthleteRewardPaymentJob(identity,{jobId:entry.job.jobId,workerId},{...config,...options});
  const read=entry=>readRewardAthletePaymentJob(identity,{jobId:entry.job.jobId},rpc);
  return{
    async beforeWithdrawal(){
      await testClient.setAutomine(false);
      assert.equal((await run()).outcome,"submitted");assert.equal(sends,1);
      assert.equal((await read(pending)).mayHaveBroadcast,true);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_confirmations"),1);
    },
    async afterWithdrawal(){
      await scenario("destination withdrawal stops new payment sends but preserves exact pending and mined history",async()=>{
        try{
          assert.equal((await run()).outcome,"pending");assert.equal(sends,1);
          const hidden={...publicClient,getTransaction:async args=>{
            if(args.hash===pending.job.transactionHash)throw new TransactionNotFoundError({hash:args.hash});return publicClient.getTransaction(args);
          }};
          assert.equal((await run(pending,{reader:hidden})).outcome,"not_ready");assert.equal(sends,1);
        }finally{await testClient.setAutomine(true);}
        await testClient.mine({blocks:1});
        const receipt=await publicClient.waitForTransactionReceipt({hash:pending.job.transactionHash,timeout:10000});assert.equal(receipt.status,"success");await finalize();
        // Expiration commits while exact mined-confirmation persistence waits.
        // No paid projection may be inserted using that expired actual session.
        let observedDenial=null;
        const expiredRpc=async(name,args)=>{
          if(name!=="service_confirm_reward_athlete_payment_job")return rpc(name,args);
          const release=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
            update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
          const response=rpc(name,args);response.catch(()=>{});
          try{await waiting(1);}finally{await release();}
          const result=await response;observedDenial=result.error?.message;return result;
        };
        assert.equal((await run(pending,{rpc:expiredRpc})).outcome,"unavailable");assert.equal(observedDenial,"reward_account_session_required");
        assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_confirmations"),1);
        await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
        // Current source changes also cannot make already-mined history vanish.
        const race=await scalar(`select ec.id from public.event_categories ec join public.league_round_events lre on lre.event_edition_id=ec.event_edition_id
          join app_private.reward_campaigns c on lre.id=any(c.round_ids) where c.id=${literal(pending.job.campaignId)} order by ec.id limit 1`);
        await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=(select id from public.result_rows where event_category_id=${literal(race)} and finish_time_ms>0 order by id limit 1)`);
        assert.equal((await run()).outcome,"confirmed");assert.equal((await read(pending)).state,"confirmed");
        assert.equal((await run(unsent)).outcome,"not_ready");assert.equal((await read(unsent)).mayHaveBroadcast,false);assert.equal(sends,1);
        assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_confirmations"),2);
        assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where athlete_payment_intent_id is not null"),3);
        assert.equal(await publicClient.getTransactionCount({address:chain.relayer.address}),2);
        let paid=0n;let total=0n;
        for(const e of entries){
          const c=await readVerifiedRewardCampaign(publicClient,{...e.plan.deployment,deploymentNonce:e.plan.nonce,deploymentTransactionHash:e.attempt.transactionHash},artifact.bytecode.object);
          const a=c.observation.accounting;const campaignPaid=a.paid[0]+a.paid[1];paid+=campaignPaid;total+=a.nativeBalance+campaignPaid;
          assert.equal(a.nativeBalance+campaignPaid,e.campaign.budgetWei);
        }
        const confirmed=BigInt(await scalar(`select sum(app_private.reward_confirmed_campaign_payments(id))::text from app_private.reward_campaigns where programme_id=${literal(programmeId)}`));
        assert.equal(paid,confirmed);assert.equal(total,entries.reduce((sum,e)=>sum+e.campaign.budgetWei,0n));
        assert.equal(await publicClient.getTransactionCount({address:pending.payment.plan.claim.recipient}),0);
      });
    },
    async restoreMining(){await testClient.setAutomine(true);},
  };
}
