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
  const p=provider();await expect(sendDirectClaimV5(p,v,()=>true)).resolves.toBe(id);
  expect(p.request.mock.calls.map(([x])=>x.method)).toEqual(['eth_accounts','eth_chainId','eth_getBalance','eth_accounts','eth_chainId','eth_estimateGas','eth_gasPrice','eth_getBalance','eth_accounts','eth_chainId','eth_sendTransaction']);
  expect(p.listeners.size).toBe(0);
 });
 it('wallet/network/session changes and excessive fees stop submission',async()=>{
  const v=await fixture();
  for(const mode of ['account','network','session','event','fee']){
   const p=provider(),original=p.request.getMockImplementation()!;
   p.request.mockImplementation(async args=>{
    if(mode==='account'&&args.method==='eth_accounts')return [issuer.address];
    if(mode==='network'&&args.method==='eth_chainId')return '0x1';
    if(mode==='fee'&&args.method==='eth_gasPrice')return '0xffffffffffffffff';
    if(mode==='event'&&args.method==='eth_gasPrice')p.listeners.get('accountsChanged')?.();
    return original(args);
   });
   await expect(sendDirectClaimV5(p,v,()=>mode!=='session')).rejects.toThrow();
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

it.each(['0x0','0x1'])('insufficient athlete gas balance %s stops before sending',async balance=>{
 const p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>args.method==='eth_getBalance'?balance:base(args));
 await expect(sendDirectClaimV5(p,await fixture(),()=>true)).rejects.toThrow('claim_insufficient_balance');
 expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
});
