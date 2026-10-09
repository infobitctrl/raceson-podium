import {z} from 'zod';
import type {RewardAccountIdentity} from './athlete-wallets.js';
import {RewardLedgerStoreError,type RewardLedgerRpc} from './programme-ledger.js';
const uuid=z.string().uuid(),address=z.string().regex(/^0x[0-9a-f]{40}$/),hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const signature=z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const request=z.object({requestId:uuid,body:z.record(z.unknown()),expiresAt:z.string().datetime({offset:true}),
 signatures:z.array(z.object({address,signature}).strict()).max(3),submissions:z.array(hash).max(8)}).strict();
const reply=z.object({signerAddress:address.nullable(),request:request.nullable()}).strict();
export type ClubOwnerRequest=z.infer<typeof request>;
export type ClubOwnerScope={creationId:string;approvalId:string;entitlementId:string};
async function call(actor:RewardAccountIdentity,rpc:RewardLedgerRpc,name:Parameters<RewardLedgerRpc>[0],input:Record<string,unknown>){
 const result=await rpc(name,{p_user_id:uuid.parse(actor.userId),p_session_id:uuid.parse(actor.sessionId),...input});
 if(result.error){const code=String((result.error as {message?:unknown}).message);throw new RewardLedgerStoreError([
  'reward_account_session_required','reward_demo_account_required','reward_claim_scope_required','reward_club_owner_required',
  'reward_club_treasury_required','reward_sponsor_claim_conflict','reward_sponsor_claim_not_ready','invalid_sponsor_claim',
 ].includes(code)?code:'reward_ledger_unavailable');}return result.data;
}
export async function clubOwnerApproval(actor:RewardAccountIdentity,scope:ClubOwnerScope,rpc:RewardLedgerRpc,action='read',input:Record<string,unknown>={}){
 return reply.parse(await call(actor,rpc,'service_reward_club_owner_approval',{
  p_creation_id:uuid.parse(scope.creationId),p_approval_id:uuid.parse(scope.approvalId),p_entitlement_id:hash.parse(scope.entitlementId),p_action:action,p_input:input,
 }));
}
const cursor=z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}:0x[0-9a-f]{64}$/);
export async function clubOwnerAwards(actor:RewardAccountIdentity,rpc:RewardLedgerRpc,after:string|null){
 const award=z.object({approvalId:uuid,entitlementId:hash,clubId:uuid,amountWei:z.string().regex(/^[1-9][0-9]*$/),slot:z.number().int().min(0).max(5),
  protocolVersion:z.union([z.literal(5),z.literal(6)]),claims:z.array(z.never()),directClaim:z.object({paid:z.boolean()}).strict()}).strict();
 return z.object({items:z.array(z.object({cursor,creationId:uuid,clubName:z.string().min(1),safeAddress:address,award}).strict()).max(25),nextCursor:cursor.nullable()}).strict()
  .parse(await call(actor,rpc,'service_reward_club_owner_awards',{p_after:after===null?null:cursor.parse(after)}));
}

export async function clubMemberships(actor:RewardAccountIdentity,rpc:RewardLedgerRpc,after:string|null){
 return z.object({items:z.array(z.object({clubId:uuid,name:z.string().min(1),role:z.enum(['manager','member']),canSign:z.boolean()}).strict()).max(25),nextCursor:uuid.nullable()}).strict()
  .parse(await call(actor,rpc,'service_reward_club_memberships',{p_after:after===null?null:uuid.parse(after)}));
}
