import {walletRegistryAbiV2,clubClaimAbiV6} from './club-signatures-v6.js';
import {sponsoredReceiptCall} from './sponsored-receipt-call.js';
import {directSafeReceiptCallV5,type DirectClubTreasuryV5} from './sponsor-club-direct-v5.js';
import type {RewardClubSafeDeploymentReader} from './club-safe-deployment.js';
import {decodeSponsorExecutionPlan,type SponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {decodeEventLog,decodeFunctionData,encodeFunctionData,hashTypedData,parseAbi,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {observeSponsorProgrammePot,type SponsorChainReader} from './sponsor-v4.js';
import {demand,walletAddress,bytes32,signatureBytes} from './validation.js';

export const walletRegistryAbiV1=parseAbi([
 'function registrations(bytes32) view returns(address recipient,uint8 beneficiaryKind,uint256 nonce)',
 'function register((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt) b,bytes identityProof)',
 'function registerAndClaim((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt) b,bytes identityProof,address campaign,bytes32 entitlementId)',
 'event WalletRegistered(bytes32 indexed beneficiaryId,address indexed recipient,uint8 beneficiaryKind,uint256 nonce)',
]);
export const directClaimAbiV5=parseAbi([
 'function claimDirect(bytes32 entitlementId)',
 'function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)',
 'event RewardPaid(bytes32 indexed entitlementId,address indexed recipient,uint8 indexed pot,uint256 amount,uint256 nonce)',
]);
export type WalletBindingV1={beneficiaryId:Hex;recipient:Address;beneficiaryKind:0|1;nonce:bigint;issuedAt:bigint;expiresAt:bigint};
export type WalletRegistryContextV1={chainId:10143|31337;registry:Address};
/** No wallet creation and no reward approval: this credential binds an already
 * authenticated beneficiary to a wallet that explicitly registers itself. */
export function walletBindingMessageV1(context:WalletRegistryContextV1,input:WalletBindingV1){
 demand(context.chainId===10143||context.chainId===31337,'invalid_wallet_binding');
 const registry=walletAddress(context.registry),beneficiaryId=bytes32(input.beneficiaryId),recipient=walletAddress(input.recipient);
 demand(BigInt(beneficiaryId)!==0n&&recipient.toLowerCase()!==registry.toLowerCase()
  &&(input.beneficiaryKind===0||input.beneficiaryKind===1)&&typeof input.nonce==='bigint'&&input.nonce>=0n&&input.nonce<2n**256n
  &&typeof input.issuedAt==='bigint'&&typeof input.expiresAt==='bigint'&&input.issuedAt>0n
  &&input.expiresAt>input.issuedAt&&input.expiresAt-input.issuedAt<=86400n&&input.expiresAt<2n**64n,'invalid_wallet_binding');
 return {domain:{name:'RacesOnWalletRegistry',version:'1',chainId:context.chainId,verifyingContract:registry},
  primaryType:'WalletBinding' as const,types:{WalletBinding:[{name:'beneficiaryId',type:'bytes32'},{name:'recipient',type:'address'},
   {name:'beneficiaryKind',type:'uint8'},{name:'nonce',type:'uint256'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},
  message:{...input,beneficiaryId,recipient}} as const;
}
export async function verifyWalletBindingProofV1(context:WalletRegistryContextV1,binding:WalletBindingV1,issuer:Address,proof:Hex){
 const message=walletBindingMessageV1(context,binding);
 const recovered=await recoverTypedDataAddress({...message,signature:signatureBytes(proof)});
 demand(recovered.toLowerCase()===walletAddress(issuer).toLowerCase(),'wallet_binding_issuer_mismatch');
 return hashTypedData(message);
}
export function encodeWalletRegistrationV1(context:WalletRegistryContextV1,binding:WalletBindingV1,proof:Hex){
 const message=walletBindingMessageV1(context,binding).message;
 return encodeFunctionData({abi:walletRegistryAbiV1,functionName:'register',args:[message,signatureBytes(proof)]});
}
export function encodeRegisterAndClaimV5(context:WalletRegistryContextV1,binding:WalletBindingV1,proof:Hex,campaign:Address,entitlementId:Hex){
 const message=walletBindingMessageV1(context,binding).message;
 return encodeFunctionData({abi:walletRegistryAbiV1,functionName:'registerAndClaim',args:[message,signatureBytes(proof),walletAddress(campaign),bytes32(entitlementId)]});
}
export const encodeSponsorDirectClaimV5=(entitlementId:Hex)=>encodeFunctionData({abi:directClaimAbiV5,functionName:'claimDirect',args:[bytes32(entitlementId)]});
export type DirectClaimScopeV5={plan:SponsorExecutionPlan;deploymentHash:Hex;fundingHash:Hex;slot:number;
 entitlementId:Hex;beneficiaryId:Hex;beneficiaryKind:0|1;amountWei:string;explanationHash:Hex};
/** The verified chain state determines claimability. DB award/profile ownership
 * and current session are separate checks at the service boundary. */
export async function observeSponsorDirectClaimV5(reader:SponsorChainReader,input:DirectClaimScopeV5){
 const plan=decodeSponsorExecutionPlan(input.plan);demand((plan.version===5||plan.version===6),'direct_claim_version_required');
 const scope={...input,plan};
 bytes32(scope.entitlementId);bytes32(scope.beneficiaryId);bytes32(scope.explanationHash);
 demand(/^[1-9][0-9]{0,24}$/.test(scope.amountWei)&&(scope.beneficiaryKind===0||scope.beneficiaryKind===1),'invalid_direct_claim');
 const observed=await observeSponsorProgrammePot(reader,plan,scope.deploymentHash,scope.fundingHash,scope.slot);
 const pot=observed.pots.find(p=>p.slot===scope.slot);demand(pot&&observed.funded&&!observed.cancelled,'direct_claim_not_funded');
 const blockNumber=BigInt(observed.blockNumber),campaign=walletAddress(pot.address as Address),registry=walletAddress(plan.walletRegistry as Address);
 const [award,binding]=await Promise.all([
  reader.readContract({address:campaign,abi:directClaimAbiV5,functionName:'entitlements',args:[scope.entitlementId],blockNumber}),
  reader.readContract({address:registry,abi:plan.version===6?walletRegistryAbiV2:walletRegistryAbiV1,functionName:'registrations',args:[scope.beneficiaryId],blockNumber}),
 ]);
 // Approved database awards can be visible before the reviewer uploads them.
 // Only an entirely empty mapping in Review is an expected unpublished award;
 // a conflicting entry or a missing staged/active award must still fail closed.
 const unpublished=pot.state===1&&BigInt(award[0])===0n&&award[1]===0n&&BigInt(award[2])===0n
  &&award[3]===0n&&BigInt(award[4])===0n&&award[5]===0&&award[6]===false&&award[7]===0;
 demand(unpublished||award[0]===scope.beneficiaryId&&award[1]===BigInt(scope.amountWei)&&award[2]===scope.explanationHash
  &&award[5]===(scope.slot===0?1:0)&&award[7]===scope.beneficiaryKind,'direct_claim_award_mismatch');
 demand(binding[2]===0n||binding[1]===scope.beneficiaryKind,'direct_claim_binding_mismatch');
 const allocationDigest=plan.version===6?await reader.readContract({address:campaign,abi:parseAbi(['function allocationDigest() view returns(bytes32)']),functionName:'allocationDigest',blockNumber}):null;
 const anchor=await reader.getBlock({blockNumber});demand(anchor.hash===observed.blockHash&&await reader.getChainId()===plan.chainId,'direct_claim_chain_changed');
 const paid=award[6],recipient=paid?award[4]:binding[0];
 return {observation:observed,campaignAddress:campaign.toLowerCase(),registryAddress:registry.toLowerCase(),
  allocationDigest,clubOwnersHash:plan.version===6?(binding as readonly [Address,number,bigint,Hex])[3]:null,
  entitlementId:scope.entitlementId,beneficiaryId:scope.beneficiaryId,beneficiaryKind:scope.beneficiaryKind,amountWei:scope.amountWei,
  registeredAddress:binding[2]===0n?null:binding[0].toLowerCase(),registrationNonce:binding[2].toString(),
  paid,authorizationNonce:award[3].toString(),recipient:BigInt(recipient)===0n?null:recipient.toLowerCase(),
  claimable:!paid&&pot.state===3&&!pot.paused&&BigInt(observed.blockTimestamp)<BigInt(pot.claimDeadline)&&binding[2]>0n,
  deadline:pot.claimDeadline,paused:pot.paused,state:pot.state};
}

function safeReader(reader:SponsorChainReader):reader is SponsorChainReader&RewardClubSafeDeploymentReader{return 'getStorageAt' in reader&&typeof reader.getStorageAt==='function';}
export async function verifySponsorDirectReceiptV5(reader:SponsorChainReader,scope:DirectClaimScopeV5,hash:Hex,treasury?:DirectClubTreasuryV5){
 const view=await observeSponsorDirectClaimV5(reader,scope);
 const [tx,receipt]=await Promise.all([reader.getTransaction({hash}),reader.getTransactionReceipt({hash})]);
 demand(view.paid&&view.recipient&&tx.hash===hash&&receipt.transactionHash===hash&&tx.chainId===scope.plan.chainId
  &&tx.from.toLowerCase()===receipt.from.toLowerCase()&&tx.value===0n
  &&tx.to?.toLowerCase()===receipt.to?.toLowerCase()&&receipt.status==='success'&&receipt.blockNumber<=BigInt(view.observation.blockNumber)
  &&tx.blockNumber===receipt.blockNumber&&tx.blockHash===receipt.blockHash&&tx.transactionIndex===receipt.transactionIndex,'direct_claim_receipt_mismatch');
 let callTo=tx.to?.toLowerCase(),callData=tx.input;
 if(scope.beneficiaryKind===1&&treasury){
  const target=scope.plan.version===6?view.campaignAddress:treasury.safe.context.verifyingContract;
  if(callTo!==target.toLowerCase()){
   const routed=sponsoredReceiptCall(tx,receipt.logs,target,treasury.safe.owners);
   callTo=routed.to;callData=routed.data;
  }
 }
 if(scope.beneficiaryKind===1&&scope.plan.version===5){
  demand(safeReader(reader)&&treasury&&treasury.safe.context.verifyingContract.toLowerCase()===view.recipient&&callTo===view.recipient,'direct_claim_receipt_mismatch');
  const inner=await directSafeReceiptCallV5(reader,treasury,callData,receipt.logs);callTo=inner.to;callData=inner.data;
 }else if(scope.beneficiaryKind===0)demand(!treasury,'direct_claim_receipt_mismatch');
 else demand(treasury&&treasury.safe.context.verifyingContract.toLowerCase()===view.recipient,'direct_claim_receipt_mismatch');
 // App-paid EIP-7702 claims arrive inside a bundler transaction. Its outer
 // sender/calldata are not the recipient's call. The pinned immutable campaign
 // enforces recipient authorization; its canonical RewardPaid event and paid
 // entitlement below are the payment evidence, irrespective of the gas payer.
 const routedAthlete=scope.beneficiaryKind===0&&tx.from.toLowerCase()!==view.recipient;
 if(scope.plan.version===6&&scope.beneficiaryKind===1){
  demand(callTo===view.campaignAddress,'direct_claim_receipt_mismatch');
  const call=decodeFunctionData({abi:clubClaimAbiV6,data:callData});
  demand(call.functionName==='claimClub'&&call.args[0]===scope.entitlementId&&call.args[1]+1n===BigInt(view.authorizationNonce),'direct_claim_receipt_mismatch');
 }else if(!routedAthlete&&callTo===view.campaignAddress){
  demand(callData===encodeSponsorDirectClaimV5(scope.entitlementId),'direct_claim_receipt_mismatch');
 }else if(!routedAthlete){
  demand(callTo===view.registryAddress,'direct_claim_receipt_mismatch');
  const call=decodeFunctionData({abi:scope.plan.version===6?walletRegistryAbiV2:walletRegistryAbiV1,data:callData});
  demand(call.functionName==='registerAndClaim'&&call.args[0].beneficiaryId===scope.beneficiaryId
   &&call.args[0].recipient.toLowerCase()===view.recipient&&call.args[0].beneficiaryKind===scope.beneficiaryKind
   &&call.args[2].toLowerCase()===view.campaignAddress&&call.args[3]===scope.entitlementId,'direct_claim_receipt_mismatch');
 }
 const events=receipt.logs.filter(log=>!log.removed&&log.address.toLowerCase()===view.campaignAddress
  &&log.transactionHash===hash&&log.blockHash===receipt.blockHash&&log.blockNumber===receipt.blockNumber).flatMap(log=>{
  try{const e=decodeEventLog({abi:directClaimAbiV5,data:log.data,topics:log.topics});return e.eventName==='RewardPaid'?[e]:[];}catch{return [];}
 });
 const matches=events.filter(event=>event.args.entitlementId===scope.entitlementId);
 demand(matches.length===1&&matches[0]!.args.recipient.toLowerCase()===view.recipient
  &&matches[0]!.args.amount===BigInt(scope.amountWei)&&matches[0]!.args.pot===(scope.slot===0?1:0)
  &&matches[0]!.args.nonce+1n===BigInt(view.authorizationNonce),'direct_claim_receipt_mismatch');
 const [block,anchor]=await Promise.all([reader.getBlock({blockNumber:receipt.blockNumber}),reader.getBlock({blockNumber:BigInt(view.observation.blockNumber)})]);
 demand(block.hash===receipt.blockHash&&anchor.hash===view.observation.blockHash&&await reader.getChainId()===scope.plan.chainId,'direct_claim_chain_changed');
 return {transactionHash:hash,amountWei:scope.amountWei,recipient:view.recipient,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
}

/** Registration establishes a treasury destination. It never journals a payment. */
export async function verifyClubRegistrationReceiptV6(reader:SponsorChainReader & RewardClubSafeDeploymentReader,scope:DirectClaimScopeV5,hash:Hex,treasury:DirectClubTreasuryV5){
 demand(scope.plan.version===6&&scope.beneficiaryKind===1,'direct_claim_version_required');
 const view=await observeSponsorDirectClaimV5(reader,scope),safe=treasury.safe.context.verifyingContract.toLowerCase();
 const [tx,r]=await Promise.all([reader.getTransaction({hash}),reader.getTransactionReceipt({hash})]);
 demand(tx.hash===hash&&r.transactionHash===hash&&tx.chainId===scope.plan.chainId&&tx.value===0n
  &&tx.to?.toLowerCase()===r.to?.toLowerCase()&&tx.from.toLowerCase()===r.from.toLowerCase()
  &&r.status==='success'&&r.blockNumber<=BigInt(view.observation.blockNumber)&&tx.blockNumber===r.blockNumber
  &&tx.blockHash===r.blockHash&&tx.transactionIndex===r.transactionIndex,'direct_claim_receipt_mismatch');
 const execution=tx.to?.toLowerCase()===safe?{to:safe,data:tx.input}:sponsoredReceiptCall(tx,r.logs,safe,treasury.safe.owners);
 demand(execution.to===safe,'direct_claim_receipt_mismatch');
 const inner=await directSafeReceiptCallV5(reader,treasury,execution.data,r.logs);
 demand(inner.to===view.registryAddress,'direct_claim_receipt_mismatch');
 const call=decodeFunctionData({abi:walletRegistryAbiV2,data:inner.data});
 demand(call.functionName==='register','direct_claim_receipt_mismatch');
 const binding=call.args[0];
 demand(binding.beneficiaryId===scope.beneficiaryId&&binding.beneficiaryKind===1&&binding.recipient.toLowerCase()===safe
  &&view.registeredAddress===safe&&BigInt(view.registrationNonce)===binding.nonce+1n&&binding.clubOwnersHash===view.clubOwnersHash,'direct_claim_receipt_mismatch');
 const events=r.logs.filter(l=>!l.removed&&l.address.toLowerCase()===view.registryAddress&&l.transactionHash===hash&&l.blockHash===r.blockHash&&l.blockNumber===r.blockNumber).flatMap(l=>{
  try{const e=decodeEventLog({abi:walletRegistryAbiV2,data:l.data,topics:l.topics});return e.eventName==='WalletRegistered'?[e]:[];}catch{return [];}
 });
 demand(events.length===1&&events[0]!.args.beneficiaryId===scope.beneficiaryId&&events[0]!.args.recipient.toLowerCase()===safe
  &&events[0]!.args.beneficiaryKind===1&&events[0]!.args.nonce===BigInt(view.registrationNonce),'direct_claim_receipt_mismatch');
 const [block,anchor]=await Promise.all([reader.getBlock({blockNumber:r.blockNumber}),reader.getBlock({blockNumber:BigInt(view.observation.blockNumber)})]);
 demand(block.hash===r.blockHash&&anchor.hash===view.observation.blockHash&&await reader.getChainId()===scope.plan.chainId,'direct_claim_chain_changed');
 return {transactionHash:hash,blockNumber:r.blockNumber.toString(),blockHash:r.blockHash};
}
