import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchPublicCampaign} from '../dist/routes/rewards/public-campaign.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {decodePublicCampaignSource,decodePublicCampaignSnapshot} from '@raceson/domain/rewards/public-directory';
const id='73000000-0000-4000-8000-000000000001',address='0x'+'11'.repeat(20),funding='0x'+'bb'.repeat(32);
const campaign={id,name:'Synthetic campaign',chainId:31337,budgetWei:'100',address,fundingHash:funding,blockNumber:'100',blockTimestamp:'1800000000',pots:[{slot:0,name:'League',amountWei:'100',state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:'100',returnedWei:'0',claimDeadline:'0',groups:[{name:'Open',amountWei:'100'}]}]};
const plan={version:4,launchId:id,setupRevision:1,configurationHash:'a'.repeat(64),chainId:31337,funder:address,operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:address,claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100','0','0','0','0','0'],budgetWei:'100'};
const selection={sourceLeagueId:'league',sourceSeasonId:'season',eventEditionId:null,raceId:null};
const saved={sponsors:1,items:[{campaign,selection:null,publishedAt:'2026-10-11T00:00:00Z',record:{plan,deploymentHash:'0x'+'aa'.repeat(32),fundingHash:funding}}]};
async function request({method='GET',query='',data=saved,error=null,endpoint='source'}={}){
 let response,calls=0;const headers={};
 await dispatchPublicCampaign({method},{setHeader:(key,value)=>headers[key]=value},new URL(`http://local/api/v1/rewards/public-campaigns/${id}/${endpoint}${query}`),{
  config:()=>({chainId:31337}),publicRpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_public_directory');assert.deepEqual(args,{p_chain_id:31337});return {data,error};},
  rpc:()=>assert.fail('private RPC used'),sponsorReader:{getChainId:()=>assert.fail('metadata triggered chain observation')},
  requireIdentity:()=>assert.fail('public metadata requires no identity'),sendSuccess:(_,data)=>response={status:200,data},sendError:(_,status)=>response={status},
 });
 return {response,calls,headers};
}
test('public source metadata needs no wallet, login or directory-wide chain refresh',async()=>{
 const result=await request();assert.equal(result.response.status,200);
 assert.deepEqual(result.response.data,{id,chainId:31337,selection:null});
 assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.calls,1);
 const data=structuredClone(saved);data.items[0].selection={sourceLeagueId:id,sourceSeasonId:id,eventEditionId:null};
 assert.deepEqual((await request({data})).response.data.selection,data.items[0].selection);
});
test('source endpoint rejects writes, query overrides and unpublished or invalid records',async()=>{
 for(const method of ['POST','PUT','DELETE']){const r=await request({method});assert.equal(r.response.status,405);assert.equal(r.calls,0);}
 for(const query of ['?owner=private','?blockNumber=100']){const r=await request({query});assert.equal(r.response.status,400);assert.equal(r.calls,0);}
 assert.equal((await request({data:{sponsors:0,items:[]}})).response.status,404);
 assert.equal((await request({data:null})).response.status,503);
 assert.equal((await request({error:{message:'private provider message'}})).response.status,503);
});
test('source decoder permits only existing public sporting selection fields',()=>{
 assert.deepEqual(decodePublicCampaignSource({id,chainId:31337,selection:null}),{id,chainId:31337,selection:null});
 for(const patch of [{owner:id},{record:plan},{chainId:1},{selection},{selection:{wallet:address}}])assert.throws(()=>decodePublicCampaignSource({id,chainId:31337,selection:null,...patch}));
});
test('hosted source route permits only exact public GET requests',()=>{
 const path=`https://isolated.invalid/api/v1/rewards/public-campaigns/${id}/source`;
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'sponsor-drafts-v1',true),true);
 for(const method of ['POST','PUT','DELETE'])assert.equal(hostedCopyRequestAllowed(method,new URL(path),'sponsor-drafts-v1',true),false);
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path+'?owner=private'),'sponsor-drafts-v1',true),false);
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'preview-v1'),false);
});

test('published snapshot exposes only the historical public projection without observing chain state',async()=>{
 const result=await request({endpoint:'snapshot'});
 assert.equal(result.response.status,200);assert.equal(result.calls,1);
 assert.deepEqual(result.response.data,{campaign,selection:null,publishedAt:saved.items[0].publishedAt});
 assert.equal(result.headers['Cache-Control'],'no-store');
 assert.equal((await request({endpoint:'snapshot',data:{sponsors:0,items:[]}})).response.status,404);
 const path=`https://isolated.invalid/api/v1/rewards/public-campaigns/${id}/snapshot`;
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'sponsor-drafts-v1',true),true);
 for(const method of ['POST','PUT','DELETE']){
  assert.equal((await request({endpoint:'snapshot',method})).response.status,405);
  assert.equal(hostedCopyRequestAllowed(method,new URL(path),'sponsor-drafts-v1',true),false);
 }
 assert.equal((await request({endpoint:'snapshot',query:'?owner=private'})).response.status,400);
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path+'?owner=private'),'sponsor-drafts-v1',true),false);
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'preview-v1'),false);
});
test('snapshot decoder rejects private fields and malformed historical projections',()=>{
 const snapshot={campaign,selection:null,publishedAt:saved.items[0].publishedAt};
 assert.deepEqual(decodePublicCampaignSnapshot(snapshot),snapshot);
 for(const patch of [{record:plan},{wallet:address},{verified:true},{publishedAt:'invalid'},{campaign:{...campaign,owner:id}},{selection:{wallet:address}}])assert.throws(()=>decodePublicCampaignSnapshot({...snapshot,...patch}));
});
