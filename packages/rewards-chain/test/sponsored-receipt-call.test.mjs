import test from 'node:test';
import assert from 'node:assert/strict';
import {concatHex,encodeAbiParameters,encodeEventTopics,encodeFunctionData,parseAbi,toHex,zeroAddress,zeroHash} from 'viem';
import {sponsoredReceiptCall} from '../dist/sponsored-receipt-call.js';
const entry='0x0000000071727de22e5e9d8baf0edac6f37da032',owner='0x'+'ab'.repeat(20),target='0x'+'cd'.repeat(20),other='0x'+'ef'.repeat(20);
const abi=parseAbi(['function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)','function execute(bytes32 mode,bytes executionCalldata)','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
function fixture({sender=owner,to=target,value=0n,mode=zeroHash,success=true,eventNonce=7n,duplicateOp=false}={}){
 const callData=encodeFunctionData({abi,functionName:'execute',args:[mode,concatHex([to,toHex(value,{size:32}),'0x12345678'])]});
 const op={sender,nonce:7n,initCode:'0x',callData,accountGasLimits:zeroHash,preVerificationGas:0n,gasFees:zeroHash,paymasterAndData:'0x',signature:'0x'};
 const tx={to:entry,chainId:10143,hash:toHex(1n,{size:32}),blockHash:toHex(2n,{size:32}),blockNumber:100n,input:encodeFunctionData({abi,functionName:'handleOps',args:[duplicateOp?[op,op]:[op],zeroAddress]})};
 const log={address:entry,transactionHash:tx.hash,blockHash:tx.blockHash,blockNumber:tx.blockNumber,removed:false,
  topics:encodeEventTopics({abi,eventName:'UserOperationEvent',args:{userOpHash:toHex(3n,{size:32}),sender,paymaster:zeroAddress}}),
  data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[eventNonce,success,1n,1n])};
 return {tx,logs:[log]};
}
test('unwraps the exact single zero-value call and ties it to the current owner successful operation',()=>{
 const {tx,logs}=fixture();assert.deepEqual(sponsoredReceiptCall(tx,logs,target,[owner]),{to:target,data:'0x12345678',sender:owner});
});
for(const [name,options] of [['wrong owner',{sender:other}],['wrong target',{to:other}],['nonzero value',{value:1n}],['batch mode',{mode:toHex(1n<<248n,{size:32})}],['failed operation',{success:false}],['different nonce',{eventNonce:8n}],['duplicate operation',{duplicateOp:true}]]){
 test('rejects '+name,()=>{const {tx,logs}=fixture(options);assert.throws(()=>sponsoredReceiptCall(tx,logs,target,[owner]));});
}
for(const [name,change] of [['wrong chain',f=>f.tx.chainId=1],['wrong EntryPoint',f=>f.tx.to=other],['missing finalized identity',f=>f.tx.blockHash=null],['removed event',f=>f.logs[0].removed=true],['different event block',f=>f.logs[0].blockHash=zeroHash],['different event transaction',f=>f.logs[0].transactionHash=zeroHash],['wrong event origin',f=>f.logs[0].address=other],['missing event',f=>f.logs=[]],['duplicate event',f=>f.logs.push(f.logs[0])],['malformed calldata',f=>f.tx.input='0x1234']]){
 test('rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>sponsoredReceiptCall(f.tx,f.logs,target,[owner]));});
}
