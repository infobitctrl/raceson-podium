import {beforeEach,expect,it,vi} from 'vitest';
import {encodeFunctionData} from 'viem';
import {sponsorLifecycleAbi} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
import {checkedPublicationAuthorization,readReviewPublication,type ReviewPublication} from './reviewPublication';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/api',()=>({apiRequest:mocks.request}));
const appId='c'.repeat(25),id='00000000-0000-4000-a000-000000000001',address='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
function fixture():ReviewPublication{return {schema:'podium-review-publication-v1',approvalId:id,slot:0,documentHash:'d'.repeat(64),operator:address,campaignAddress:address,state:2,claimsOpen:false,next:'activate',ownership:'owned',pending:{hash:null,confirmed:false,action:'activate'},authorization:{transactionId:id,request:{version:1,method:'POST',url:'https://api.privy.io/v1/wallets/wallet/rpc',headers:{'privy-app-id':appId,'privy-request-expiry':String(Date.now()+90000)},body:{method:'eth_signTransaction',chain_type:'ethereum',params:{transaction:{type:0,chain_id:10143,to:address,data:encodeFunctionData({abi:sponsorLifecycleAbi,functionName:'activate',args:[hash,hash]}),value:'0x0',nonce:0,gas_limit:'0x1d4c0',gas_price:'0x1'}}}}}};}
beforeEach(()=>vi.clearAllMocks());
it('accepts only the reviewed testnet transaction with bounded gas and expiry',()=>{
 const v=fixture();expect(checkedPublicationAuthorization(v,appId)).toEqual(v.authorization!.request);
});
it.each(['destination','method','expiry','gas','phase','alreadySigned','wrongApp','unknownField'])('rejects %s before the browser signs',kind=>{
 const v=fixture(),r=v.authorization!.request,t=r.body.params.transaction;
 if(kind==='destination')t.to='0x'+'33'.repeat(20);
 if(kind==='method')Object.assign(r.body,{method:'eth_sendTransaction'});
 if(kind==='expiry')r.headers['privy-request-expiry']=String(Date.now()-1);
 if(kind==='gas')t.gas_limit='0xffffffffffff';
 if(kind==='phase')v.pending!.action='upload';
 if(kind==='alreadySigned')v.pending!.hash=hash;
 if(kind==='wrongApp')r.headers['privy-app-id']='x'.repeat(25);
 if(kind==='unknownField')Object.assign(t,{owner:'forged'});
 expect(()=>checkedPublicationAuthorization(v,appId)).toThrow();
});
it('uses ordinary same-origin API authentication and includes the exact approval with the short-lived authorization',async()=>{
 const v=fixture();mocks.request.mockResolvedValue(v);
 const signature={transactionId:id,authorizationSignature:'S'.repeat(88),requestExpiry:Date.now()+90000};
 await readReviewPublication({id,slot:0,approvalId:id},v.documentHash,true,signature);
 expect(mocks.request).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/reviews/${id}/allocations/0/${id}/publish`,method:'POST',body:{expectedDocumentHash:v.documentHash,...signature},cache:'no-store'});
 mocks.request.mockResolvedValue({...v,documentHash:'e'.repeat(64)});await expect(readReviewPublication({id,slot:0,approvalId:id},v.documentHash)).rejects.toThrow('invalid_review_publication');
});
