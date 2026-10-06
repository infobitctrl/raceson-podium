import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCopyPublicRpc} from '../../../packages/db/dist/rewards/hosted-copy-public.js';
import {dispatchPublicCampaign} from '../dist/routes/rewards/public-campaign.js';
import {dispatchPublicDirectory} from '../dist/routes/rewards/public-directory.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const id='7d000000-0000-4000-8000-000000000001',other='7d000000-0000-4000-8000-000000000002',actor={userId:id,sessionId:other};
const campaignArgs={p_chain_id:10143,p_setup_id:id,p_actor_user_id:null,p_actor_session_id:null,p_campaign:null};
test('copy public closure exposes three fixed projections and captures exact publishing identity',async()=>{
 const calls=[],rpc=async(n,a)=>{calls.push([n,a]);return {data:null,error:null};},publicRead=hostedCopyPublicRpc(rpc);
 await publicRead('service_reward_public_campaign',campaignArgs);
 await publicRead('service_reward_public_directory',{p_chain_id:10143});
 await publicRead('service_reward_public_awards_v4',{p_chain_id:10143,p_setup_id:id,p_slot:5});
 assert.deepEqual(calls.map(c=>c[0]),['service_reward_demo_copy_public_campaign','service_reward_demo_copy_public_directory','service_reward_demo_copy_public_awards']);
 assert.deepEqual(calls[1][1],{});assert.equal('p_chain_id' in calls[2][1],false);
 const identity={...actor},publish=hostedCopyPublicRpc(rpc,identity,id);identity.userId=other;
 const write={...campaignArgs,p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_campaign:{id}};
 await publish('service_reward_public_campaign',write);assert.equal(calls.at(-1)[1].p_actor_user_id,id);
 for(const [name,args] of [['service_reward_public_campaign',write],['service_reward_public_campaign',{...campaignArgs,p_actor_user_id:id}],['service_reward_public_awards_v4',{p_chain_id:1,p_setup_id:id,p_slot:0}],['service_reward_public_awards_v4',{p_chain_id:10143,p_setup_id:id,p_slot:6}],['service_reward_public_directory',{p_chain_id:10143,owner:id}],['service_reward_sponsor_execution',campaignArgs]])assert.throws(()=>publicRead(name,args));
 assert.throws(()=>publish('service_reward_public_campaign',{...write,p_setup_id:other}));
 assert.throws(()=>publish('service_reward_public_campaign',{...write,p_actor_session_id:id}));
 assert.equal(calls.length,4);
});
async function request(method='GET',body={},authError,sponsorError){
 let response;const calls=[];
 const generic=async()=>{throw Error('Generic reader used');};
 const deps={config:()=>({chainId:10143}),rpc:generic,publicRpc:hostedCopyPublicRpc(async(n,a)=>{calls.push([n,a]);return{data:null,error:null};}),
  resolveSponsorRpc:async identity=>{assert.deepEqual(identity,actor);if(sponsorError)throw Error(sponsorError);return async(n,a)=>{calls.push([n,a]);return{data:null,error:null};};},
  requireIdentity:async()=>{if(authError)throw Error(authError);return actor;},readJsonBody:async()=>body,sponsorReader:{},applyPrivateSessionHeaders(){},
  sendSuccess:(_,data)=>response={status:200,data},sendError:(_,status,code)=>response={status,code}};
 await dispatchPublicCampaign({method},{setHeader(){}},new URL('https://podium.raceson.com/api/v1/rewards/public-campaigns/'+id),deps);
 return{response,calls,deps};
}
test('public route uses anonymous copy reader; completion authenticates and rejects browser/absence before observation',async()=>{
 const guest=await request();assert.equal(guest.response.status,404);assert.equal(guest.calls[0][0],'service_reward_demo_copy_public_campaign');
 const unauth=await request('POST',{},'Unauthorized');assert.equal(unauth.response.status,401);assert.equal(unauth.calls.length,0);
 const injected=await request('POST',{funded:true});assert.equal(injected.response.status,400);assert.equal(injected.calls.length,0);
 for(const code of ['reward_demo_sponsor_required','reward_demo_account_required']){const denied=await request('POST',{},undefined,code);assert.equal(denied.response.status,403);assert.equal(denied.response.code,'reward_demo_sponsor_required');assert.equal(denied.calls.length,0);}
 const unfunded=await request('POST');assert.equal(unfunded.response.status,409);assert.equal(unfunded.calls.length,1);assert.equal(unfunded.calls[0][0],'service_reward_sponsor_execution');
});
test('public directory resolves the copied reader without private identity or generic RPC',async()=>{
 let response;await dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('https://podium.raceson.com/api/v1/rewards/public-campaigns'),{
 config:()=>({chainId:10143}),rpc:async()=>assert.fail('Generic directory'),publicRpc:hostedCopyPublicRpc(async(n,a)=>{assert.equal(n,'service_reward_demo_copy_public_directory');assert.deepEqual(a,{});return{data:{items:[],sponsors:0},error:null};}),
 sponsorReader:{},sendSuccess:(_,data)=>response=data,sendError:()=>assert.fail('Directory failed')});
 assert.equal(response.items.length,0);assert.equal(response.sponsors,0);assert.equal(response.refreshStatus,'current');
});
test('copy gate opens exact public completion and bounded award query only in hosted operations',()=>{
 const path='/api/v1/rewards/public-campaigns/'+id,allow=(m,p,op=true)=>hostedCopyRequestAllowed(m,new URL(p,'https://podium.raceson.com'),'sponsor-drafts-v1',op);
 assert(allow('GET',path));assert(allow('POST',path));assert(allow('GET',path+'/pots/0/awards?offset=25&sort=amount&direction=desc'));
 for(const [m,p] of [['DELETE',path],['GET',path+'?actor=other'],['POST',path+'/pots/0/awards'],['GET',path+'/pots/6/awards'],['GET',path+'/pots/0/awards?offset=0&offset=25'],['GET',path+'/pots/0/awards?address=other']])assert.equal(allow(m,p),false);
 assert.equal(allow('POST',path,false),false);assert.equal(allow('GET',path,false),false);
});


test('hosted branding captures owner identity and exposes only the scoped RPC',async()=>{
 const {hostedCopyBrandingRpc}=await import('../../../packages/db/dist/rewards/hosted-copy-public.js');
 const {dispatchCampaignBranding}=await import('../dist/routes/rewards/campaign-branding.js');
 const calls=[],rpc=async(n,a)=>{calls.push([n,a]);return{data:[],error:null};};
 const guest=hostedCopyBrandingRpc(rpc),args={p_chain_id:10143,p_actor_user_id:null,p_actor_session_id:null,p_setup_id:null,p_change:null};
 await guest('service_reward_campaign_branding',args);assert.equal(calls[0][0],'service_reward_demo_copy_campaign_branding');
 const identity={...actor},owner=hostedCopyBrandingRpc(rpc,identity);identity.userId=other;
 const owned={...args,p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_setup_id:id};await owner('service_reward_campaign_branding',owned);
 for(const bad of [{...args,p_chain_id:31337},{...args,p_actor_user_id:id},{...args,p_change:{}},{...args,other:true}])assert.throws(()=>guest('service_reward_campaign_branding',bad));
 assert.throws(()=>owner('service_reward_campaign_branding',{...owned,p_actor_session_id:id}));
 assert.throws(()=>guest('service_reward_public_directory',args));
 let response;
 await dispatchCampaignBranding({method:'GET'},{},new URL('https://podium.raceson.com/api/v1/rewards/campaign-branding/mine'),{
 config:()=>({chainId:10143}),requireIdentity:async()=>actor,applyPrivateSessionHeaders(){},rpc:()=>assert.fail('generic RPC'),
 resolveRpc:identity=>hostedCopyBrandingRpc(rpc,identity),sendSuccess:(_,data)=>response=data,sendError:()=>assert.fail('unexpected failure')});
 assert.deepEqual(response,[]);assert.equal(calls.at(-1)[1].p_actor_user_id,actor.userId);
});
test('hosted branding gate permits exact reads and owner update only in enabled operations',()=>{
 const base='/api/v1/rewards/campaign-branding',allow=(method,path,enabled=true)=>hostedCopyRequestAllowed(method,new URL(path,'https://podium.raceson.com'),'sponsor-drafts-v1',enabled);
 for(const path of [base,base+'/mine',base+'/'+id])assert(allow('GET',path));assert(allow('PATCH',base+'/'+id));
 for(const [m,p] of [['PATCH',base],['PATCH',base+'/mine'],['POST',base+'/'+id],['DELETE',base+'/'+id],['GET',base+'?owner='+id]])assert.equal(allow(m,p),false);
 assert.equal(allow('GET',base,false),false);assert.equal(allow('PATCH',base+'/'+id,false),false);
});
