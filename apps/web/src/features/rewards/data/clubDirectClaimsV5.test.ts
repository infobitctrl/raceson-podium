import {clubOwnersHashV1,walletBindingMessageV2,encodeWalletRegistrationV2,clubClaimMessageV6} from '@raceson/rewards-chain/club-signatures-v6';
import {validateClubClaimV6} from './clubDirectClaimsV5';
import type {Address} from 'viem';
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
  return {eth_accounts:[account.address],eth_chainId:'0x279f',eth_call:'0x0',eth_estimateGas:'0x30d40',eth_gasPrice:'0x1',eth_getBalance:'0x100000000',eth_sendTransaction:id}[method];
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

it.each(['0x0','0x1'])('insufficient submitting owner gas balance %s stops before sending',async balance=>{
 const v=await fixture(),call=await directClubCallV5(v),signatures=await Promise.all(owners.slice(0,2).map(o=>o.signTypedData(directSafeMessageV5(call))));
 const p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>args.method==='eth_getBalance'?balance:base(args));
 await expect(sendDirectClubClaimV5(p,v,signatures,owners[0].address.toLowerCase(),()=>true)).rejects.toThrow('claim_insufficient_balance');
 expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
});
it('supports the Privy bigint gas estimate without changing the approved claim',async()=>{
 const v=await fixture(),call=await directClubCallV5(v),signatures=await Promise.all(owners.slice(0,2).map(o=>o.signTypedData(directSafeMessageV5(call))));
 const p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>args.method==='eth_estimateGas'?200000n:base(args));
 await expect(sendDirectClubClaimV5(p,v,signatures,owners[0].address.toLowerCase(),()=>true)).resolves.toBe(id);
});
async function v6Registration():Promise<ClubDirectClaimV5>{
 const v=await fixture(),old=v.transaction!.binding!,context={chainId:10143 as const,registry};
 const b={...old,beneficiaryId:id,recipient:safe,beneficiaryKind:1 as const,nonce:0n,issuedAt:BigInt(old.issuedAt),expiresAt:BigInt(old.expiresAt),clubOwnersHash:clubOwnersHashV1(v.owners as Address[])};
 const proof=await issuer.signTypedData(walletBindingMessageV2(context,b));
 return {...v,protocolVersion:6,phase:'register',clubClaim:null,registrationReceipt:null,chainState:{registrationNonce:'0',authorizationNonce:'0',clubOwnersHash:toHex(0n,{size:32}),allocationDigest:id},transaction:{...v.transaction!,data:encodeWalletRegistrationV2(context,b,proof),identityProof:proof,binding:{...old,clubOwnersHash:b.clubOwnersHash}}};
}
it('V6 registration verifies domain 2 and original three owners; V5 and altered owner bindings fail closed',async()=>{
 const v=await v6Registration();expect((await directClubCallV5(v)).to).toBe(registry);
 for(const bad of [{...v,protocolVersion:undefined},{...v,owners:[issuer.address.toLowerCase(),...v.owners.slice(1)]},{...v,transaction:{...(await fixture()).transaction!}}])await expect(directClubCallV5(bad as ClubDirectClaimV5)).rejects.toThrow();
});
it('V6 claim signs the reward domain, requires two fresh distinct owners and broadcasts only claimClub',async()=>{
 const registration=await v6Registration(),b=registration.transaction!.binding!,ownersHash=b.clubOwnersHash!;
 const v:ClubDirectClaimV5={...registration,phase:'claim',recipient:safe,chainState:{registrationNonce:'1',authorizationNonce:'0',clubOwnersHash:ownersHash,allocationDigest:id},
  transaction:{chainId:10143,from:safe,to:campaign,data:'0x',value:'0',binding:null,identityProof:null},
  clubClaim:{entitlementId:id,recipient:safe,amount:'100',pot:0,nonce:'0',issuedAt:b.issuedAt,expiresAt:b.expiresAt,allocationDigest:id,clubOwnersHash:ownersHash,registrationNonce:'1'}};
 const p=provider(),address=owners[0].address.toLowerCase();
 const first=await signDirectClubClaimV5(p,v,address,()=>true),claim=validateClubClaimV6(v);
 const second=await owners[1].signTypedData(clubClaimMessageV6({chainId:10143,campaign},claim));
 const safeCall=await directClubCallV5(registration),oldProof=await owners[1].signTypedData(directSafeMessageV5(safeCall));
 for(const signatures of [[first],[first,first],[first,oldProof]])await expect(sendDirectClubClaimV5(p,v,signatures,address,()=>true)).rejects.toThrow();
 for(const patch of [{registrationNonce:'2'},{amount:'101'},{clubOwnersHash:toHex(0n,{size:32})},{expiresAt:'1'}])await expect(signDirectClubClaimV5(p,{...v,clubClaim:{...v.clubClaim!,...patch}},address,()=>true)).rejects.toThrow();
 expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);
 await expect(sendDirectClubClaimV5(p,v,[first,second],address,()=>true)).resolves.toBe(id);
 const tx=p.request.mock.calls.find(([x])=>x.method==='eth_sendTransaction')![0].params![0] as {to:string;data:string};expect(tx.to).toBe(campaign);expect(tx.data).not.toBe('0x');
 expect(p.request.mock.calls.some(([x])=>x.method==='eth_call')).toBe(false);
});

async function sponsoredFixture(phase:'v5'|'register'|'claim'){
 const registration=phase==='v5'?await fixture():await v6Registration();
 if(phase!=='claim')return registration;
 const b=registration.transaction!.binding!,ownersHash=b.clubOwnersHash!;
 return {...registration,phase:'claim' as const,recipient:safe,chainState:{registrationNonce:'1',authorizationNonce:'0',clubOwnersHash:ownersHash,allocationDigest:id},
  transaction:{chainId:10143 as const,from:safe,to:campaign,data:'0x',value:'0' as const,binding:null,identityProof:null},
  clubClaim:{entitlementId:id,recipient:safe,amount:'100',pot:0 as const,nonce:'0',issuedAt:b.issuedAt,expiresAt:b.expiresAt,allocationDigest:id,clubOwnersHash:ownersHash,registrationNonce:'1'}};
}
async function consent(v:ClubDirectClaimV5){
 return Promise.all(owners.slice(0,2).map(o=>signDirectClubClaimV5(provider(o),v,o.address.toLowerCase(),()=>true)));
}
it.each(['v5','register','claim'] as const)('sponsors %s with zero owner balance, exact destination and explicit wallet UI',async phase=>{
 const v=await sponsoredFixture(phase),signatures=await consent(v),p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>args.method==='eth_getBalance'?'0x0':base(args));
 const send=vi.fn().mockResolvedValue({hash:id}),address=owners[0].address.toLowerCase();
 await expect(sendDirectClubClaimV5(p,v,signatures,address,()=>true,send)).resolves.toBe(id);
 expect(send).toHaveBeenCalledExactlyOnceWith({from:address,to:phase==='claim'?campaign:safe,data:expect.stringMatching(/^0x[0-9a-f]+$/),value:0n,chainId:10143,gasLimit:240000n},
  {address,sponsor:true,uiOptions:{showWalletUIs:true}});
 expect(p.request.mock.calls.some(([x])=>['eth_getBalance','eth_sendTransaction'].includes(x.method))).toBe(false);
 expect(p.listeners.size).toBe(0);
});
it.each(['wallet','chain','nonce','session','event','duplicate','expired'] as const)('sponsored registration preserves %s safety gate',async mode=>{
 const v=await v6Registration(),signatures=await consent(v),p=provider(),base=p.request.getMockImplementation()!;
 p.request.mockImplementation(async args=>{
  if(mode==='wallet'&&args.method==='eth_accounts')return[issuer.address];
  if(mode==='chain'&&args.method==='eth_chainId')return'0x1';
  if(mode==='nonce'&&args.method==='eth_call')return'0x1';
  if(mode==='event'&&args.method==='eth_call')p.listeners.get('accountsChanged')?.();
  if(mode==='expired'&&args.method==='eth_call')v.transaction!.binding!.expiresAt='1';
  return base(args);
 });
 const send=vi.fn();
 await expect(sendDirectClubClaimV5(p,v,mode==='duplicate'?[signatures[0],signatures[0]]:signatures,owners[0].address.toLowerCase(),()=>mode!=='session',send)).rejects.toThrow();
 expect(send).not.toHaveBeenCalled();expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
});
it.each(['reject','unknown'] as const)('sponsorship %s never falls back to charging the owner or retrying',async mode=>{
 const v=await sponsoredFixture('claim'),signatures=await consent(v),p=provider();
 const send=mode==='reject'?vi.fn().mockRejectedValue(Error('sponsorship_denied')):vi.fn().mockResolvedValue({hash:'unknown'});
 await expect(sendDirectClubClaimV5(p,v,signatures,owners[0].address.toLowerCase(),()=>true,send)).rejects.toThrow(mode==='reject'?'sponsorship_denied':'transaction_unknown');
 expect(send).toHaveBeenCalledOnce();expect(p.request.mock.calls.some(([x])=>x.method==='eth_sendTransaction')).toBe(false);expect(p.listeners.size).toBe(0);
});
