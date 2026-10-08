import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clubCreationMembers,clubMemberWalletLookup} from '../dist/features/rewards/club-creation-members.js';
const id=n=>`7d100000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=n=>'0x'+n.repeat(40),clubId=id(9),actor={userId:id(1),sessionId:id(2)};
const items=[1,2,3].map(n=>({memberId:id(100+n),name:`Member ${n}`,userId:id(200+n)}));
function fixture(){const calls=[],rpc=async(name,args)=>{calls.push({name,args});return{data:{clubId,items,nextCursor:null},error:null};};return{calls,rpc};}
test('member list is private, strips user IDs, distinguishes missing wallets from lookup outages and rechecks membership',async()=>{
 const f=fixture(),lookup=async userId=>userId===items[0].userId?address('a'):userId===items[1].userId?null:Promise.reject(Error('provider'));
 const p=await clubCreationMembers(actor,f.rpc,lookup).list(clubId,null);
 assert.deepEqual(p.items.map(m=>m.status),['ready','setup_needed','unavailable']);assert(p.items.every(m=>!('userId'in m)));
 assert.equal(f.calls.length,2);assert(f.calls.every(c=>c.args.p_user_id===actor.userId&&c.args.p_session_id===actor.sessionId&&c.args.p_club_id===clubId));
 let reads=0;await assert.rejects(clubCreationMembers(actor,async()=>({data:{clubId,items:++reads===1?items:[],nextCursor:null},error:null}),lookup).list(clubId,null),/members_changed/);
 let lookups=0;await assert.rejects(clubCreationMembers(actor,async()=>({data:null,error:{message:'reward_club_owner_required'}}),async()=>{lookups++;}).list(clubId,null),/owner_required/);assert.equal(lookups,0);
});
test('creation resolves exactly three distinct current accounts and matching provider wallets',async()=>{
 const f=fixture(),wallets=items.map((_,i)=>address(String(i+1))),lookup=async userId=>wallets[items.findIndex(m=>m.userId===userId)];
 const service=clubCreationMembers(actor,f.rpc,lookup),ids=items.map(m=>m.memberId);
 assert.deepEqual((await service.resolve(clubId,ids,wallets)).map(m=>m.address),wallets);
 for(const expected of [[...wallets.slice(0,2),address('f')],[wallets[0],wallets[0],wallets[2]]])await assert.rejects(service.resolve(clubId,ids,expected),/members_changed/);
 await assert.rejects(service.resolve(clubId,[ids[0],ids[0],ids[2]],wallets),/members_changed/);
 await assert.rejects(clubCreationMembers(actor,f.rpc,async()=>null).resolve(clubId,ids,wallets),/members_changed/);
});
test('provider lookup accepts only the exact custom-auth user and their single signable embedded wallet',async()=>{
 let user={id:'did:privy:fixture',linked_accounts:[{type:'custom_auth',custom_user_id:actor.userId},{type:'wallet',id:'wallet1',address:address('a'),chain_type:'ethereum',connector_type:'embedded',wallet_client_type:'privy',imported:false,user_can_sign:true}]};
 let wallet={address:address('a'),chain_type:'ethereum',archived_at:null,imported_at:null,exported_at:null};
 const client={users:()=>({getByCustomAuthID:async input=>{assert.equal(input.custom_user_id,actor.userId);return user;}}),wallets:()=>({get:async()=>wallet})};
 const lookup=clubMemberWalletLookup(client);assert.equal(await lookup(actor.userId),address('a'));
 wallet={...wallet,exported_at:10};await assert.rejects(lookup(actor.userId));wallet.exported_at=null;
 user.linked_accounts[1].user_can_sign=false;assert.equal(await lookup(actor.userId),null);user.linked_accounts[1].user_can_sign=true;
 user.linked_accounts.push({...user.linked_accounts[1],id:'wallet2'});await assert.rejects(lookup(actor.userId));user.linked_accounts.pop();
 user.linked_accounts[0].custom_user_id=id(999);await assert.rejects(lookup(actor.userId));
 assert.equal(await clubMemberWalletLookup({users:()=>({getByCustomAuthID:async()=>{throw{status:404};}})})(actor.userId),null);
});
