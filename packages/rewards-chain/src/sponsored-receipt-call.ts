import {decodeEventLog,decodeFunctionData,parseAbi,type Address,type Hex} from 'viem';
import {demand} from './validation.js';
const entryPoint='0x0000000071727de22e5e9d8baf0edac6f37da032';
const abi=parseAbi([
 'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
 'function execute(bytes32 mode,bytes executionCalldata)',
 'event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)',
]);
type Transaction={to:Address|null;input:Hex;chainId?:number;hash:Hex;blockHash:Hex|null;blockNumber:bigint|null};
type Log={address:string;data:Hex;topics:readonly Hex[];removed?:boolean;transactionHash:Hex;blockHash:Hex;blockNumber:bigint};
/** Unwrap one successful, zero-value, single CALL from an existing club owner.
 * This only identifies calldata: the caller still verifies the exact Safe or
 * campaign call, quorum, registration/award nonce, events and finalized state. */
export function sponsoredReceiptCall(tx:Transaction,logs:readonly Log[],target:string,owners:readonly string[]){
 const code='direct_claim_receipt_mismatch';
 demand((tx.chainId===10143||tx.chainId===31337)&&tx.to?.toLowerCase()===entryPoint&&tx.blockHash&&tx.blockNumber!==null,code);
 const outer=decodeFunctionData({abi,data:tx.input});demand(outer.functionName==='handleOps',code);
 const candidates=outer.args[0].filter(op=>owners.some(owner=>owner.toLowerCase()===op.sender.toLowerCase())).flatMap(op=>{
  const execution=decodeFunctionData({abi,data:op.callData});demand(execution.functionName==='execute',code);
  const [mode,packed]=execution.args;
  demand(BigInt(mode)===0n&&packed.length>=106,code);
  const to=packed.slice(0,42).toLowerCase();if(to!==target.toLowerCase())return [];
  demand(BigInt(`0x${packed.slice(42,106)}`)===0n,code);
  const events=logs.filter(log=>!log.removed&&log.address.toLowerCase()===entryPoint&&log.transactionHash===tx.hash
   &&log.blockHash===tx.blockHash&&log.blockNumber===tx.blockNumber).flatMap(log=>{
    try{return[decodeEventLog({abi,data:log.data,topics:log.topics as [Hex,...Hex[]]})];}catch{return [];}
   }).filter(event=>event.eventName==='UserOperationEvent'&&event.args.sender.toLowerCase()===op.sender.toLowerCase()&&event.args.nonce===op.nonce);
  demand(events.length===1&&events[0]!.eventName==='UserOperationEvent'&&events[0]!.args.success,code);
  return [{to,data:`0x${packed.slice(106)}` as Hex,sender:op.sender.toLowerCase()}];
 });
 demand(candidates.length===1,code);return candidates[0]!;
}
