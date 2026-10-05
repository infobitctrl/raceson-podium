import assert from 'node:assert/strict';
import {sponsorClubClaimV4} from '../../../apps/api/dist/features/rewards/sponsor-club-claims-v4-service.js';
import {requestRewardClubTreasury,listSponsorClubClaimsV4,sponsorClubClaimFactsV4} from '../dist/rewards/index.js';
import {deployOriginalClubSafeFixture} from '../../rewards-chain/integration/safe-deployment-fixture.mjs';
import {safeRewardConsentMessageV3} from '../../rewards-chain/dist/campaign-v3.js';
import {sponsorClaimMessagesV4} from '../../rewards-chain/dist/sponsor-claims-v4.js';
import {literal as q} from './reward-integration-fixture.mjs';
// Dedicated synthetic records in the parent validator's scratch database and chain.
export async function sponsorClubClaimsV4Scenarios({harness,scenario,actor,sponsor,selected,chain,stored,next}){
 const {rpc,query,scalar}=harness,deps={rpc,reader:chain.publicClient},owner={userId:next(),sessionId:next()},profileId=next();
 const award=stored.recipients.find(r=>r.beneficiaryKind==='club');assert.ok(award,'club allocation required');
 await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${q(owner.userId)},'sponsor-club-v4@example.invalid','authenticated','authenticated','{}','{}',now(),now());
 update public.user_profiles set status='active' where user_id=${q(owner.userId)};
 insert into auth.sessions(id,user_id,not_after) values(${q(owner.sessionId)},${q(owner.userId)},clock_timestamp()+interval '1 hour');
 insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id) values(${q(profileId)},'sponsor-club-v4-owner','Synthetic','Club owner','Synthetic club owner',1990,'active',true,${q(owner.userId)});
 insert into public.clubs(id,slug,name,status) values(${q(award.beneficiaryId)},'sponsor-club-v4','Synthetic sponsor club V4','active');
 insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id) select ${q(next())},${q(award.beneficiaryId)},${q(profileId)},'active',id from public.club_roles where club_id=${q(award.beneficiaryId)} and is_owner;`);
 const safe=await deployOriginalClubSafeFixture(chain);await chain.testClient.mine({blocks:96,interval:1});
 const c=safe.expected,candidate={safeAddress:c.context.verifyingContract.toLowerCase(),singletonAddress:c.singletonAddress.toLowerCase(),fallbackHandlerAddress:c.fallbackHandlerAddress.toLowerCase(),owners:c.owners.map(a=>a.toLowerCase()).sort()};
 const nomination=await requestRewardClubTreasury(owner,31337,{clubId:award.beneficiaryId,candidate,idempotencyKey:'sponsor-club-v4-treasury'},rpc);
 const claimId=next(),recipient={chainId:31337,claimId,role:'recipient'},operator={...recipient,role:'operator'};let view;
 await scenario('V4 club request is bound to current club owner and nominated Safe; direct RPC rejects foreign reads and consent',async()=>{
  const own=await listSponsorClubClaimsV4(owner,31337,null,rpc);assert.ok(own.some(a=>a.entitlementId===award.entitlementId));
  view=await sponsorClubClaimV4(owner,recipient,{action:'request',approvalId:selected.approvalId,entitlementId:award.entitlementId,requestId:nomination.requestId},deps);
  assert.equal(view.status,'awaiting_review');assert.equal(view.transaction,null);
  for(const action of [null,'recipient']){const result=await rpc('service_sponsor_club_claim_v4',{p_actor_user_id:sponsor.userId,p_actor_session_id:sponsor.sessionId,p_chain_id:31337,p_claim_id:claimId,p_role:'recipient',p_action:action,p_body_text:action?'{}':null});assert.equal(result.error?.message,'reward_claim_scope_required');}
  await assert.rejects(()=>sponsorClubClaimV4(owner,{...recipient,chainId:10143},undefined,deps),{code:'reward_claim_scope_required'});
 });
 await scenario('V4 club readiness uses trusted finalized original-Safe provenance and explicit human reviews',async()=>{
  view=await sponsorClubClaimV4(actor,operator,undefined,deps);
  const prepare={action:'prepare',sourceStamp:view.sourceStamp,profileFingerprint:view.profileFingerprint,attestation:{factoryAddress:safe.provenance.factoryAddress.toLowerCase(),deploymentTransactionHash:safe.provenance.deploymentTransactionHash,
   authorityEvidenceRef:next(),controlEvidenceRef:next(),recoveryEvidenceRef:next(),executionHistoryEvidenceRef:next()}};
  await assert.rejects(()=>sponsorClubClaimV4(actor,operator,{...prepare,attestation:{...prepare.attestation,authorityEvidenceRef:''}},deps));
  view=await sponsorClubClaimV4(actor,operator,prepare,deps);assert.equal(view.status,'awaiting_consent');assert.equal(view.signing,null);
  await sponsorClubClaimV4(actor,operator,prepare,deps);
 });
 await scenario('V4 club requires two real synthetic Safe owner signatures; one owner and wrong-domain consent cannot authorize payout',async()=>{
  view=await sponsorClubClaimV4(owner,recipient,undefined,deps);const owners=[...chain.clubOwners].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0,2);
  const signatures=await Promise.all(owners.map(owner=>owner.signTypedData(view.signing)));
  await assert.rejects(()=>sponsorClubClaimV4(owner,recipient,{action:'recipient',signature:signatures[0]},deps));
  const raw={...view.claim,amount:BigInt(view.claim.amount),nonce:BigInt(view.claim.nonce),issuedAt:BigInt(view.claim.issuedAt),expiresAt:BigInt(view.claim.expiresAt)};
  const old=await Promise.all(owners.map(owner=>owner.signTypedData(safeRewardConsentMessageV3(view.context,raw))));
  await assert.rejects(()=>sponsorClubClaimV4(owner,recipient,{action:'recipient',signature:'0x'+old.map(s=>s.slice(2)).join('')},deps));
  const joined='0x'+signatures.map(s=>s.slice(2)).join('');
  await sponsorClubClaimV4(owner,recipient,{action:'recipient',signature:joined},deps);await sponsorClubClaimV4(owner,recipient,{action:'recipient',signature:joined},deps);
  view=await sponsorClubClaimV4(actor,operator,undefined,deps);assert.equal(view.status,'awaiting_operator');
  const claim={...view.claim,amount:BigInt(view.claim.amount),nonce:BigInt(view.claim.nonce),issuedAt:BigInt(view.claim.issuedAt),expiresAt:BigInt(view.claim.expiresAt)};
  view=await sponsorClubClaimV4(actor,operator,{action:'operator',signature:await chain.operator.signTypedData(sponsorClaimMessagesV4(view.context,claim).authorization)},deps);
  assert.equal(view.status,'ready_to_pay');
 });
 await scenario('V4 club claim rejects a Safe execution nonce change after the human review',async()=>{
  const f=await sponsorClubClaimFactsV4(actor,operator,undefined,rpc),anchor=BigInt(f.events.intent.attestation.reviewedBlock.number);
  await chain.testClient.mine({blocks:96,interval:1});
  const reader={...chain.publicClient,readContract:args=>args.functionName==='nonce'&&args.blockNumber>anchor?Promise.resolve(1n):chain.publicClient.readContract(args)};
  await assert.rejects(()=>sponsorClubClaimV4(actor,operator,undefined,{rpc,reader}),{code:'reward_club_execution_changed_since_review'});
 });
 await scenario('V4 club claim pays its exact Safe once, records a finalized receipt and preserves it after nomination withdrawal',async()=>{
  const before=await chain.publicClient.getBalance({address:candidate.safeAddress}),tx=view.transaction;
  const hash=await chain.operatorClient.sendTransaction({to:tx.to,data:tx.data,gas:2000000n});assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});view=await sponsorClubClaimV4(actor,operator,{action:'receipt',transactionHash:hash},deps);
  assert.equal(view.status,'paid');assert.equal(view.transaction,null);assert.equal(await chain.publicClient.getBalance({address:candidate.safeAddress})-before,award.amountWei);
  assert.equal((await sponsorClubClaimV4(owner,recipient,undefined,deps)).receipt.transactionHash,hash);
  await query(`insert into app_private.reward_club_treasury_withdrawals(request_id,session_id) values(${q(nomination.requestId)},${q(owner.sessionId)})`);
  const past=await sponsorClubClaimV4(actor,operator,undefined,deps);assert.equal(past.current,false);assert.equal(past.status,'paid');
 });
 await scenario('V4 club claim storage is service-only and append-only',async()=>{
  for(const name of ['reward_sponsor_club_claims_v4','reward_sponsor_club_claim_events_v4']){
   for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${name}','SELECT,INSERT,UPDATE,DELETE')`),false);
   await assert.rejects(()=>query(`delete from app_private.${name}`),/reward_result_review_immutable/);
  }
 });
}
