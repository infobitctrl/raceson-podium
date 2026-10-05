import {it,expect,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {toHex} from 'viem';
import {sponsorClaimMessagesV4,encodeSponsorClaimV4} from '@raceson/rewards-chain/sponsor-claims-v4';
import {signProgrammeClaim,sendProgrammeTransaction} from './sponsorProgrammeWallet';
import type {SponsorClaim} from './sponsorProgramme';
const recipient=privateKeyToAccount(toHex(712345n,{size:32})),operator=privateKeyToAccount(toHex(712346n,{size:32}));
const context={environment:'local-simulation' as const,chainId:31337 as const,verifyingContract:'0x'+'11'.repeat(20) as `0x${string}`};
const claim={entitlementId:'0x'+'22'.repeat(32) as `0x${string}`,recipient:recipient.address.toLowerCase() as `0x${string}`,amount:99n,pot:'race' as const,nonce:0n,issuedAt:1801000000n,expiresAt:1801000600n,allocationDigest:'0x'+'33'.repeat(32) as `0x${string}`};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
function view(){return json({schema:'raceson-sponsor-claim-view-v4',claimId:'73000000-0000-4000-8000-000000000001',approvalId:'73000000-0000-4000-8000-000000000002',role:'recipient',chainId:31337,current:true,status:'awaiting_consent',address:claim.recipient,operatorAddress:operator.address.toLowerCase(),context,claim,signing:sponsorClaimMessagesV4(context,claim).consent,transaction:null,receipt:null}) as SponsorClaim;}
function provider(signer=recipient){const listeners=new Map<string,()=>void>();return{on:vi.fn((e:string,cb:()=>void)=>listeners.set(e,cb)),removeListener:vi.fn((e:string)=>listeners.delete(e)),listeners,request:vi.fn(async({method,params}:{method:string;params?:unknown[]}):Promise<unknown>=>{
 if(method==='eth_accounts')return[signer.address];if(method==='eth_chainId')return'0x7a69';if(method==='eth_estimateGas')return'0x186a0';if(method==='eth_gasPrice')return'0x1';if(method==='eth_sendTransaction')return'0x'+'44'.repeat(32);
 if(method==='eth_signTypedData_v4'){const t=JSON.parse(params![1] as string);return signer.signTypedData(t);}throw Error(method);
})};}
it('signs only the exact domain-5 ReceiveReward message and rejects tampered amounts/domains',async()=>{
 const p=provider(),v=view();expect(await signProgrammeClaim(p,v,()=>true)).toMatch(/^0x[0-9a-f]{130}$/);
 expect(JSON.parse(p.request.mock.calls.find(c=>c[0].method==='eth_signTypedData_v4')![0].params![1] as string).types.EIP712Domain).toHaveLength(4);
 for(const mutation of [(x:any)=>x.signing.domain.version='4',(x:any)=>x.signing.message.amount='100',(x:any)=>x.context.chainId=1]){const bad=view();mutation(bad);await expect(signProgrammeClaim(p,bad,()=>true)).rejects.toThrow();}
});
it('wallet changes during consent discard the signature and detach listeners',async()=>{
 const p=provider(),base=p.request.getMockImplementation()!;p.request.mockImplementation(async x=>{const out=await base(x);if(x.method==='eth_signTypedData_v4')p.listeners.get('chainChanged')?.();return out;});
 await expect(signProgrammeClaim(p,view(),()=>true)).rejects.toThrow('wallet_changed');expect(p.listeners.size).toBe(0);
});
it('payment broadcasts only exact recipient/operator proofs, enforces gas ceiling and retains a returned hash after session change',async()=>{
 const v=view(),messages=sponsorClaimMessagesV4(context,claim),proofs={recipient:await recipient.signTypedData(messages.consent),operator:await operator.signTypedData(messages.authorization)};
 v.role='operator';v.transaction={chainId:31337,from:operator.address.toLowerCase(),to:context.verifyingContract,value:'0',data:encodeSponsorClaimV4(context,claim,proofs)};
 const p=provider(operator);let current=true;const base=p.request.getMockImplementation()!;p.request.mockImplementation(async x=>{const out=await base(x);if(x.method==='eth_sendTransaction')current=false;return out;});
 expect(await sendProgrammeTransaction(p,v,()=>current)).toBe('0x'+'44'.repeat(32));
 const expensive=provider(operator);const original=expensive.request.getMockImplementation()!;expensive.request.mockImplementation(async x=>x.method==='eth_gasPrice'?'0xffffffffffff':original(x));
 await expect(sendProgrammeTransaction(expensive,v,()=>true)).rejects.toThrow('sponsor_gas_limit');expect(expensive.request.mock.calls.some(c=>c[0].method==='eth_sendTransaction')).toBe(false);
 const altered=structuredClone(v);altered.transaction!.to='0x'+'55'.repeat(20);await expect(sendProgrammeTransaction(provider(operator),altered,()=>true)).rejects.toThrow('invalid_transaction');
});

it('accepts Privy bigint gas estimates while retaining proof, gas and account guards',async()=>{
 const v=view(),messages=sponsorClaimMessagesV4(context,claim),proofs={recipient:await recipient.signTypedData(messages.consent),operator:await operator.signTypedData(messages.authorization)};
 v.role='operator';v.transaction={chainId:31337,from:operator.address.toLowerCase(),to:context.verifyingContract,value:'0',data:encodeSponsorClaimV4(context,claim,proofs)};
 for(const estimate of [100000n,0n,-1n,30000001n]){
  const p=provider(operator),base=p.request.getMockImplementation()!;
  p.request.mockImplementation(async x=>x.method==='eth_estimateGas'?estimate:base(x));
  if(estimate===100000n){await expect(sendProgrammeTransaction(p,v,()=>true)).resolves.toMatch(/^0x/);expect(p.request.mock.calls.find(c=>c[0].method==='eth_sendTransaction')?.[0].params).toEqual([expect.objectContaining({gas:'0x1d4c0'})]);}
  else {await expect(sendProgrammeTransaction(p,v,()=>true)).rejects.toThrow('sponsor_gas_limit');expect(p.request.mock.calls.some(c=>c[0].method==='eth_sendTransaction')).toBe(false);}
 }
 const wrong=provider(recipient);await expect(sendProgrammeTransaction(wrong,v,()=>true)).rejects.toThrow('wallet_changed');expect(wrong.request.mock.calls.some(c=>c[0].method==='eth_sendTransaction')).toBe(false);
});
