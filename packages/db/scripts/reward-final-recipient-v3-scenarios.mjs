import assert from 'node:assert/strict';
import { athleteClaimsV3Scenarios } from './reward-athlete-claims-v3-scenarios.mjs';
import { clubReadinessV3Scenarios } from './reward-club-readiness-v3-scenarios.mjs';
import { rewardCampaignV3Abi } from '../../rewards-chain/dist/campaign-v3.js';
import { literal as q } from './reward-integration-fixture.mjs';

// Both SQL and chain are owned by this validator. Roll them back together so
// synthetic recipient ownership and payments never reach the saved demo.
export async function finalRecipientV3Scenarios({harness,scenario,fixture,reader,chain,operator,requests,packages,uploads}) {
  assert.equal(await reader.getChainId(),31337);
  const sourceHoldSql="update public.result_rows set finish_time_ms=finish_time_ms+1 where id='8c000000-0000-4000-8000-000000983021';";
  for(const slot of [5,6]) await scenario(`final slot ${slot} joins native-source readiness, actual consent, private signing and exactly-once payment`,async()=>{
    const snapshot=await chain.testClient.snapshot(),p=packages[slot];
    const paid=()=>reader.readContract({address:p.campaignAddress,abi:rewardCampaignV3Abi,functionName:'paid',args:[p.enabledPot]});
    assert.equal(await paid(),0n);
    try{
      await harness.rollbackFixture(async({query,rpc})=>clubReadinessV3Scenarios({query,rpc,
        scope:{chainId:31337,draftId:fixture.draftId,slot,approvalId:requests[slot].requestId,uploadId:uploads[slot].requestId},
        operatorIdentity:fixture.identity,sourceHoldSql,expectNoClubAward:slot===5,runtime:{reader,chain,operator}}));
      await harness.rollbackFixture(async({query,rpc})=>{
        const current=JSON.parse(await query(`select app_private.reward_recipient_source_v3(${q(uploads[slot].requestId)});`));
        assert.equal(current.current,true,'Final recipient and organizer source commitments must agree');
        assert.equal(current.slot,slot);
        // The private subject projection is not directly callable by browser roles.
        for(const role of ['anon','authenticated']) assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}',
          'app_private.reward_final_recipient_source_v3(uuid)','execute'));`)),false);
        await athleteClaimsV3Scenarios({query,rpc,scope:{chainId:31337,draftId:fixture.draftId,slot,
          approvalId:requests[slot].requestId,uploadId:uploads[slot].requestId},identity:fixture.identity,
          runtime:{reader,test:chain.testClient,operator},finalFixture:true,sourceHoldSql});
        assert.ok(await paid()>0n);
        assert.equal(await reader.readContract({address:p.campaignAddress,abi:rewardCampaignV3Abi,functionName:'paid',args:[1-p.enabledPot]}),0n);
      });
    }finally{await chain.testClient.revert({id:snapshot});}
    assert.equal(await paid(),0n);
    assert.equal(await harness.scalar('select count(*) from app_private.reward_athlete_claims_v3'),0);
    assert.equal(await harness.scalar('select count(*) from app_private.reward_athlete_payment_receipts_v3'),0);
  });
}
