import {concatHex,decodeEventLog,decodeFunctionData,encodeFunctionData,hashTypedData,parseAbi,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {readVerifiedRewardClubSafeDeployment,type RewardClubSafeDeploymentReader} from './club-safe-deployment.js';
import type {RewardClubSafeExpectation} from './club-safe.js';
import {demand,walletAddress} from './validation.js';
export const directSafeAbiV5=parseAbi([
 'function nonce() view returns(uint256)',
 'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool success)',
 'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)',
 'event ExecutionFailure(bytes32 indexed txHash,uint256 payment)',
]);
const zero='0x0000000000000000000000000000000000000000' as Address;
export type DirectClubTreasuryV5={safe:RewardClubSafeExpectation;factoryAddress:Address;deploymentTransactionHash:Hex};
export type DirectSafeCallV5={chainId:10143|31337;safe:Address;to:Address;data:Hex;nonce:bigint};
export function directSafeMessageV5(call:DirectSafeCallV5){
 demand((call.chainId===10143||call.chainId===31337)&&call.nonce>=0n&&call.nonce<2n**256n&&/^0x[0-9a-fA-F]+$/.test(call.data),'invalid_direct_safe_call');
 const safe=walletAddress(call.safe),to=walletAddress(call.to);demand(safe!==to,'invalid_direct_safe_call');
 return {domain:{chainId:call.chainId,verifyingContract:safe},primaryType:'SafeTx' as const,types:{SafeTx:[
  {name:'to',type:'address'},{name:'value',type:'uint256'},{name:'data',type:'bytes'},{name:'operation',type:'uint8'},
  {name:'safeTxGas',type:'uint256'},{name:'baseGas',type:'uint256'},{name:'gasPrice',type:'uint256'},
  {name:'gasToken',type:'address'},{name:'refundReceiver',type:'address'},{name:'nonce',type:'uint256'}]},
  message:{to,value:0n,data:call.data,operation:0,safeTxGas:0n,baseGas:0n,gasPrice:0n,gasToken:zero,refundReceiver:zero,nonce:call.nonce}} as const;
}
export async function verifyDirectSafeSignaturesV5(call:DirectSafeCallV5,owners:readonly Address[],signatures:readonly Hex[]){
 demand(owners.length===3&&new Set(owners.map(a=>a.toLowerCase())).size===3&&signatures.length===2,'reward_club_two_signatures_required');
 const typed=directSafeMessageV5(call),proofs=await Promise.all(signatures.map(async signature=>{
  demand(/^0x[0-9a-fA-F]{130}$/.test(signature)&&[27,28].includes(Number.parseInt(signature.slice(-2),16)),'reward_club_consent_invalid');
  const signer=(await recoverTypedDataAddress({...typed,signature})).toLowerCase() as Address;
  demand(owners.some(a=>a.toLowerCase()===signer),'reward_club_consent_invalid');return{signer,signature};
 }));
 demand(proofs[0]!.signer!==proofs[1]!.signer,'reward_club_two_signatures_required');proofs.sort((a,b)=>a.signer.localeCompare(b.signer));
 return{digest:hashTypedData(typed),signers:proofs.map(p=>p.signer),signature:concatHex(proofs.map(p=>p.signature))};
}
export function encodeDirectSafeCallV5(call:DirectSafeCallV5,signature:Hex){
 const m=directSafeMessageV5(call).message;demand(/^0x[0-9a-fA-F]{260}$/.test(signature),'reward_club_two_signatures_required');
 return encodeFunctionData({abi:directSafeAbiV5,functionName:'execTransaction',args:[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,signature]});
}
export async function observeDirectClubTreasuryV5(reader:RewardClubSafeDeploymentReader,treasury:DirectClubTreasuryV5){
 const verified=await readVerifiedRewardClubSafeDeployment(reader,treasury);
 const nonce=await reader.readContract({address:treasury.safe.context.verifyingContract,abi:directSafeAbiV5,functionName:'nonce',blockNumber:verified.safe.finalizedBlock.number});
 const anchor=await reader.getBlock({blockNumber:verified.safe.finalizedBlock.number});demand(anchor.hash===verified.safe.finalizedBlock.hash,'reward_club_checkpoint_changed');
 return {...verified,nonce};
}
/** Safe execution enforces its original 2-of-3 quorum on chain. The outer gas
 * payer is not the recipient and cannot replace either owner signature. */
export async function directSafeReceiptCallV5(reader:RewardClubSafeDeploymentReader,treasury:DirectClubTreasuryV5,input:Hex,
 logs:readonly {address:string;data:Hex;topics:readonly Hex[];removed?:boolean}[]){
 await observeDirectClubTreasuryV5(reader,treasury);
 const decoded=decodeFunctionData({abi:directSafeAbiV5,data:input});demand(decoded.functionName==='execTransaction','direct_claim_receipt_mismatch');
 const a=decoded.args;demand(a[1]===0n&&a[3]===0&&a[4]===0n&&a[5]===0n&&a[6]===0n&&a[7]===zero&&a[8]===zero&&/^0x[0-9a-fA-F]{260}$/.test(a[9]),'direct_claim_receipt_mismatch');
 const events=logs.filter(l=>!l.removed&&l.address.toLowerCase()===treasury.safe.context.verifyingContract.toLowerCase()).flatMap(l=>{
  try{return[decodeEventLog({abi:directSafeAbiV5,data:l.data,topics:l.topics as [Hex,...Hex[]]})];}catch{return[];}
 });
 demand(events.length===1&&events[0]!.eventName==='ExecutionSuccess'&&events[0]!.args.payment===0n,'direct_claim_receipt_mismatch');
 return {to:a[0].toLowerCase(),data:a[2]};
}
