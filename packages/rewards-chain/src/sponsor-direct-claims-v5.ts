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
 const plan=decodeSponsorExecutionPlan(input.plan);demand(plan.version===5,'direct_claim_version_required');
 const scope={...input,plan};
 bytes32(scope.entitlementId);bytes32(scope.beneficiaryId);bytes32(scope.explanationHash);
 demand(/^[1-9][0-9]{0,24}$/.test(scope.amountWei)&&(scope.beneficiaryKind===0||scope.beneficiaryKind===1),'invalid_direct_claim');
 const observed=await observeSponsorProgrammePot(reader,plan,scope.deploymentHash,scope.fundingHash,scope.slot);
 const pot=observed.pots.find(p=>p.slot===scope.slot);demand(pot&&observed.funded&&!observed.cancelled,'direct_claim_not_funded');
 const blockNumber=BigInt(observed.blockNumber),campaign=walletAddress(pot.address as Address),registry=walletAddress(plan.walletRegistry as Address);
 const [award,binding]=await Promise.all([
  reader.readContract({address:campaign,abi:directClaimAbiV5,functionName:'entitlements',args:[scope.entitlementId],blockNumber}),
  reader.readContract({address:registry,abi:walletRegistryAbiV1,functionName:'registrations',args:[scope.beneficiaryId],blockNumber}),
 ]);
 demand(award[0]===scope.beneficiaryId&&award[1]===BigInt(scope.amountWei)&&award[2]===scope.explanationHash
  &&award[5]===(scope.slot===0?1:0)&&award[7]===scope.beneficiaryKind,'direct_claim_award_mismatch');
 demand(binding[2]===0n||binding[1]===scope.beneficiaryKind,'direct_claim_binding_mismatch');
 const anchor=await reader.getBlock({blockNumber});demand(anchor.hash===observed.blockHash&&await reader.getChainId()===plan.chainId,'direct_claim_chain_changed');
 const paid=award[6],recipient=paid?award[4]:binding[0];
 return {observation:observed,campaignAddress:campaign.toLowerCase(),registryAddress:registry.toLowerCase(),
  entitlementId:scope.entitlementId,beneficiaryId:scope.beneficiaryId,beneficiaryKind:scope.beneficiaryKind,amountWei:scope.amountWei,
  registeredAddress:binding[2]===0n?null:binding[0].toLowerCase(),registrationNonce:binding[2].toString(),
  paid,recipient:BigInt(recipient)===0n?null:recipient.toLowerCase(),
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
 if(scope.beneficiaryKind===1){
  demand(safeReader(reader)&&treasury&&treasury.safe.context.verifyingContract.toLowerCase()===view.recipient&&callTo===view.recipient,'direct_claim_receipt_mismatch');
  const inner=await directSafeReceiptCallV5(reader,treasury,tx.input,receipt.logs);callTo=inner.to;callData=inner.data;
 }else demand(!treasury&&tx.from.toLowerCase()===view.recipient,'direct_claim_receipt_mismatch');
 if(callTo===view.campaignAddress){
  demand(callData===encodeSponsorDirectClaimV5(scope.entitlementId),'direct_claim_receipt_mismatch');
 }else{
  demand(callTo===view.registryAddress,'direct_claim_receipt_mismatch');
  const call=decodeFunctionData({abi:walletRegistryAbiV1,data:callData});
  demand(call.functionName==='registerAndClaim'&&call.args[0].beneficiaryId===scope.beneficiaryId
   &&call.args[0].recipient.toLowerCase()===view.recipient&&call.args[0].beneficiaryKind===scope.beneficiaryKind
   &&call.args[2].toLowerCase()===view.campaignAddress&&call.args[3]===scope.entitlementId,'direct_claim_receipt_mismatch');
 }
 const events=receipt.logs.filter(log=>!log.removed&&log.address.toLowerCase()===view.campaignAddress).flatMap(log=>{
  try{const e=decodeEventLog({abi:directClaimAbiV5,data:log.data,topics:log.topics});return e.eventName==='RewardPaid'?[e]:[];}catch{return [];}
 });
 demand(events.length===1&&events[0]!.args.entitlementId===scope.entitlementId&&events[0]!.args.recipient.toLowerCase()===view.recipient
  &&events[0]!.args.amount===BigInt(scope.amountWei)&&events[0]!.args.pot===(scope.slot===0?1:0),'direct_claim_receipt_mismatch');
 const [block,anchor]=await Promise.all([reader.getBlock({blockNumber:receipt.blockNumber}),reader.getBlock({blockNumber:BigInt(view.observation.blockNumber)})]);
 demand(block.hash===receipt.blockHash&&anchor.hash===view.observation.blockHash&&await reader.getChainId()===scope.plan.chainId,'direct_claim_chain_changed');
 return {transactionHash:hash,amountWei:scope.amountWei,recipient:view.recipient,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
}
