import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {clubClaimMessageV6,clubOwnersHashV1} from '../../../packages/rewards-chain/dist/club-signatures-v6.js';
import {directSafeMessageV5} from '../../../packages/rewards-chain/dist/sponsor-club-direct-v5.js';
import {coordinateClubOwnerApproval,currentClubOwnerRequest,recoverClubOwnerSignature} from '../dist/features/rewards/club-owner-approvals-service.js';
const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=n=>'0x'+n.repeat(64),address=n=>'0x'+n.repeat(40);
const keys=[1,2,3,4].map(n=>privateKeyToAccount('0x'+n.toString(16).padStart(64,'0'))),owners=keys.slice(0,3).map(k=>k.address.toLowerCase()).sort();
const scope={approvalId:id(5),entitlementId:hash('a'),creationId:id(6)},actor=n=>({userId:id(n+10),sessionId:id(n+20)});
function fixture(){
 const now=Math.floor(Date.now()/1000),claim={entitlementId:scope.entitlementId,recipient:address('8'),amount:'100',pot:0,nonce:'2',issuedAt:String(now),expiresAt:String(now+480),allocationDigest:hash('b'),clubOwnersHash:clubOwnersHashV1(owners),registrationNonce:'1'};
 let current={...scope,schema:'podium-club-direct-claim-v5',protocolVersion:6,clubId:id(7),chainId:10143,safeAddress:address('8'),campaignAddress:address('9'),registryAddress:address('7'),identityIssuer:address('6'),beneficiaryId:hash('c'),owners,safeNonce:'1',amountWei:'100',recipient:address('8'),deadline:String(now+9999),status:'claimable',phase:'claim',
  chainState:{registrationNonce:'1',authorizationNonce:'2',clubOwnersHash:claim.clubOwnersHash,allocationDigest:claim.allocationDigest},clubClaim:null,registrationReceipt:null,receipt:null,transaction:null,rehearsalPolicy:'podium-demo-alias-rehearsal-v1'};
 let saved=null,prepared=0,writes=0;
 const rpc=async(name,args)=>{
  assert.equal(name,'service_reward_club_owner_approval');const n=Number(args.p_user_id.slice(-12))-10;
  if(n===3)return{data:null,error:{message:'reward_claim_scope_required'}};
  const signerAddress=n<3?keys[n].address.toLowerCase():null;
  if(args.p_action==='prepare'){prepared++;saved={requestId:id(100+prepared),body:args.p_input.body,expiresAt:args.p_input.expiresAt,signatures:[],submissions:[]};}
  if(args.p_action==='sign'){writes++;saved.signatures.push({address:args.p_input.address,signature:args.p_input.signature});}
  return{data:{signerAddress,request:saved},error:null};
 };
 const build=async command=>command?.action==='prepare'?{...current,clubClaim:claim,transaction:{chainId:10143,from:address('8'),to:address('9'),value:'0',data:'0x',binding:null,identityProof:null}}:{...current};
 const run=(n,command)=>coordinateClubOwnerApproval(actor(n),scope,command,{rpc,build});
 return{run,get saved(){return saved;},get writes(){return writes;},get prepared(){return prepared;},get current(){return current;},change:patch=>{current={...current,...patch};},claim};
}
const sign=(key,claim)=>key.signTypedData(clubClaimMessageV6({chainId:10143,campaign:address('9')},{...claim,amount:BigInt(claim.amount),nonce:BigInt(claim.nonce),issuedAt:BigInt(claim.issuedAt),expiresAt:BigInt(claim.expiresAt),registrationNonce:BigInt(claim.registrationNonce)}));
test('two separate accounts share an immutable prepared message and real signatures survive reopening',async()=>{
 const f=fixture();await f.run(0,{action:'prepare',proofId:id(8)});const requestId=f.saved.requestId;
 const first=await sign(keys[0],f.claim);await f.run(0,{action:'sign',requestId,signature:first});
 const reopened=await f.run(1);assert.equal(reopened.ownerApproval.signatures.length,1);assert.equal(reopened.ownerApproval.requestId,requestId);
 await f.run(1,{action:'prepare',proofId:id(9)});assert.equal(f.prepared,1);
 await f.run(1,{action:'sign',requestId,signature:await sign(keys[1],f.claim)});
 assert.equal((await f.run(2)).ownerApproval.signatures.length,2);assert.equal(f.writes,2);
});
test('foreign signatures, accounts, message domains and expired or altered state cannot be saved',async()=>{
 const f=fixture();await f.run(0,{action:'prepare',proofId:id(8)});const requestId=f.saved.requestId;
 for(const signature of [await sign(keys[1],f.claim),await sign(keys[0],{...f.claim,amount:'101'}),'0x'+'00'.repeat(65)])
  await assert.rejects(f.run(0,{action:'sign',requestId,signature}),/consent_invalid/);
 await assert.rejects(f.run(3),/scope_required/);assert.equal(f.writes,0);
 f.saved.expiresAt=new Date(Date.now()-1000).toISOString();
 await assert.rejects(f.run(0,{action:'sign',requestId,signature:await sign(keys[0],f.claim)}),/claim_conflict/);
 assert.equal((await f.run(1)).ownerApproval.requestId,null);
 await f.run(1,{action:'prepare',proofId:id(9)});assert.notEqual(f.saved.requestId,requestId);
 await assert.rejects(f.run(0,{action:'sign',requestId,signature:await sign(keys[0],f.claim)}),/claim_conflict/);
 f.change({chainState:{...f.current.chainState,authorizationNonce:'3'}});
 await assert.rejects(f.run(0,{action:'sign',requestId:f.saved.requestId,signature:await sign(keys[0],f.claim)}),/claim_conflict/);assert.equal(f.writes,0);
});
test('state fingerprint rejects every signing-relevant change and handles JSON field order',async()=>{
 const f=fixture();await f.run(0,{action:'prepare',proofId:id(8)});assert(currentClubOwnerRequest(f.saved,f.current));
 for(const patch of [{safeNonce:'2'},{status:'paid'},{phase:'register'},{amountWei:'101'},{safeAddress:address('a')},{owners:[...owners.slice(0,2),address('b')]},{chainState:{...f.current.chainState,registrationNonce:'2'}}])
  assert.equal(currentClubOwnerRequest(f.saved,{...f.current,...patch}),false);
 assert(currentClubOwnerRequest(f.saved,{...f.current,chainState:Object.fromEntries(Object.entries(f.current.chainState).reverse())}));
});
test('registration signatures bind the exact Safe nonce, call and chain independently of prize claims',async()=>{
 const call={chainId:10143,safe:address('8'),to:address('7'),data:'0x1234',nonce:1n},signature=await keys[0].signTypedData(directSafeMessageV5(call));
 const body={protocolVersion:6,phase:'register',safeAddress:call.safe,safeNonce:'1',transaction:{to:call.to,data:call.data}};
 assert.equal(await recoverClubOwnerSignature(body,signature),keys[0].address.toLowerCase());
 assert.notEqual(await recoverClubOwnerSignature({...body,safeNonce:'2'},signature),keys[0].address.toLowerCase());
 const raw='0x'+signature.slice(2,66)+'f'.repeat(64)+signature.slice(-2);await assert.rejects(recoverClubOwnerSignature(body,raw),/consent_invalid/);
});
test('manager outside owner set cannot prepare, sign or submit',async()=>{
 const f=fixture();await assert.rejects(f.run(4,{action:'prepare',proofId:id(8)}),/owner_required/);assert.equal(f.prepared,0);
});

test('display labels do not change an existing approval message or grant signing authority',async()=>{
 const f=fixture();await f.run(0,{action:'prepare',proofId:id(8)});const requestId=f.saved.requestId;
 const ownerDisplay=owners.map((address,i)=>({address,name:`Demo owner ${i+1}`}));f.change({ownerDisplay});
 const current=await f.run(1);assert.deepEqual(current.ownerDisplay,ownerDisplay);assert.equal(current.ownerApproval.requestId,requestId);
 assert(currentClubOwnerRequest(f.saved,f.current));await assert.rejects(f.run(4,{action:'prepare',proofId:id(8)}),/owner_required/);
});
