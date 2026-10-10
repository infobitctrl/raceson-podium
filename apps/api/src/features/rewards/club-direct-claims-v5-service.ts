import {directIdentityIssuerFromEnv} from './direct-claims-privy.js';
import {clubApprovalExpiry} from './club-approval-lifetime.js';
import {clubOwnersHashV1,encodeWalletRegistrationV2,verifyWalletBindingProofV2,type WalletBindingV2,type ClubClaimV6} from '@raceson/rewards-chain/club-signatures-v6';
import {clubDirectClaimFactsV5,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {verifyRewardWalletControl} from '@raceson/rewards-chain';
import {observeSponsorDirectClaimV5,verifySponsorDirectReceiptV5,verifyClubRegistrationReceiptV6,verifyWalletBindingProofV1,encodeRegisterAndClaimV5,
 encodeSponsorDirectClaimV5,type WalletRegistryContextV1,type WalletBindingV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import {observeDirectClubTreasuryV5} from '@raceson/rewards-chain/sponsor-club-direct-v5';
import {rewardClubSafeTestnetDependencies,type RewardClubSafeDeploymentReader} from '@raceson/rewards-chain';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Address,Hex} from 'viem';
type IdentityBindingIssuerV1={address:Address;sign:(context:WalletRegistryContextV1,binding:WalletBindingV1|WalletBindingV2)=>Promise<Hex>};
export type ClubDirectClaimCommandV5={action:'prepare';proofId:string}|{action:'receipt'|'registrationReceipt';hash:Hex};
function check(v:unknown,code='invalid_sponsor_claim'):asserts v{if(!v)throw Error(code);}
/** The only server signature is an automatic account/wallet identity binding.
 * Sporting awards are already final. Two Safe owners consent and one submits their treasury’s claim. */
export async function buildClubDirectClaimV5(actor:RewardAccountIdentity,approvalId:string,entitlementId:string,creationId:string,command:ClubDirectClaimCommandV5|undefined,
 deps:{rpc:RewardLedgerRpc;reader:SponsorChainReader & RewardClubSafeDeploymentReader;issuer:IdentityBindingIssuerV1|null;issuerV2?:IdentityBindingIssuerV1|null}){
 const identity={...actor};
 const read=()=>clubDirectClaimFactsV5(identity,approvalId,entitlementId,creationId,deps.rpc,command?.action==='prepare'?{proofId:command.proofId}:{});
 let facts=await read();
 const treasury={safe:{context:{environment:'monad-testnet' as const,chainId:10143 as const,verifyingContract:facts.treasury.safeAddress as Address},
  singletonAddress:rewardClubSafeTestnetDependencies.singletonAddress,fallbackHandlerAddress:rewardClubSafeTestnetDependencies.fallbackHandlerAddress,owners:facts.treasury.owners as Address[]},
  factoryAddress:rewardClubSafeTestnetDependencies.factoryAddress,deploymentTransactionHash:facts.treasury.deploymentTransactionHash as Hex,initializationSaltNonce:BigInt('0x'+facts.treasury.creationId.replaceAll('-',''))+1n};
 // Both depend on the authenticated facts, not each other. Keep every final
 // authority, nonce and checkpoint recheck below after these initial reads.
 const [safe,initialObservation]=await Promise.all([
  observeDirectClubTreasuryV5(deps.reader,treasury),
  observeSponsorDirectClaimV5(deps.reader,facts.scope),
 ]);
 let observed=initialObservation;
 let clubClaim:ClubClaimV6|null=null,registrationReceipt:null|{transactionHash:Hex;blockNumber:string;blockHash:Hex}=null;
 const v6=facts.scope.plan.version===6;
 const ownersHash=clubOwnersHashV1(facts.treasury.owners as Address[]);
 if(v6&&observed.registeredAddress===facts.treasury.safeAddress)check(observed.clubOwnersHash===ownersHash,'reward_sponsor_claim_conflict');
 let transaction:null|{chainId:10143;from:string;to:string;data:Hex;value:'0';binding:Record<string,unknown>|null;identityProof:Hex|null}=null;
 if(command?.action==='registrationReceipt'){
  check(v6);registrationReceipt=await verifyClubRegistrationReceiptV6(deps.reader,facts.scope,command.hash,treasury);
 }else if(command?.action==='receipt'){
  const receipt=await verifySponsorDirectReceiptV5(deps.reader,facts.scope,command.hash,treasury);
  facts=await clubDirectClaimFactsV5(identity,approvalId,entitlementId,creationId,deps.rpc,{receipt});
 }else if(command?.action==='prepare'){
  check(!observed.paid&&observed.state===3&&!observed.paused&&BigInt(observed.observation.blockTimestamp)<BigInt(observed.deadline),'reward_sponsor_claim_not_ready');
  const challenge=facts.challenge;check(challenge?.proof,'reward_destination_proof_required');
  const checked=await verifyRewardWalletControl(challenge,challenge.proof.signature);
  check(checked.messageHash===challenge.proof.messageHash,'reward_destination_proof_required');
  const from=facts.treasury.safeAddress;check(facts.treasury.owners.includes(challenge.address),'reward_destination_proof_required');
  if(observed.registeredAddress===from){
   if(v6){
    const now=BigInt(Math.floor(Date.now()/1000)),proofExpiry=BigInt(Math.floor(Date.parse(challenge.expiresAt)/1000));
    check(proofExpiry>now+30n&&observed.allocationDigest&&observed.clubOwnersHash===ownersHash,'reward_wallet_challenge_expired');
    const expiresAt=clubApprovalExpiry(now,BigInt(observed.deadline));
    clubClaim={entitlementId:facts.scope.entitlementId,recipient:from as Address,amount:BigInt(facts.scope.amountWei),pot:facts.scope.slot===0?1:0,
     nonce:BigInt(observed.authorizationNonce),issuedAt:now,expiresAt,allocationDigest:observed.allocationDigest,clubOwnersHash:ownersHash,registrationNonce:BigInt(observed.registrationNonce)};
   }
   transaction={chainId:10143,from,to:observed.campaignAddress,data:v6?'0x':encodeSponsorDirectClaimV5(facts.scope.entitlementId),value:'0',binding:null,identityProof:null};}
  else{
   const issuer=facts.scope.plan.version===6?(deps.issuerV2===undefined?directIdentityIssuerFromEnv(process.env,2):deps.issuerV2):deps.issuer;check(issuer&&issuer.address.toLowerCase()===facts.scope.plan.identityIssuer,'identity_binding_unavailable');
   const now=BigInt(Math.floor(Date.now()/1000)),proofExpiry=BigInt(Math.floor(Date.parse(challenge.expiresAt)/1000));
   check(now>=BigInt(Math.floor(Date.parse(challenge.issuedAt)/1000))&&proofExpiry>now+30n,'reward_wallet_challenge_expired');
   const context={chainId:10143 as const,registry:facts.scope.plan.walletRegistry as Address};
   const binding:WalletBindingV1|WalletBindingV2={beneficiaryId:facts.scope.beneficiaryId,recipient:from as Address,beneficiaryKind:1,nonce:BigInt(observed.registrationNonce),issuedAt:now,expiresAt:clubApprovalExpiry(now,BigInt(observed.deadline)),...(facts.scope.plan.version===6?{clubOwnersHash:clubOwnersHashV1(facts.treasury.owners as Address[])}:{})};
   const fresh=await read();check(JSON.stringify(fresh.scope)===JSON.stringify(facts.scope)&&JSON.stringify(fresh.treasury)===JSON.stringify(facts.treasury)&&fresh.challenge?.proof?.proofId===challenge.proof.proofId&&fresh.challenge.address===challenge.address,'reward_sponsor_claim_conflict');
   const identityProof=await issuer.sign(context,binding);
   if('clubOwnersHash' in binding)await verifyWalletBindingProofV2(context,binding as WalletBindingV2,issuer.address,identityProof);else await verifyWalletBindingProofV1(context,binding,issuer.address,identityProof);
   transaction={chainId:10143,from,to:observed.registryAddress,data:'clubOwnersHash' in binding?encodeWalletRegistrationV2(context,binding as WalletBindingV2,identityProof):encodeRegisterAndClaimV5(context,binding,identityProof,observed.campaignAddress as Address,facts.scope.entitlementId),value:'0',
    binding:{...binding,nonce:binding.nonce.toString(),issuedAt:binding.issuedAt.toString(),expiresAt:binding.expiresAt.toString()},identityProof};
  }
 }
 const after=await read();check(JSON.stringify(after.scope)===JSON.stringify(facts.scope)&&JSON.stringify(after.treasury)===JSON.stringify(facts.treasury),'reward_sponsor_claim_conflict');
 if(transaction){const fresh=await observeSponsorDirectClaimV5(deps.reader,after.scope);
  check(!fresh.paid&&fresh.state===3&&!fresh.paused&&fresh.registrationNonce===observed.registrationNonce
   &&fresh.registeredAddress===observed.registeredAddress&&fresh.clubOwnersHash===observed.clubOwnersHash&&fresh.allocationDigest===observed.allocationDigest&&fresh.authorizationNonce===observed.authorizationNonce&&BigInt(fresh.observation.blockTimestamp)<BigInt(fresh.deadline),'reward_sponsor_claim_conflict');observed=fresh;}
 const safeAfter=await observeDirectClubTreasuryV5(deps.reader,treasury);check(safe.nonce===safeAfter.nonce,'reward_sponsor_claim_conflict');
 return {...(v6?{protocolVersion:6 as const,phase:observed.registeredAddress===facts.treasury.safeAddress?'claim' as const:'register' as const,
  chainState:{registrationNonce:observed.registrationNonce,authorizationNonce:observed.authorizationNonce,clubOwnersHash:observed.clubOwnersHash,allocationDigest:observed.allocationDigest},
  registrationReceipt,clubClaim:clubClaim?{...clubClaim,amount:clubClaim.amount.toString(),nonce:clubClaim.nonce.toString(),issuedAt:clubClaim.issuedAt.toString(),expiresAt:clubClaim.expiresAt.toString(),registrationNonce:clubClaim.registrationNonce.toString()}:null}:{}),schema:'podium-club-direct-claim-v5' as const,creationId,clubId:facts.treasury.clubId,safeAddress:facts.treasury.safeAddress,owners:facts.treasury.owners,ownerDisplay:facts.treasury.ownerDisplay??[],safeNonce:safe.nonce.toString(),approvalId,entitlementId,chainId:10143 as const,amountWei:facts.scope.amountWei,
  campaignAddress:observed.campaignAddress,registryAddress:observed.registryAddress,identityIssuer:facts.scope.plan.identityIssuer!,beneficiaryId:facts.scope.beneficiaryId,
  status:observed.paid?'paid':observed.state!==3?'not_open':observed.paused?'paused':BigInt(observed.observation.blockTimestamp)>=BigInt(observed.deadline)?'expired':'claimable',
  recipient:observed.recipient,deadline:observed.deadline,transaction,receipt:facts.receipt,rehearsalPolicy:facts.rehearsalPolicy};
}
