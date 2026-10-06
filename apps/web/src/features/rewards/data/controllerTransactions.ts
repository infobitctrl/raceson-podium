import {z} from 'zod';
import {parseTransaction,recoverTransactionAddress,keccak256,type Hex,type TransactionSerialized} from 'viem';
import {sponsorFactoryBuild} from '@raceson/rewards-chain/sponsor-v4';
import type {ControllerConnection} from '../screens/RewardsControl';
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/);
export const controllerJobSchema=z.object({id:z.string().uuid(),context:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('claim'),claimId:z.string().uuid(),setupId:z.string().uuid(),approvalId:z.string().uuid(),source:z.string()}).strict(),
 z.object({kind:z.literal('clubClaim'),claimId:z.string().uuid(),setupId:z.string().uuid(),approvalId:z.string().uuid(),source:z.string()}).strict(),
 z.object({kind:z.literal('factory'),build:z.literal(sponsorFactoryBuild.creationCodeHash)}).strict(),
 z.object({kind:z.literal('distribution'),setupId:z.string().uuid(),approvalId:z.string().uuid(),action:z.enum(['upload','stage','activate']),start:z.number().int().min(0),end:z.number().int().min(0),source:z.string()}).strict(),
]),transaction:z.object({chainId:z.literal(10143),to:z.string().regex(/^0x[0-9a-f]{40}$/).optional(),data:z.string().regex(/^0x[0-9a-f]+$/),value:z.literal('0'),nonce:uint,gas:uint,gasPrice:uint}).strict(),hash:z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),confirmed:z.boolean(),factory:z.string().regex(/^0x[0-9a-f]{40}$/).nullable()}).strict();
export const controllerNonceStatusSchema=z.object({state:z.enum(['unused','pending','consumed','unavailable']),finalizedNonce:uint.nullable(),pendingNonce:uint.nullable(),observedAt:z.string().datetime().nullable()}).strict();
export type ControllerJob=z.infer<typeof controllerJobSchema>;
export type ControllerSigningProgress='wallet'|'submitting'|'recovering';
export async function confirmControllerJob(connection:ControllerConnection,address:string,j:ControllerJob,onProgress?:(phase:ControllerSigningProgress)=>void){
 if(!connection.signTransaction||!connection.isCurrent())throw Error('controller_session_changed');
 if(sessionStorage.getItem(`raceson:controller-signed:10143:${connection.subject}:${j.id}`)){onProgress?.('recovering');return recoverControllerJob(connection,j);}
 const t=j.transaction,c=j.context;
 if(j.hash){onProgress?.('recovering');return controllerJobSchema.parse(await connection.request('/transactions',{action:'resume',id:j.id}));}
 if(BigInt(t.gas)<=0n||BigInt(t.gas)>30_000_000n||BigInt(t.gasPrice)<=0n||!Number.isSafeInteger(Number(t.nonce)))throw Error('controller_transaction_invalid');
 if(BigInt(t.gas)*BigInt(t.gasPrice)>(c.kind==='factory'?3_000_000_000_000_000_000n:500_000_000_000_000_000n))throw Error('controller_gas_limit');
 if(c.kind==='factory'&&(t.to||t.data!==sponsorFactoryBuild.bytecode))throw Error('controller_transaction_invalid');
 onProgress?.('wallet');
 let bytes:string;
 try{bytes=await connection.signTransaction(address,{chainId:10143,to:t.to,data:t.data,value:"0",nonce:t.nonce,gas:t.gas,gasPrice:t.gasPrice});}
 catch(error){if(error&&typeof error==='object'&&'code' in error&&(error.code===4001||error.code==='ACTION_REJECTED'))throw Error('controller_wallet_rejected');throw error;}
 const p=parseTransaction(bytes as TransactionSerialized);
 if(!connection.isCurrent())throw Error('controller_session_changed');
 const checks={type:p.type==='legacy',network:p.chainId===10143,data:p.data===t.data,recipient:(p.to?.toLowerCase()??undefined)===t.to,value:(p.value??0n)===0n,nonce:p.nonce===Number(t.nonce),gas:p.gas===BigInt(t.gas),fee:p.gasPrice===BigInt(t.gasPrice),wallet:(await recoverTransactionAddress({serializedTransaction:bytes as TransactionSerialized})).toLowerCase()===address};
 const changed=Object.entries(checks).filter(([,matches])=>!matches).map(([name])=>name);
 if(changed.length)throw Error(`controller_wallet_changed:${changed.join(', ')}`);
 // Store locally BEFORE submission as a second recovery copy. Never display raw signatures.
 const key=`raceson:controller-signed:10143:${connection.subject}:${j.id}`;
 try{sessionStorage.setItem(key,JSON.stringify({id:j.id,hash:keccak256(bytes as Hex),signedTransaction:bytes}));}catch{throw Error('controller_recovery_storage_unavailable');}
 onProgress?.('submitting');
 const result=controllerJobSchema.parse(await connection.request('/transactions',{action:'submit',id:j.id,signedTransaction:bytes}));
 if(result.hash!==keccak256(bytes as Hex))throw Error('controller_transaction_invalid');
 sessionStorage.removeItem(key);return result;
}
export async function recoverControllerJob(connection:ControllerConnection,j:ControllerJob){
 if(!connection.isCurrent())throw Error('controller_session_changed');
 const key=`raceson:controller-signed:10143:${connection.subject}:${j.id}`,saved=sessionStorage.getItem(key);
 if(!saved&&!j.hash)throw Error('controller_local_signature_missing');
 if(saved&&!j.hash){const s=z.object({id:z.literal(j.id),hash:z.string(),signedTransaction:z.string()}).strict().parse(JSON.parse(saved));const r=controllerJobSchema.parse(await connection.request('/transactions',{action:'submit',id:j.id,signedTransaction:s.signedTransaction}));if(r.hash!==s.hash)throw Error('controller_transaction_invalid');sessionStorage.removeItem(key);return r;}
 return controllerJobSchema.parse(await connection.request('/transactions',{action:'resume',id:j.id}));
}
