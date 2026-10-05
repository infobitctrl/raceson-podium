import {sponsorClubClaimsV4Scenarios} from "./reward-sponsor-club-claims-v4-scenarios.mjs";
import assert from 'node:assert/strict';
import {fixtureSigner} from '../../rewards-chain/integration/owned-chain.mjs';
import {sponsorLifecycleV4} from '../../../apps/api/dist/features/rewards/sponsor-lifecycle-v4-service.js';
import {sponsorClaimV4} from '../../../apps/api/dist/features/rewards/sponsor-claims-v4-service.js';
import {sponsorLifecycleFactsV4,listSponsorClaimsV4} from '../dist/rewards/index.js';
import {prepareAthleteWalletProof,verifyAthleteWalletProof} from '../../../apps/api/dist/features/rewards/athlete-wallet-service.js';
import {submitAthleteRewardDestination} from '../../../apps/api/dist/features/rewards/athlete-destination-service.js';
import {literal as q} from './reward-integration-fixture.mjs';
export async function sponsorLifecycleV4Scenarios({harness,scenario,actor,sponsor,selected,chain,stored,next}){
 const {rpc,query,scalar}=harness,deps={rpc,reader:chain.publicClient,origin:'http://127.0.0.1:3101'},read=()=>sponsorLifecycleV4(actor,selected,undefined,deps);
 let view;
 await scenario('V4 binds actual saved official publication without a fabricated clock; current sources and exact retries required',async()=>{
  view=await read();assert.equal(view.publication,null);assert.equal(view.transaction,null);
  const c={action:'publication',requestId:next(),documentHash:view.publicationHash};
  await assert.rejects(()=>sponsorLifecycleV4(sponsor,selected,c,deps),{code:'reward_planning_not_found'});
  view=await sponsorLifecycleV4(actor,selected,c,deps);assert.equal(view.transaction.action,'stage');
  const again=await sponsorLifecycleV4(actor,selected,c,deps);assert.deepEqual(again.publication,view.publication);
  assert.equal(view.publication.timing.reviewPeriod,'0');assert.equal(view.publication.timing.reviewStartedAt,view.publication.timing.officialPublishedAt);
 });
 await scenario('V4 saved official publication stages and activates exact local awards; wrong transaction hashes cannot be receipts',async()=>{
  for(const action of ['stage','activate']){
   view=await read();assert.equal(view.transaction.action,action);const tx=view.transaction;
   const hash=await chain.operatorClient.sendTransaction({account:stored.execution.plan.operator,to:tx.to,data:tx.data,gas:2000000n});
   assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');await chain.testClient.mine({blocks:96,interval:1});
   const command={action:'receipt',requestId:next(),operation:action,start:tx.start,end:tx.end,transactionHash:hash};
   await assert.rejects(()=>sponsorLifecycleV4(actor,selected,{...command,operation:'upload'},deps));
   view=await sponsorLifecycleV4(actor,selected,command,deps);assert.equal(view.receipts.at(-1).body.transactionHash,hash);
   await sponsorLifecycleV4(actor,selected,command,deps);
  }
  assert.equal(view.pot.state,3);assert.equal(view.transaction,null);assert.ok(BigInt(view.pot.claimDeadline)>0n);
 });
 const who={userId:next(),sessionId:next()},signer=fixtureSigner(0xBEE01),r=stored.recipients.find(r=>r.beneficiaryKind==='athlete'),claimId=next();
 await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${q(who.userId)},'sponsor-claim-v4@example.invalid','authenticated','authenticated','{}','{}',now(),now());
 update public.user_profiles set status='active' where user_id=${q(who.userId)};
 insert into auth.sessions(id,user_id,not_after) values(${q(who.sessionId)},${q(who.userId)},clock_timestamp()+interval '1 hour');
 insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,status,is_claimed,claimed_by_user_id,date_of_birth,birth_year)
 values(${q(r.beneficiaryId)},'synthetic-sponsor-claim-v4','Synthetic','Sponsor claim','Synthetic sponsor claim','active',true,${q(who.userId)},'1990-01-01',1990);`);
 const walletDeps={...deps,chainId:31337};
 const challenge=await prepareAthleteWalletProof(who,{address:signer.address,idempotencyKey:'sponsor-claim-v4-wallet'},walletDeps);
 await verifyAthleteWalletProof(who,{challengeId:challenge.challengeId,signature:await signer.signMessage({message:challenge.message})},walletDeps);
 const destination=await submitAthleteRewardDestination(who,{challengeId:challenge.challengeId,athleteProfileId:r.beneficiaryId,idempotencyKey:'sponsor-claim-v4-destination'},walletDeps);
 const recipient={chainId:31337,claimId,role:'recipient'},operator={...recipient,role:'operator'};let claim;
 await scenario('V4 recipient requests their own reserved award and operator records identity and wallet-readiness attestations',async()=>{
  const own=await listSponsorClaimsV4(who,31337,null,rpc);assert.ok(own.some(a=>a.entitlementId===r.entitlementId));
  const command={action:'request',approvalId:selected.approvalId,entitlementId:r.entitlementId,destinationId:destination.requestId};
  await assert.rejects(()=>sponsorClaimV4(sponsor,recipient,command,deps),{code:'reward_claim_scope_required'});
  await sponsorClaimV4(who,recipient,command,deps);
  claim=await sponsorClaimV4(actor,operator,undefined,deps);assert.equal(claim.status,'awaiting_review');
  const prepare={action:'prepare',sourceStamp:claim.sourceStamp,profileFingerprint:claim.profileFingerprint,attestation:{schemaVersion:1,policy:'operator-observed-external-wallet-v1',verifiedDateOfBirth:'1990-01-01',identityEvidenceRef:next(),adultEvidenceRef:next(),walletMfaEvidenceRef:next(),walletRecoveryEvidenceRef:next()}};
  claim=await sponsorClaimV4(actor,operator,prepare,deps);assert.equal(claim.status,'awaiting_consent');assert.equal(claim.signing,null);
  await sponsorClaimV4(actor,operator,prepare,deps);
 });
 await scenario('V4 consent uses version 5, rejects another signer and permits operator signature only after actual recipient consent',async()=>{
  claim=await sponsorClaimV4(who,recipient,undefined,deps);assert.equal(claim.signing.domain.version,'5');
  const raw=claim.signing,typed={...raw,message:Object.fromEntries(Object.entries(raw.message).map(([k,v])=>[k,['amount','pot','nonce','issuedAt','expiresAt'].includes(k)?BigInt(v):v]))};
  await assert.rejects(async()=>sponsorClaimV4(who,recipient,{action:'recipient',signature:await chain.operator.signTypedData(typed)},deps));
  const signature=await signer.signTypedData(typed);await sponsorClaimV4(who,recipient,{action:'recipient',signature},deps);
  await sponsorClaimV4(who,recipient,{action:'recipient',signature},deps);
  claim=await sponsorClaimV4(actor,operator,undefined,deps);assert.equal(claim.status,'awaiting_operator');
  const op=claim.signing,ot={...op,message:Object.fromEntries(Object.entries(op.message).map(([k,v])=>[k,['nonce','issuedAt','expiresAt'].includes(k)?BigInt(v):v]))};
  claim=await sponsorClaimV4(actor,operator,{action:'operator',signature:await chain.operator.signTypedData(ot)},deps);assert.equal(claim.status,'ready_to_pay');
 });
 await scenario('V4 claim rejects a revoked recipient session',async()=>{
  await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(who.sessionId)};`);
  await assert.rejects(()=>sponsorClaimV4(who,recipient,undefined,deps),{code:'reward_account_session_required'});
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(who.sessionId)};`);
 });
 await scenario('V4 exact synthetic claim pays once and persists canonical finalized receipt; other recipients remain reserved',async()=>{
  claim=await sponsorClaimV4(actor,operator,undefined,deps);const tx=claim.transaction;
  const before=await chain.publicClient.getBalance({address:signer.address});
  const hash=await chain.operatorClient.sendTransaction({to:tx.to,data:tx.data,gas:2000000n});assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});claim=await sponsorClaimV4(actor,operator,{action:'receipt',transactionHash:hash},deps);
  assert.equal(claim.status,'paid');assert.equal(claim.transaction,null);assert.equal(claim.signing,null);
  assert.equal(await chain.publicClient.getBalance({address:signer.address})-before,r.amountWei);
  assert.equal((await sponsorClaimV4(who,recipient,undefined,deps)).receipt.transactionHash,hash);
  assert.equal((await read()).pot.paidWei,r.amountWei.toString());
 });
 await scenario('V4 wallet withdrawal preserves payment history while removing current authorization',async()=>{
  await query(`insert into app_private.reward_athlete_destination_withdrawals(request_id,session_id) values(${q(destination.requestId)},${q(who.sessionId)});`);
  const held=await sponsorClaimV4(actor,operator,undefined,deps);assert.equal(held.current,false);assert.equal(held.transaction,null);assert.equal(held.status,'paid');
 });
 await sponsorClubClaimsV4Scenarios({harness,scenario,actor,sponsor,selected,chain,stored,next});
 await scenario('V4 lifecycle and claim tables reject browser grants and mutation',async()=>{
  for(const name of ['reward_sponsor_lifecycle_v4','reward_sponsor_claims_v4','reward_sponsor_claim_events_v4']){
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${name}','SELECT,INSERT,UPDATE,DELETE')`),false);
   await assert.rejects(()=>query(`delete from app_private.${name}`),/reward_result_review_immutable/);
  }
 });
}
