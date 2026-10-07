import {it,expect,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {toHex} from 'viem';
import {walletBindingMessageV1,encodeRegisterAndClaimV5} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import {directSafeMessageV5} from '@raceson/rewards-chain/sponsor-club-direct-v5';
import {directClubCallV5,signDirectClubClaimV5,sendDirectClubClaimV5,type ClubDirectClaimV5} from './clubDirectClaimsV5';
const signer=(n:number)=>privateKeyToAccount(toHex(BigInt(n),{size:32}));
const issuer=signer(9301),owners=[signer(9302),signer(9303),signer(9304)],registry=`0x${'ab'.repeat(20)}` as const,campaign=`0x${'cd'.repeat(20)}` as const,safe=`0x${'34'.repeat(20)}` as const,id=`0x${'ef'.repeat(32)}` as const;
async function fixture():Promise<ClubDirectClaimV5>{
 const now=BigInt(Math.floor(Date.now()/1000)),binding={beneficiaryId:id,recipient:safe,beneficiaryKind:1 as const,nonce:0n,issuedAt:now,expiresAt:now+600n},context={registry,chainId:10143 as const};
 const proof=await issuer.signTypedData(walletBindingMessageV1(context,binding));
 return {schema:'podium-club-direct-claim-v5',approvalId:'75000000-0000-4000-8000-000000000001',creationId:'75000000-0000-4000-8000-000000000002',clubId:'75000000-0000-4000-8000-000000000003',safeAddress:safe,owners:owners.map(o=>o.address.toLowerCase()),safeNonce:'0',entitlementId:id,chainId:10143,amountWei:'100',campaignAddress:campaign,registryAddress:registry,identityIssuer:issuer.address.toLowerCase(),beneficiaryId:id,status:'claimable',recipient:null,deadline:(now+86400n).toString(),receipt:null,rehearsalPolicy:'podium-demo-alias-rehearsal-v1',transaction:{chainId:10143,from:safe,to:registry,data:encodeRegisterAndClaimV5(context,binding,proof,campaign,id),value:'0',identityProof:proof,binding:{...binding,nonce:'0',issuedAt:now.toString(),expiresAt:(now+600n).toString()}}};
}
function provider(account=owners[0]){
 const listeners=new Map<string,()=>void>();
 const request=vi.fn(async({method,params}:{method:string;params?:unknown[]})=>{
  if(method==='eth_signTypedData_v4')return account.signTypedData(JSON.parse(params![1] as string));
  return {eth_accounts:[account.address],eth_chainId:'0x279f',eth_call:'0x0',eth_estimateGas:'0x30d40',eth_gasPrice:'0x1',eth_sendTransaction:id}[method];
 });return{request,on:vi.fn((e,cb)=>listeners.set(e,cb)),removeListener:vi.fn(e=>listeners.delete(e)),listeners};
}
it('reconstructs only an exact club binding and rejects destination, award, issuer and value substitutions',async()=>{
 const v=await fixture();expect((await directClubCallV5(v)).safe).toBe(safe);
 for(const patch of [{safeAddress:registry},{campaignAddress:registry},{entitlementId:'0x'+'12'.repeat(32)},{identityIssuer:owners[0].address.toLowerCase()},{transaction:{...v.transaction!,value:'1'}},{transaction:{...v.transaction!,data:'0x00'}},{transaction:{...v.transaction!,binding:{...v.transaction!.binding!,beneficiaryKind:0}}}])await expect(directClubCallV5({...v,...patch} as ClubDirectClaimV5)).rejects.toThrow();
});
it('two distinct owners sign exact SafeTx; duplicate, changed nonce or non-owner signatures cannot submit',async()=>{
 const v=await fixture(),p=provider(),address=owners[0].address.toLowerCase();
 const first=await signDirectClubClaimV5(p,v,address,()=>true),call=await directClubCallV5(v);
 const second=await owners[1].signTypedData(directSafeMessageV5(call));
 for(const signatures of [[first,first],[first,await issuer.signTypedData(directSafeMessageV5(call))],[first,await owners[1].signTypedData(directSafeMessageV5({...call,nonce:1n}))]]){
  await expect(sendDirectClubClaimV5(p,v,signatures,address,()=>true)).rejects.toThrow();
 }
 expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);
 await expect(sendDirectClubClaimV5(p,v,[first,second],address,()=>true)).resolves.toBe(id);expect(p.listeners.size).toBe(0);
});
it('changed wallet, chain, pending Safe nonce, revoked session or excessive fee blocks broadcast',async()=>{
 const v=await fixture(),call=await directClubCallV5(v),signatures=await Promise.all(owners.slice(0,2).map(o=>o.signTypedData(directSafeMessageV5(call))));
 for(const mode of ['wallet','network','nonce','session','fee','event']){
  const p=provider(),base=p.request.getMockImplementation()!;p.request.mockImplementation(async args=>{
   if(mode==='wallet'&&args.method==='eth_accounts')return[issuer.address];if(mode==='network'&&args.method==='eth_chainId')return'0x1';
   if(mode==='nonce'&&args.method==='eth_call')return'0x1';if(mode==='fee'&&args.method==='eth_gasPrice')return'0xffffffffffffffff';
   if(mode==='event'&&args.method==='eth_gasPrice')p.listeners.get('accountsChanged')?.();return base(args);
  });
  await expect(sendDirectClubClaimV5(p,v,signatures,owners[0].address.toLowerCase(),()=>mode!=='session')).rejects.toThrow();
  expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
 }
});
