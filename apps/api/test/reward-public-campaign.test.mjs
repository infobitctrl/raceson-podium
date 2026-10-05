import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {dispatchPublicCampaign,publicCampaignObservation} from '../dist/routes/rewards/public-campaign.js';
const id='73000000-0000-4000-8000-000000000001',funding='0x'+'bb'.repeat(32);
const campaign={id,name:'Test campaign',chainId:10143,budgetWei:'100',address:'0x'+'11'.repeat(20),fundingHash:funding,blockNumber:'100',blockTimestamp:'1800000000',
 pots:[{slot:0,name:'League',amountWei:'100',state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:'100',returnedWei:'0',claimDeadline:'0',groups:[{name:'Standings',amountWei:'100'}]}]};
test('public contract rejects private fields, invalid totals, duplicate pots and false accounting',()=>{
 assert.deepEqual(decodePublicSponsorCampaign(campaign),campaign);
 for(const change of [c=>c.ownerUserId=id,c=>c.pots[0].recipients=[],c=>c.budgetWei='101',c=>c.pots.push(c.pots[0]),c=>c.pots[0].paidWei='1',c=>c.pots[0].groups[0].amountWei='99',c=>c.fundingHash=null,c=>c.chainId=1]){
  const bad=structuredClone(campaign);change(bad);assert.throws(()=>decodePublicSponsorCampaign(bad));
 }
});
test('live public projection preserves economics and reflects confirmed payouts without exposing private chain inputs',()=>{
 const observation={address:campaign.address,funded:true,cancelled:false,fundingHash:funding,blockNumber:'101',blockTimestamp:'1800000010',
  pots:[{...campaign.pots[0],state:3,allocatedWei:'80',paidWei:'30',remainingWei:'70',claimDeadline:'1800010000',address:'0x'+'55'.repeat(20),entitlementCount:'4'}]};
 const result=publicCampaignObservation(campaign,observation);
 assert.equal(result.pots[0].paidWei,'30');assert.equal(result.pots[0].amountWei,'100');assert.equal(result.blockNumber,'101');assert.equal('entitlementCount' in result.pots[0],false);
 for(const patch of [{funded:false},{cancelled:true},{fundingHash:null},{address:'0x'+'22'.repeat(20)},{pots:[]}])assert.throws(()=>publicCampaignObservation(campaign,{...observation,...patch}));
});
async function request({method='GET',body={},authError,record=null,query='',rpcError}={}){
 let response,calls=0,chainCalls=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>{if(authError)throw Error(authError);return{userId:id,sessionId:id};},readJsonBody:async()=>body,
  rpc:async()=>{calls++;return{data:record,error:rpcError?{message:rpcError}:null};},sponsorReader:{getChainId:async()=>{chainCalls++;throw Error('offline');}},applyPrivateSessionHeaders:()=>{},
  sendSuccess:(_res,data)=>response={status:200,data},sendError:(_res,status,code)=>response={status,code}};
 await dispatchPublicCampaign({method},{setHeader(){}},new URL(`http://local/api/v1/rewards/public-campaigns/${id}${query}`),deps);
 return{response,calls,chainCalls};
}
test('guest cannot publish, unpublished campaigns return 404 and GET does not require identity',async()=>{
 assert.equal((await request({authError:'Unauthorized'})).response.status,404);
 const denied=await request({method:'POST',authError:'Unauthorized'});assert.equal(denied.response.status,401);assert.equal(denied.calls,0);
 assert.equal((await request({method:'DELETE'})).response.status,405);
});
test('completion rejects browser facts, unfunded records and foreign ownership before chain or publication',async()=>{
 for(const body of [{funded:true},{ownerUserId:id},{campaign},[]]){const result=await request({method:'POST',body});assert.equal(result.response.status,400);assert.equal(result.calls,0);}
 const pending=await request({method:'POST'});assert.equal(pending.response.status,409);assert.equal(pending.calls,1);assert.equal(pending.chainCalls,0);
 const foreign=await request({method:'POST',rpcError:'reward_setup_not_found'});assert.equal(foreign.response.status,404);assert.equal(foreign.chainCalls,0);
 assert.equal((await request({query:'?owner=other'})).response.status,400);
});
