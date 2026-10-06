import type {RewardAccountIdentity} from './athlete-wallets.js';
import {RewardLedgerStoreError,type RewardLedgerRpc,copyRewardLedgerDocument as copy} from './programme-ledger.js';
import {rewardDocumentObject as object,rewardDocumentUuid as uuid} from './stored-documents.js';
export type HostedClubCreation={requestId:string;clubId:string;chainId:10143;sender:string;owners:string[];saltNonce:string;createdAt:string;current:boolean;
 transactions:{transactionHash:string}[];verified:{transactionHash:string;safeAddress:string;blockNumber:string;blockHash:string;initializerHash:string}|null};
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&BigInt(v)>1n;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n;
export function decodeHostedClubCreation(value:unknown,expectedId?:string):HostedClubCreation{
 const v=object(copy(value),['requestId','clubId','chainId','sender','owners','saltNonce','createdAt','current','transactions','verified']);
 uuid(v.requestId);uuid(v.clubId);
 if(expectedId!==undefined&&v.requestId!==expectedId||v.chainId!==10143||!address(v.sender)||!Array.isArray(v.owners)||v.owners.length!==3
  ||!v.owners.every(address)||new Set(v.owners).size!==3||v.owners.some((o,i,owners)=>i>0&&o<=owners[i-1])
  ||typeof v.saltNonce!=='string'||!/^[1-9][0-9]{0,38}$/.test(v.saltNonce)||BigInt(v.saltNonce)>=2n**128n
  ||typeof v.createdAt!=='string'||!Number.isFinite(Date.parse(v.createdAt))||typeof v.current!=='boolean'||!Array.isArray(v.transactions)||v.transactions.length>16)throw Error('invalid_reward_club_creation');
 const seen=new Set<string>();for(const row of v.transactions){const r=object(row,['transactionHash']);if(!hash(r.transactionHash)||seen.has(r.transactionHash))throw Error('invalid_reward_club_creation');seen.add(r.transactionHash);}
 if(v.verified!==null){const r=object(v.verified,['transactionHash','safeAddress','blockNumber','blockHash','initializerHash']);
  if(!hash(r.transactionHash)||!seen.has(r.transactionHash)||!address(r.safeAddress)||!hash(r.blockHash)||!hash(r.initializerHash)||typeof r.blockNumber!=='string'||!/^[1-9][0-9]*$/.test(r.blockNumber)||BigInt(r.blockNumber)>=2n**64n)throw Error('invalid_reward_club_creation');}
 return v as HostedClubCreation;
}
/** Construct only after verified ordinary Auth. All data remains bound to that
 * account/session; no generic RPC, signing, wallet creation or receipt trust. */
export function hostedCopyClubCreationStore(identity:RewardAccountIdentity,rpc:RewardLedgerRpc){
 const userId=uuid(identity.userId),sessionId=uuid(identity.sessionId);
 async function call(action:string,input:Record<string,unknown>){
  const r=await rpc('service_reward_demo_copy_club_creation',{p_user_id:userId,p_session_id:sessionId,p_action:action,p_input:copy(input)});
  if(r.error){const code=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError([
   'reward_account_session_required','reward_demo_account_required','reward_club_owner_required','reward_club_creation_not_found','invalid_reward_club_creation',
   'reward_destination_proof_required','reward_wallet_challenge_expired','reward_ledger_idempotency_conflict','reward_club_creation_limit',
  ].includes(code)?code:'reward_ledger_unavailable');}return copy(r.data);
 }
 return{
  request:async(input:{requestId:string;clubId:string;proofId:string;owners:string[]})=>{uuid(input.clubId);uuid(input.proofId);const id=uuid(input.requestId);return decodeHostedClubCreation(await call('request',{requestId:id,clubId:input.clubId,proofId:input.proofId,owners:[...input.owners]}),id);},
  read:async(requestId:string)=>{const id=uuid(requestId);return decodeHostedClubCreation(await call('read',{requestId:id}),id);},
  authorize:async(requestId:string,proofId:string)=>{const id=uuid(requestId);return decodeHostedClubCreation(await call('authorize',{requestId:id,proofId:uuid(proofId)}),id);},
  submitted:async(requestId:string,transactionHash:string)=>{const id=uuid(requestId);if(!hash(transactionHash))throw Error('invalid_reward_club_creation');return decodeHostedClubCreation(await call('submitted',{requestId:id,body:{transactionHash}}),id);},
  verified:async(requestId:string,body:NonNullable<HostedClubCreation['verified']>)=>{const id=uuid(requestId);return decodeHostedClubCreation(await call('verified',{requestId:id,body:copy(body)}),id);},
  history:async(after:string|null)=>{const cursor=after===null?null:uuid(after),v=object(await call('history',{after:cursor}),['items','nextCursor']);
   if(!Array.isArray(v.items)||v.items.length>25)throw Error('invalid_reward_club_creation');let previous=cursor;
   const items=v.items.map(row=>{const r=decodeHostedClubCreation(row);if(previous!==null&&r.requestId<=previous)throw Error('invalid_reward_club_creation');previous=r.requestId;return r;});
   if(v.nextCursor!==null&&(v.items.length!==25||v.nextCursor!==previous))throw Error('invalid_reward_club_creation');
   return{items,nextCursor:v.nextCursor as string|null};},
 };
}
