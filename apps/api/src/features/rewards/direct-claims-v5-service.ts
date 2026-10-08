import {directIdentityIssuerFromEnv} from './direct-claims-privy.js';
import {encodeRegisterAndClaimV6,verifyWalletBindingProofV2,type WalletBindingV2} from '@raceson/rewards-chain/club-signatures-v6';
import {directClaimFactsV5,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {verifyRewardWalletControl} from '@raceson/rewards-chain';
import {observeSponsorDirectClaimV5,verifySponsorDirectReceiptV5,verifyWalletBindingProofV1,encodeRegisterAndClaimV5,
 encodeSponsorDirectClaimV5,type WalletRegistryContextV1,type WalletBindingV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Address,Hex} from 'viem';
export type IdentityBindingIssuerV1={address:Address;sign:(context:WalletRegistryContextV1,binding:WalletBindingV1|WalletBindingV2)=>Promise<Hex>};
export type DirectClaimCommandV5={action:'prepare';proofId:string}|{action:'receipt';hash:Hex};
function check(v:unknown,code='invalid_sponsor_claim'):asserts v{if(!v)throw Error(code);}
/** The only server signature is an automatic account/wallet identity binding.
 * Sporting awards are already final. The athlete signs and sends their own claim. */
export async function directClaimV5(actor:RewardAccountIdentity,approvalId:string,entitlementId:string,command:DirectClaimCommandV5|undefined,
 deps:{rpc:RewardLedgerRpc;reader:SponsorChainReader;issuer:IdentityBindingIssuerV1|null;issuerV2?:IdentityBindingIssuerV1|null}){
 const identity={...actor};
 const read=()=>directClaimFactsV5(identity,approvalId,entitlementId,deps.rpc,command?.action==='prepare'?{proofId:command.proofId}:{});
 let facts=await read();let observed=await observeSponsorDirectClaimV5(deps.reader,facts.scope);
 let transaction:null|{chainId:10143;from:string;to:string;data:Hex;value:'0';binding:Record<string,unknown>|null;identityProof:Hex|null}=null;
 if(command?.action==='receipt'){
  const receipt=await verifySponsorDirectReceiptV5(deps.reader,facts.scope,command.hash);
  facts=await directClaimFactsV5(identity,approvalId,entitlementId,deps.rpc,{receipt});
 }else if(command?.action==='prepare'){
  check(!observed.paid&&observed.state===3&&!observed.paused&&BigInt(observed.observation.blockTimestamp)<BigInt(observed.deadline),'reward_sponsor_claim_not_ready');
  const challenge=facts.challenge;check(challenge?.proof,'reward_destination_proof_required');
  const checked=await verifyRewardWalletControl(challenge,challenge.proof.signature);
  check(checked.messageHash===challenge.proof.messageHash,'reward_destination_proof_required');
  const from=challenge.address;
  if(observed.registeredAddress===from){transaction={chainId:10143,from,to:observed.campaignAddress,data:encodeSponsorDirectClaimV5(facts.scope.entitlementId),value:'0',binding:null,identityProof:null};}
  else{
   const issuer=facts.scope.plan.version===6?(deps.issuerV2===undefined?directIdentityIssuerFromEnv(process.env,2):deps.issuerV2):deps.issuer;check(issuer&&issuer.address.toLowerCase()===facts.scope.plan.identityIssuer,'identity_binding_unavailable');
   const now=BigInt(Math.floor(Date.now()/1000)),proofExpiry=BigInt(Math.floor(Date.parse(challenge.expiresAt)/1000));
   check(now>=BigInt(Math.floor(Date.parse(challenge.issuedAt)/1000))&&proofExpiry>now+30n,'reward_wallet_challenge_expired');
   const context={chainId:10143 as const,registry:facts.scope.plan.walletRegistry as Address};
   const binding:WalletBindingV1|WalletBindingV2={beneficiaryId:facts.scope.beneficiaryId,recipient:from,beneficiaryKind:0,nonce:BigInt(observed.registrationNonce),issuedAt:now,expiresAt:proofExpiry,...(facts.scope.plan.version===6?{clubOwnersHash:('0x'+'0'.repeat(64)) as Hex}:{})};
   const fresh=await read();check(JSON.stringify(fresh.scope)===JSON.stringify(facts.scope)&&fresh.challenge?.proof?.proofId===challenge.proof.proofId&&fresh.challenge.address===challenge.address,'reward_sponsor_claim_conflict');
   const identityProof=await issuer.sign(context,binding);
   if('clubOwnersHash' in binding)await verifyWalletBindingProofV2(context,binding as WalletBindingV2,issuer.address,identityProof);else await verifyWalletBindingProofV1(context,binding,issuer.address,identityProof);
   transaction={chainId:10143,from,to:observed.registryAddress,data:'clubOwnersHash' in binding?encodeRegisterAndClaimV6(context,binding as WalletBindingV2,identityProof,observed.campaignAddress as Address,facts.scope.entitlementId):encodeRegisterAndClaimV5(context,binding,identityProof,observed.campaignAddress as Address,facts.scope.entitlementId),value:'0',
    binding:{...binding,nonce:binding.nonce.toString(),issuedAt:binding.issuedAt.toString(),expiresAt:binding.expiresAt.toString()},identityProof};
  }
 }
 const after=await read();check(JSON.stringify(after.scope)===JSON.stringify(facts.scope),'reward_sponsor_claim_conflict');
 if(transaction){const fresh=await observeSponsorDirectClaimV5(deps.reader,after.scope);
  check(!fresh.paid&&fresh.state===3&&!fresh.paused&&fresh.registrationNonce===observed.registrationNonce
   &&fresh.registeredAddress===observed.registeredAddress&&BigInt(fresh.observation.blockTimestamp)<BigInt(fresh.deadline),'reward_sponsor_claim_conflict');observed=fresh;}
 return {...(facts.scope.plan.version===6?{protocolVersion:6 as const}:{}),schema:'podium-direct-claim-v5' as const,approvalId,entitlementId,chainId:10143 as const,amountWei:facts.scope.amountWei,
  campaignAddress:observed.campaignAddress,registryAddress:observed.registryAddress,identityIssuer:facts.scope.plan.identityIssuer!,beneficiaryId:facts.scope.beneficiaryId,
  status:observed.paid?'paid':observed.state!==3?'not_open':observed.paused?'paused':BigInt(observed.observation.blockTimestamp)>=BigInt(observed.deadline)?'expired':'claimable',
  recipient:observed.recipient,deadline:observed.deadline,transaction,receipt:facts.receipt,rehearsalPolicy:facts.rehearsalPolicy};
}
