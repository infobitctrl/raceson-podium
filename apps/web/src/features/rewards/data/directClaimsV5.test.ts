import {describe,it,expect,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {toHex} from 'viem';
import {walletBindingMessageV1,encodeRegisterAndClaimV5,encodeSponsorDirectClaimV5} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import {sendDirectClaimV5,validateDirectClaimTransactionV5,type DirectClaimV5} from './directClaimsV5';
import {sponsorAwardSchema} from './sponsorAwardCodec';
// Disposable deterministic signers only. No provider, real account or payment.
const issuer=privateKeyToAccount(toHex(9201n,{size:32})),athlete=privateKeyToAccount(toHex(9202n,{size:32}));
const registry=`0x${'ab'.repeat(20)}` as const,campaign=`0x${'cd'.repeat(20)}` as const,id=`0x${'ef'.repeat(32)}` as const;
async function fixture():Promise<DirectClaimV5>{
 const now=BigInt(Math.floor(Date.now()/1000));
 const binding={beneficiaryId:id,recipient:athlete.address.toLowerCase() as `0x${string}`,beneficiaryKind:0 as const,nonce:0n,issuedAt:now,expiresAt:now+600n};
 const context={registry,chainId:10143 as const},proof=await issuer.signTypedData(walletBindingMessageV1(context,binding));
 return {schema:'podium-direct-claim-v5',approvalId:'72000000-0000-4000-8000-000000000001',entitlementId:id,chainId:10143,amountWei:'100',campaignAddress:campaign,registryAddress:registry,identityIssuer:issuer.address.toLowerCase(),beneficiaryId:id,status:'claimable',recipient:null,deadline:(now+86400n).toString(),receipt:null,rehearsalPolicy:'podium-demo-alias-rehearsal-v1',transaction:{chainId:10143,from:binding.recipient,to:registry,data:encodeRegisterAndClaimV5(context,binding,proof,campaign,id),value:'0',identityProof:proof,binding:{...binding,nonce:'0',issuedAt:now.toString(),expiresAt:(now+600n).toString()}}};
}
function provider(){
 const listeners=new Map<string,()=>void>();
 const request=vi.fn(async({method}:{method:string})=>({eth_accounts:[athlete.address],eth_chainId:'0x279f',eth_estimateGas:'0x30d40',eth_gasPrice:'0x1',eth_getBalance:'0x100000000',eth_sendTransaction:id}[method]));
 return {request,on:vi.fn((name:string,cb:()=>void)=>listeners.set(name,cb)),removeListener:vi.fn((name:string)=>listeners.delete(name)),listeners};
}
describe('athlete direct claim transaction boundary',()=>{
 it('rebuilds the exact atomic claim and rejects changed award, recipient, issuer, data or payment value',async()=>{
  const v=await fixture();await expect(validateDirectClaimTransactionV5(v)).resolves.toEqual(v.transaction);
  for(const patch of [{campaignAddress:registry},{entitlementId:`0x${'12'.repeat(32)}`},{identityIssuer:athlete.address.toLowerCase()},{transaction:{...v.transaction!,from:issuer.address.toLowerCase()}},{transaction:{...v.transaction!,data:'0x00'}},{transaction:{...v.transaction!,value:'1'}},{transaction:{...v.transaction!,binding:{...v.transaction!.binding!,expiresAt:'1'}}}])await expect(validateDirectClaimTransactionV5({...v,...patch} as DirectClaimV5)).rejects.toThrow();
 });
 it('a registered wallet needs only its direct claim transaction',async()=>{
  const v=await fixture();v.recipient=v.transaction!.from;v.transaction={...v.transaction!,to:campaign,data:encodeSponsorDirectClaimV5(id),binding:null,identityProof:null};
  await expect(validateDirectClaimTransactionV5(v)).resolves.toEqual(v.transaction);
  const p=provider();await expect(sendDirectClaimV5(p,v,()=>true,vi.fn().mockResolvedValue({hash:id}))).resolves.toBe(id);
  expect(p.request.mock.calls.map(([x])=>x.method)).toEqual(['eth_accounts','eth_chainId','eth_accounts','eth_chainId']);
  expect(p.listeners.size).toBe(0);
 });
 it('wallet/network/session changes stop sponsored submission',async()=>{
  const v=await fixture();
  for(const mode of ['account','network','session','event']){
   const p=provider(),original=p.request.getMockImplementation()!;
   p.request.mockImplementation(async args=>{
    if(mode==='account'&&args.method==='eth_accounts')return [issuer.address];
    if(mode==='network'&&args.method==='eth_chainId')return '0x1';
        if(mode==='event'&&args.method==='eth_chainId')p.listeners.get('accountsChanged')?.();
    return original(args);
   });
   const send=vi.fn();await expect(sendDirectClaimV5(p,v,()=>mode!=='session',send)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
   expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
  }
 });
 it('cannot disguise a legacy approval queue as a direct award',()=>{
  const a={approvalId:'72000000-0000-4000-8000-000000000001',entitlementId:id,slot:1,amountWei:'100',athleteProfileId:null,claims:[]};
  expect(sponsorAwardSchema.safeParse(a).success).toBe(true);
  expect(sponsorAwardSchema.safeParse({...a,protocolVersion:5,directClaim:{paid:false}}).success).toBe(true);
  for(const patch of [{protocolVersion:5},{directClaim:{paid:false}},{protocolVersion:5,directClaim:{paid:false},claims:[{id:a.approvalId,prepared:true,consented:false,approved:false,paid:false}]}])expect(sponsorAwardSchema.safeParse({...a,...patch}).success).toBe(false);
 });
});

it.each(['0x0','0x1'])('sponsors an athlete with balance %s without requesting funds or a raw send',async balance=>{
 const p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>args.method==='eth_getBalance'?balance:base(args));
 const send=vi.fn().mockResolvedValue({hash:id}),v=await fixture();
 await expect(sendDirectClaimV5(p,v,()=>true,send)).resolves.toBe(id);
 expect(send).toHaveBeenCalledWith({chainId:10143,from:v.transaction!.from,to:registry,data:v.transaction!.data,value:0n},
  {address:v.transaction!.from,sponsor:true,uiOptions:{showWalletUIs:true}});
 expect(p.request.mock.calls.every(([x])=>['eth_accounts','eth_chainId'].includes(x.method))).toBe(true);expect(p.listeners.size).toBe(0);
});
it('sponsorship absence or provider failure never falls back to charging the athlete',async()=>{
 const p=provider(),v=await fixture();
 await expect(sendDirectClaimV5(p,v,()=>true)).rejects.toThrow('claim_sponsorship_unavailable');
 const send=vi.fn().mockRejectedValue(Error('provider sponsorship unavailable'));
 await expect(sendDirectClaimV5(p,v,()=>true,send)).rejects.toThrow('provider sponsorship unavailable');
 expect(send).toHaveBeenCalledOnce();expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);
 expect(p.listeners.size).toBe(0);
});
