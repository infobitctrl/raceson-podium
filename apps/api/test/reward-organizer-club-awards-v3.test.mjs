import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOrganizerClubAwardsV3 } from '../../../packages/domain/dist/rewards/organizer-club-awards-v3.js';
import { listOrganizerClubAwardsV3 } from '../../../packages/db/dist/rewards/index.js';
import { dispatchOrganizerClubAwardsV3 } from '../dist/routes/rewards/organizer-club-awards-v3.js';
const id=n=>`8fb00000-0000-4000-8000-${String(n).padStart(12,'0')}`, hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
const address='0x'+'a'.repeat(40), identity={userId:id(1),sessionId:id(2)}, uploadId=id(3);
const fixture=()=>({schema:'raceson-organizer-club-awards-v3',chainId:31337,uploadId,draftId:id(4),approvalId:id(5),slot:6,
  campaignAddress:address,allocationRevision:'latest',items:[{entitlementId:hash(1),clubId:id(6),clubName:'Synthetic club',amountWei:'100000000000000001',
    nomination:{requestId:id(7),address,status:'pending_review'},claim:null}],nextCursor:null});
const decode=p=>decodeOrganizerClubAwardsV3(p,31337,uploadId);
test('operator club projection binds upload/network, preserves exact awards and rejects private/malformed extras',()=>{
  assert.deepEqual(decode(fixture()),fixture());
  for(const edit of [p=>p.uploadId=id(90),p=>p.chainId=143,p=>p.secret='private',p=>p.slot=7,p=>p.items[0].amountWei=1,
    p=>p.items[0].amountWei='0',p=>p.items[0].nomination.status='approved',p=>p.items[0].nomination.ownerIdentity={},
    p=>p.items[0].claim={claimId:id(8),requestId:id(7),recipientAddress:address,recipientConsented:false,operatorApproved:true},
    p=>p.items.push({...p.items[0]}),p=>Object.defineProperty(p.items[0],'amountWei',{get(){assert.fail('getter invoked');}})]) {
    const p=fixture();edit(p);assert.throws(()=>decode(p),/invalid_reward_organizer_club_query/);
  }
  const p=fixture();p.items[0].nomination=null;p.allocationRevision='superseded';assert.deepEqual(decode(p),p);
});
test('operator club pagination enforces exact 50/51 cursor and dense arrays',()=>{
  const p=fixture(),row=p.items[0];p.items=Array.from({length:50},(_,n)=>({...row,entitlementId:hash(n+1)}));p.nextCursor=hash(50);
  assert.equal(decode(p).items.length,50);p.nextCursor=hash(49);assert.throws(()=>decode(p));p.nextCursor=null;
  assert.throws(()=>decodeOrganizerClubAwardsV3(p,31337,uploadId,hash(1)));delete p.items[1];assert.throws(()=>decode(p));
});
test('repository sends one scoped RPC and sanitizes private errors',async()=>{
  const calls=[],rpc=async(name,args)=>{calls.push({name,args});return {data:fixture(),error:null};};
  assert.deepEqual(await listOrganizerClubAwardsV3(identity,{chainId:31337,uploadId},rpc),fixture());
  assert.deepEqual(calls,[{name:'service_list_reward_organizer_club_awards_v3',args:{p_user_id:id(1),p_session_id:id(2),p_chain_id:31337,p_upload_id:uploadId,p_after_id:null}}]);
  await assert.rejects(listOrganizerClubAwardsV3(identity,{chainId:143,uploadId},rpc));assert.equal(calls.length,1);
  await assert.rejects(listOrganizerClubAwardsV3(identity,{chainId:31337,uploadId},async()=>({error:{message:'private'}})),{code:'reward_ledger_store_failed'});
});
const path=`/api/v1/organizer/rewards/uploads/${uploadId}/club-awards-v3`;
async function request(url=path,options={}) {
  const res={};let calls=0;
  const routed=await dispatchOrganizerClubAwardsV3({method:options.method??'GET'},res,new URL(url,'http://127.0.0.1:3101'),{
    config:()=>options.disabled?null:{chainId:31337},requireIdentity:async()=>{if(options.auth)throw Error(options.auth);return identity;},
    applyPrivateSessionHeaders:r=>r.private=true,readJsonBody:()=>assert.fail('read only'),
    sendSuccess:(r,data)=>{r.status=200;r.data=data;},sendError:(r,status,code)=>{r.status=status;r.code=code;},
    rpc:async()=>{calls++;return options.error?{error:{message:options.error}}:{data:fixture(),error:null};}});
  return {...res,calls,routed};
}
test('demo endpoint refuses auth/scope/foreign filters without becoming a generic query or write API',async()=>{
  assert.equal((await request()).status,200);assert.equal((await request()).private,true);
  for(const auth of ['Unauthorized','Missing bearer token'])assert.equal((await request(path,{auth})).status,401);
  assert.equal((await request(path,{auth:'Untrusted browser origin'})).status,403);
  assert.equal((await request(path,{error:'reward_club_readiness_scope_required'})).status,404);
  assert.equal((await request(path,{error:'private database detail'})).status,503);
  for(const suffix of ['?chainId=10143','?after=','?after='+id(1),'?after='+hash(1)+'&after='+hash(2)]) {
    const r=await request(path+suffix);assert.equal(r.status,400);assert.equal(r.calls,0);
  }
  assert.equal((await request(path,{method:'POST'})).routed,false);assert.equal((await request(path,{disabled:true})).calls,0);
});
