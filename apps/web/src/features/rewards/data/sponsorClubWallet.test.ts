import {it,expect,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {toHex,type Hex} from 'viem';
import {sponsorClaimMessagesV4,sponsorSafeConsentMessageV4,encodeSponsorClaimV4} from '@raceson/rewards-chain/sponsor-claims-v4';
import {safeRewardConsentMessageV3} from '@raceson/rewards-chain/campaign-v3';
import {signSponsorClubConsent,combineSponsorClubSignatures,verifySponsorClubSignatures} from './sponsorClubWallet';
import {sendProgrammeTransaction} from './sponsorProgrammeWallet';
import type {SponsorClubClaim} from './sponsorClubClaims';
const signers=[90101n,90102n,90103n].map(n=>privateKeyToAccount(toHex(n,{size:32}))),operator=privateKeyToAccount(toHex(90104n,{size:32}));
const address=toHex(991n,{size:20}),context={environment:'local-simulation' as const,chainId:31337 as const,verifyingContract:toHex(992n,{size:20})};
const claim={entitlementId:toHex(993n,{size:32}),recipient:address,amount:10n,pot:'race' as const,nonce:0n,issuedAt:1801000000n,expiresAt:1801000600n,allocationDigest:toHex(994n,{size:32})};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
function view(){return json({schema:'raceson-sponsor-club-claim-view-v4',claimId:'73000000-0000-4000-8000-000000000001',approvalId:'73000000-0000-4000-8000-000000000002',role:'recipient',chainId:31337,current:true,status:'awaiting_consent',address,owners:signers.map(s=>s.address.toLowerCase()).sort(),operatorAddress:operator.address.toLowerCase(),context,claim,signing:sponsorSafeConsentMessageV4(context,claim),transaction:null,receipt:null}) as SponsorClubClaim;}
function provider(signer=signers[0]){const listeners=new Map<string,()=>void>();return{on:vi.fn((e:string,cb:()=>void)=>listeners.set(e,cb)),removeListener:vi.fn((e:string)=>listeners.delete(e)),listeners,request:vi.fn(async({method,params}:{method:string;params?:unknown[]}):Promise<unknown>=>{
 if(method==='eth_accounts')return[signer.address];if(method==='eth_chainId')return'0x7a69';if(method==='eth_estimateGas')return'0x186a0';if(method==='eth_gasPrice')return'0x1';if(method==='eth_sendTransaction')return toHex(995n,{size:32});
 if(method==='eth_signTypedData_v4')return signer.signTypedData(JSON.parse(params![1] as string));throw Error(method);
})};}
it('collects explicit owner consent and combines only two distinct reviewed owners in Safe order',async()=>{
 const v=view(),proofs=await Promise.all(signers.slice(0,2).map(async s=>({signer:s.address.toLowerCase(),signature:await signSponsorClubConsent(provider(s),v,s.address.toLowerCase(),()=>true)})));
 const combined=await combineSponsorClubSignatures(v,proofs.reverse());await expect(verifySponsorClubSignatures(v,combined)).resolves.toBeUndefined();
 await expect(combineSponsorClubSignatures(v,[proofs[0]])).rejects.toThrow('club_quorum_required');
 await expect(combineSponsorClubSignatures(v,[proofs[0],proofs[0]])).rejects.toThrow('club_quorum_required');
 await expect(signSponsorClubConsent(provider(operator),v,operator.address.toLowerCase(),()=>true)).rejects.toThrow('invalid_claim');
 const old=await signers[0].signTypedData(safeRewardConsentMessageV3(context,claim));
 await expect(combineSponsorClubSignatures(v,[{signer:signers[0].address.toLowerCase(),signature:old},proofs.find(p=>p.signer!==signers[0].address.toLowerCase())!])).rejects.toThrow();
});
it('rebuilds version-5 SafeMessage locally and discards a signature after wallet or claim change',async()=>{
 for(const mutate of [(v:any)=>v.signing.message.message=toHex(1n,{size:32}),(v:any)=>v.claim.amount='11',(v:any)=>v.context.chainId=1]){
  const v=view();mutate(v);const p=provider();await expect(signSponsorClubConsent(p,v,signers[0].address.toLowerCase(),()=>true)).rejects.toThrow();expect(p.request).not.toHaveBeenCalled();
 }
 const p=provider(),request=p.request.getMockImplementation()!;p.request.mockImplementation(async args=>{const result=await request(args);if(args.method==='eth_signTypedData_v4')p.listeners.get('accountsChanged')?.();return result;});
 await expect(signSponsorClubConsent(p,view(),signers[0].address.toLowerCase(),()=>true)).rejects.toThrow('wallet_changed');expect(p.listeners.size).toBe(0);
});
it('club payment validates both owner proofs, exact recipient, controller and calldata before wallet broadcast',async()=>{
 const v=view(),proofs=await Promise.all(signers.slice(0,2).map(async s=>({signer:s.address.toLowerCase(),signature:await s.signTypedData(sponsorSafeConsentMessageV4(context,claim))})));
 const recipient=await combineSponsorClubSignatures(v,proofs),approval=await operator.signTypedData(sponsorClaimMessagesV4(context,claim).authorization);
 v.role='operator';v.transaction={chainId:31337,from:operator.address.toLowerCase(),to:context.verifyingContract,value:'0',data:encodeSponsorClaimV4(context,claim,{operator:approval,recipient})};
 await expect(sendProgrammeTransaction(provider(operator),v,()=>true)).resolves.toBe(toHex(995n,{size:32}));
 for(const mutate of [(v:SponsorClubClaim)=>v.transaction!.data=encodeSponsorClaimV4(context,claim,{operator:approval,recipient:proofs[0].signature}),(v:SponsorClubClaim)=>v.address=operator.address.toLowerCase(),(v:SponsorClubClaim)=>v.operatorAddress=signers[0].address.toLowerCase()]){
  const bad=structuredClone(v);mutate(bad);const p=provider(operator);await expect(sendProgrammeTransaction(p,bad,()=>true)).rejects.toThrow();expect(p.request.mock.calls.some(c=>c[0].method==='eth_sendTransaction')).toBe(false);
 }
});
