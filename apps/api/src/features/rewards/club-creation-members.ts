import {z} from 'zod';
import type {RewardAccountIdentity,RewardLedgerRpc} from '@raceson/db/rewards';
import type {PrivyClient} from '@privy-io/node';
import {reviewerPrivyClient} from './review-publication-privy.js';
const uuid=z.string().uuid();
const member=z.object({memberId:uuid,name:z.string().min(1).max(1000),username:z.string().nullable().optional(),role:z.enum(['manager','athlete']).optional(),source:z.enum(['copied_representation','membership']).optional(),userId:uuid.nullable()}).strict();
const page=z.object({clubId:uuid,items:z.array(member).max(25),nextCursor:uuid.nullable()}).strict();
export type ClubMemberWalletLookup=(userId:string)=>Promise<string|null>;
/** Provider-linked user-owned embedded wallets only; no search by name, email,
 * browser-supplied address, wallet creation or signer delegation. */
export function clubMemberWalletLookup(client:PrivyClient):ClubMemberWalletLookup{return async userId=>{
 let user;try{user=await client.users().getByCustomAuthID({custom_user_id:userId});}catch(e){if(e&&typeof e==='object'&&'status'in e&&e.status===404)return null;throw Error('reward_club_wallet_lookup_unavailable');}
 if(!user.linked_accounts.some(a=>a.type==='custom_auth'&&a.custom_user_id===userId))throw Error('reward_club_wallet_lookup_unavailable');
 const wallets=user.linked_accounts.filter(a=>a.type==='wallet'&&a.chain_type==='ethereum'&&a.wallet_client_type==='privy'&&a.connector_type==='embedded'&&'imported'in a&&a.imported===false&&'user_can_sign'in a&&a.user_can_sign===true);
 if(!wallets.length)return null;
 if(wallets.length!==1)throw Error('reward_club_wallet_lookup_unavailable');
 const selected=wallets[0]!;
 if(selected.type!=='wallet'||!('id'in selected)||typeof selected.id!=='string')throw Error('reward_club_wallet_lookup_unavailable');
 const wallet=await client.wallets().get(selected.id);
 if(wallet.address.toLowerCase()!==selected.address.toLowerCase()||wallet.chain_type!=='ethereum'||wallet.archived_at||wallet.imported_at||wallet.exported_at||!/^0x[0-9a-f]{40}$/.test(wallet.address.toLowerCase())||BigInt(wallet.address)<=1n)throw Error('reward_club_wallet_lookup_unavailable');
 return wallet.address.toLowerCase();
};}
export function clubCreationMembers(identity:RewardAccountIdentity,rpc:RewardLedgerRpc,lookup:ClubMemberWalletLookup=clubMemberWalletLookup(reviewerPrivyClient(process.env))){
 const actor={userId:uuid.parse(identity.userId),sessionId:uuid.parse(identity.sessionId)};
 async function roster(clubId:string,after:string|null,ids:string[]|null){
  const r=await rpc('service_reward_club_creation_members_v2',{p_user_id:actor.userId,p_session_id:actor.sessionId,p_club_id:uuid.parse(clubId),p_after:after===null?null:uuid.parse(after),p_ids:ids?.map(id=>uuid.parse(id))??null});
  if(r.error){const code=String((r.error as {message?:unknown}).message);throw Error(['reward_account_session_required','reward_club_owner_required','reward_demo_account_required','reward_club_members_changed'].includes(code)?code:'reward_club_members_unavailable');}
  const p=page.parse(r.data);if(p.clubId!==clubId||new Set(p.items.map(m=>m.memberId)).size!==p.items.length)throw Error('reward_club_members_unavailable');return p;
 }
 async function resolved(clubId:string,after:string|null,ids:string[]|null){
  const before=await roster(clubId,after,ids);
  // Bound provider concurrency; failures remain distinct from a missing wallet.
  const items=[];
  for(let offset=0;offset<before.items.length;offset+=4){items.push(...await Promise.all(before.items.slice(offset,offset+4).map(async m=>{
   try{const address=m.userId?await lookup(m.userId):null;return{...m,address,status:address?'ready' as const:'setup_needed' as const};}
   catch{return{...m,address:null,status:'unavailable' as const};}
  })));}
  if(JSON.stringify(before)!==JSON.stringify(await roster(clubId,after,ids)))throw Error('reward_club_members_changed');
  return {...before,items};
 }
 return{
  async list(clubId:string,after:string|null){const p=await resolved(clubId,after,null);return{...p,items:p.items.map(({userId:_,...m})=>m)};},
  async resolve(clubId:string,ids:string[],expected:string[]){
   if(ids.length!==3||new Set(ids).size!==3)throw Error('reward_club_members_changed');
   const p=await resolved(clubId,null,ids);
   if(p.items.length!==3||p.items.some(m=>!m.userId||!m.address||m.status!=='ready')||new Set(p.items.map(m=>m.userId)).size!==3||new Set(p.items.map(m=>m.address)).size!==3
    ||JSON.stringify(p.items.map(m=>m.address).sort())!==JSON.stringify([...expected].sort()))throw Error('reward_club_members_changed');
   return p.items.map(m=>({memberId:m.memberId,userId:m.userId!,name:m.name,address:m.address!})).sort((a,b)=>a.memberId.localeCompare(b.memberId));
  }
 };
}
