import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBrandingChange,decodeCampaignBranding,validBrandingLogo,sponsorWebsiteHref} from '@raceson/domain/rewards/campaign-branding';
import {dispatchCampaignBranding} from '../dist/routes/rewards/campaign-branding.js';
const id='72000000-0000-4000-8000-000000000003',user='72000000-0000-4000-8000-000000000001',session='72000000-0000-4000-8000-000000000002';
test('branding accepts trimmed names and removal; rejects scripts, remote logos and extra economic/owner fields',()=>{
 assert.equal(decodeBrandingChange({name:'  Trail sponsor  ',logo:null,expectedRevision:0}).name,'Trail sponsor');
 for(const patch of [{name:''},{name:'x'.repeat(81)},{name:'bad\nname'},{logo:'https://tracker.invalid/a.png'},{logo:'data:image/svg+xml,<svg/>'},{expectedRevision:-1},{ownerUserId:user},{budgetWei:'1'}])assert.throws(()=>decodeBrandingChange({name:'Sponsor',logo:null,expectedRevision:0,...patch}));
 assert.throws(()=>decodeCampaignBranding([{id,name:'Sneaky',logo:null,revision:0}]));
});
test('route binds owner identity, supports anonymous projection, checks auth before writes and rejects bad methods',async()=>{
 let output,calls=0,body={name:'Sponsor',logo:null,expectedRevision:0},error;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:user,sessionId:session}),readJsonBody:async()=>body,
 applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>output={status:200,data},sendError:(_r,status,code)=>output={status,code},
 rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_campaign_branding');assert.equal(args.p_chain_id,10143);if(args.p_change){assert.equal(args.p_actor_user_id,user);assert.equal(args.p_actor_session_id,session);}return error?{error:{message:error}}:{data:[{id,name:'Sponsor',logo:null,revision:1}]};}};
 const res={setHeader(){}},url=new URL(`http://localhost/api/v1/rewards/campaign-branding/${id}`);
 await dispatchCampaignBranding({method:'PATCH'},res,url,deps);assert.equal(output.status,200);
 const prior=calls;body={...body,ownerUserId:user};await dispatchCampaignBranding({method:'PATCH'},res,url,deps);assert.equal(output.status,400);assert.equal(calls,prior);
 await dispatchCampaignBranding({method:'PATCH'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(output.status,401);assert.equal(calls,prior);
 await dispatchCampaignBranding({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('must not authenticate public reads');}});assert.equal(output.status,200);
 body={name:'Sponsor',logo:null,expectedRevision:0};for(const [failure,status] of [['reward_setup_not_found',404],['campaign_branding_conflict',409],['reward_account_session_required',401]]){error=failure;await dispatchCampaignBranding({method:'PATCH'},res,url,deps);assert.equal(output.status,status);}
 await dispatchCampaignBranding({method:'DELETE'},res,url,deps);assert.equal(output.status,405);
});

test('logo decoding bounds the stored PNG dimensions and rejects truncated data',()=>{
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
 assert.equal(validBrandingLogo(png),true);
 assert.equal(validBrandingLogo('data:image/png;base64,iVBORw0KGgo='),false);
 const image=Buffer.from(png.slice(22),'base64');image.writeUInt32BE(4000,16);
 assert.equal(validBrandingLogo('data:image/png;base64,'+image.toString('base64')),false);
});
test('promotion preserves website text without format checks and rejects oversized fields',()=>{
 const base={name:'Sponsor',logo:null,expectedRevision:0};
 assert.deepEqual(decodeBrandingChange({...base,website:'https://example.com/offer?q=trail',promotion:'Trail offer\nMeet us at the finish.'}),{...base,website:'https://example.com/offer?q=trail',promotion:'Trail offer\nMeet us at the finish.'});
 for(const website of ['example.com','www.example.com/trail','http://example.com','javascript:alert(1)','https://name:password@example.com','https://example.com/ bad','https://','my adress'])assert.equal(decodeBrandingChange({...base,website}).website,website);
 for(const website of ['a'.repeat(301),'bad\u0001text',123])assert.throws(()=>decodeBrandingChange({...base,website}));
 assert.equal(sponsorWebsiteHref('example.com/trail'),'https://example.com/trail');
 assert.equal(sponsorWebsiteHref('http://example.com'),'http://example.com');
 for(const website of ['javascript:alert(1)','data:text/html,hello','https://name:password@example.com','my adress','https://'])assert.equal(sponsorWebsiteHref(website),null);

 for(const promotion of ['a'.repeat(1201),'bad\u0001text',123])assert.throws(()=>decodeBrandingChange({...base,promotion}));
 assert.equal(decodeCampaignBranding([{id,name:'Sponsor',logo:null,revision:1,website:null,promotion:'<b>Plain text</b>'}])[0].promotion,'<b>Plain text</b>');
 assert.equal(decodeCampaignBranding([{id,name:'Sponsor',logo:null,revision:1}]).length,1);
 assert.throws(()=>decodeCampaignBranding([{id,name:null,logo:null,revision:0,promotion:'unsaved'}]));
});
