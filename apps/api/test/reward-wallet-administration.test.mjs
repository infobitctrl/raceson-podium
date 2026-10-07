import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {changeWalletAdministration,walletSettingsFingerprint,resolveControllerPolicy} from '../dist/features/rewards/wallet-administration.js';
import {dispatchWalletAdministration} from '../dist/routes/rewards/wallet-administration.js';
import {resolveDeploymentSigner} from '../dist/features/rewards/wallet-runtime.js';
import {readConfiguredSupportGas} from '../dist/features/rewards/operations.js';
const a=n=>'0x'+String(n).repeat(40),uuid=n=>`74000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:uuid(1),sessionId:uuid(2)};
const deployment={version:1,appId:'cmtx921we00fu0cifaab7exez',walletId:'gas-old',address:a(1),ownerId:'owner',signerId:'signer',policyId:'policy',factory:a(4)};
const controller={subject:'did:privy:controller',wallet:a(1),walletId:'gas-old',ownerId:'owner'};
const initial={deployment,controller},replacement={...deployment,walletId:'gas-new',address:a(2)};
const env={RACESON_REWARD_PORTAL_MODE:'local-testnet',RACESON_REWARD_PRIVY_APP_ID:deployment.appId,RACESON_CONTROLLER_DEPLOYMENT:JSON.stringify(deployment),RACESON_SPONSOR_DEPLOYMENT_APP_SECRET:'synthetic',RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY:'synthetic'};
function fixture(){let revision=0,settings=null,allowed=true,writes=0,history=[];const rpc=async(name,args)=>{
 if(name==='service_reward_wallet_runtime')return{error:null,data:{revision,settings,controllers:history.flatMap(h=>[h.settings.controller,initial.controller]),deployments:history.flatMap(h=>[h.settings.deployment,initial.deployment])}};
 if(name==='service_reward_sponsor_auto_deployment')return{error:null,data:{sender:initial.deployment.address}};
 assert.equal(name,'service_reward_wallet_settings');assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_actor_session_id,identity.sessionId);
 if(!allowed)return{data:null,error:{message:'reward_master_admin_required'}};
 if(args.p_settings){if(args.p_expected_revision!==revision)return{data:null,error:{message:'reward_wallet_settings_conflict'}};writes++;settings=args.p_settings;revision++;history.push({revision,settings,changed_by:identity.userId,reason:args.p_reason,changed_at:new Date().toISOString()});}
 return{error:null,data:{revision,settings,history}};
 };return{rpc,get writes(){return writes;},revoke:()=>allowed=false,seed:()=>{settings={deployment:replacement,controller};revision=1;history=[{revision,settings,changed_by:identity.userId,reason:'Synthetic activation',changed_at:new Date().toISOString()}];}};}
const pair=await generateKeyPair('ES256'),policy={appId:deployment.appId,verificationKey:await exportSPKI(pair.publicKey),...controller};delete policy.walletId;delete policy.ownerId;env.RACESON_REWARD_CONTROLLER=JSON.stringify(policy);
const command={action:'review',role:'deployment',walletId:'gas-new',expectedRevision:0,expectedFingerprint:walletSettingsFingerprint(initial)};
test('hosted gas display excludes the retained baseline and reads only an activated dedicated wallet',async()=>{
 const hosted={...env,RACESON_REWARD_PORTAL_MODE:'testnet',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 let reads=0;
 const reader={getBalance:async({address,blockTag})=>{reads++;assert.equal(address,replacement.address);assert.equal(blockTag,'latest');return 123n;}};
 for(const state of [{revision:0,settings:null},{revision:1,settings:initial}]){
  const rpc=async(name,args)=>{assert.equal(name,'service_reward_demo_copy_wallet_operation');assert.equal(args.p_operation,'runtime');return {data:{...state,controllers:[],deployments:[]},error:null};};
  assert.equal(await readConfiguredSupportGas(hosted,rpc,reader),null);
 }
 assert.equal(reads,0);
 const rpc=async()=>({data:{revision:1,settings:{deployment:replacement,controller},controllers:[],deployments:[]},error:null});
 assert.deepEqual(await readConfiguredSupportGas(hosted,rpc,reader),{address:replacement.address,balanceWei:'123'});assert.equal(reads,1);
});
test('review never writes; activation re-verifies provider and writes a CAS-protected audit',async()=>{
 const f=fixture(),calls=[];const verify=async(role,id)=>{calls.push([role,id]);return replacement;};
 const review=await changeWalletAdministration(identity,command,env,verify,f.rpc);assert.equal(f.writes,0);assert.equal(review.candidate.deployment.address,a(2));
 const saved=await changeWalletAdministration(identity,{...command,action:'activate',candidateFingerprint:review.fingerprint,reason:'Separate the creation queue'},env,verify,f.rpc);
 assert.equal(saved.revision,1);assert.equal(f.writes,1);assert.equal(saved.history[0].changed_by,identity.userId);assert.equal(calls.length,3);
 await assert.rejects(()=>changeWalletAdministration(identity,command,env,verify,f.rpc),/conflict/);assert.equal(f.writes,1);
});
test('no review binding, equal wallets, provider failure and authority revoked during I/O cannot write',async()=>{
 for(const scenario of ['binding','same','provider','revoked']){
  const f=fixture();const verify=async()=>{if(scenario==='revoked')f.revoke();if(scenario==='provider')throw Error('provider unavailable');return scenario==='same'?deployment:replacement;};
  await assert.rejects(()=>changeWalletAdministration(identity,{...command,action:scenario==='binding'?'activate':'review',candidateFingerprint:'0'.repeat(64),reason:'Disposable negative test'},env,verify,f.rpc));assert.equal(f.writes,0);
 }
});
test('new default does not substitute the signer on an existing job',async()=>{
 const f=fixture();f.seed();assert.equal((await resolveDeploymentSigner(env,undefined,undefined,f.rpc)).address,a(2));
 assert.equal((await resolveDeploymentSigner(env,identity,uuid(3),f.rpc)).address,a(1));
});
test('retained controller identity is still authenticated and an arbitrary wallet cannot be selected',async()=>{
 const f=fixture();f.seed();const token=await new SignJWT({sid:'fixture'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(policy.appId).setSubject(controller.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
 assert.equal((await resolveControllerPolicy(env,token,a(1),f.rpc)).wallet,a(1));
 await assert.rejects(()=>resolveControllerPolicy(env,token,a(9),f.rpc),/controller_auth_required/);
 await assert.rejects(()=>resolveControllerPolicy(env,'forged',a(1),f.rpc),/controller_auth_required/);
});
test('admin endpoint rejects foreign origin and unauthorized account before any provider lookup',async()=>{
 const f=fixture();f.revoke();let output,provider=0;
 const deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),requireIdentity:async()=>identity,readJsonBody:async()=>command,applyPrivateSessionHeaders(){},sendSuccess(){assert.fail('unauthorized success');},sendError:(_r,status,code)=>output={status,code},walletEnvironment:env,rpc:f.rpc,verifyWallet:async()=>{provider++;return replacement;}};
 const url=new URL('http://127.0.0.1:3102/api/v1/rewards/admin/wallets');
 for(const headers of [{origin:'https://foreign.invalid'},{}]){await dispatchWalletAdministration({method:'POST',headers},{setHeader(){}},url,deps);assert.equal(output.status,403);}
 assert.equal(provider,0);assert.equal(f.writes,0);
});

test('controller replacements require a linked native wallet and exclude sponsor custom-auth accounts',async()=>{
 const {verifyControllerOwner}=await import('../dist/features/rewards/wallet-administration.js');
 const linked={type:'wallet',id:'native',address:a(2),chain_type:'ethereum',connector_type:'embedded',wallet_client_type:'privy',imported:false,user_can_sign:true};
 const user={id:'did:privy:native',linked_accounts:[linked]};
 assert.equal(verifyControllerOwner(user,'native',a(2)),user.id);
 for(const linked_accounts of [[linked,{type:'custom_auth'}],[{...linked,imported:true}],[{...linked,user_can_sign:false}],[{...linked,id:'wrong'}],[]])assert.throws(()=>verifyControllerOwner({...user,linked_accounts},'native',a(2)),/reward_wallet_unverified/);
});

test('controller default can rotate independently and cannot reuse a historical gas wallet',async()=>{
 const {readWalletAdministration}=await import('../dist/features/rewards/wallet-administration.js');
 const f=fixture();f.seed();const before=await readWalletAdministration(identity,env,f.rpc);
 const input={action:'review',role:'controller',walletId:'new-controller',expectedRevision:before.revision,expectedFingerprint:before.fingerprint};
 const nextController={subject:'did:privy:next',wallet:a(3),walletId:'new-controller',ownerId:'next-owner'};
 const verify=async(role)=>role==='controller'?nextController:replacement;
 const reviewed=await changeWalletAdministration(identity,input,env,verify,f.rpc);
 const saved=await changeWalletAdministration(identity,{...input,action:'activate',candidateFingerprint:reviewed.fingerprint,reason:'Rotate distribution authority'},env,verify,f.rpc);
 assert.equal(saved.settings.controller.wallet,a(3));assert.equal(saved.settings.deployment.address,a(2));assert.equal(f.writes,1);
 const latest=await readWalletAdministration(identity,env,f.rpc);
 await assert.rejects(()=>changeWalletAdministration(identity,{...input,expectedRevision:latest.revision,expectedFingerprint:latest.fingerprint},env,async()=>({...nextController,wallet:a(1)}),f.rpc),/previous_role_conflict/);
});

test('creation preparation checks master/CAS, verifies policy owner, then rechecks session without writes',async()=>{
 const {prepareWalletCreation}=await import('../dist/features/rewards/wallet-administration.js');
 const input={expectedRevision:0,expectedFingerprint:walletSettingsFingerprint(initial)};
 const f=fixture();let calls=0;
 const prepared=await prepareWalletCreation(identity,input,env,async()=>{calls++;return controller.subject;},f.rpc);
 assert.equal(prepared.ownerSubject,controller.subject);assert.deepEqual(prepared.deployment,deployment);assert.equal(f.writes,0);assert.equal(calls,1);
 for(const scenario of ['unauthorized','stale','revoked','changed','wrongOwner']){
  const x=fixture();if(scenario==='unauthorized')x.revoke();if(scenario==='stale')x.seed();let lookup=0;
  await assert.rejects(()=>prepareWalletCreation(identity,input,env,async()=>{lookup++;if(scenario==='revoked')x.revoke();if(scenario==='changed')x.seed();return scenario==='wrongOwner'?'service-owned':controller.subject;},x.rpc));
  if(['unauthorized','stale'].includes(scenario))assert.equal(lookup,0);assert.equal(x.writes,0);
 }
});
test('controller creation resolves its own native owner and current wallet without activating settings',async()=>{
 const {prepareWalletCreation}=await import('../dist/features/rewards/wallet-administration.js');
 const f=fixture();f.seed();const {readWalletAdministration}=await import('../dist/features/rewards/wallet-administration.js');
 const before=await readWalletAdministration(identity,env,f.rpc);let seen;
 const prepared=await prepareWalletCreation(identity,{role:'controller',expectedRevision:before.revision,expectedFingerprint:before.fingerprint},env,async(current,role)=>{seen={current,role};return current.controller.subject;},f.rpc);
 assert.equal(seen.role,'controller');assert.equal(prepared.role,'controller');assert.equal(prepared.currentWalletAddress,controller.wallet);assert.equal(prepared.ownerSubject,controller.subject);assert.equal(f.writes,0);
 await assert.rejects(()=>prepareWalletCreation(identity,{role:'sponsor',expectedRevision:before.revision,expectedFingerprint:before.fingerprint},env,async()=>{assert.fail('invalid role resolved');},f.rpc));
});
test('hosted creation cannot borrow the retained local gas wallet or change an existing journal signer',async()=>{
 const hosted={...env,RACESON_REWARD_PORTAL_MODE:'testnet',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 let revision=0,settings=null;
 const runtime=async(name,args)=>{assert.equal(name,'service_reward_demo_copy_wallet_operation');assert.equal(args.p_operation,'runtime');return {error:null,data:{revision,settings,controllers:[],deployments:[]}};};
 assert.equal(await resolveDeploymentSigner(hosted,undefined,undefined,undefined,runtime),null);
 revision=1;settings={deployment,controller};assert.equal(await resolveDeploymentSigner(hosted,undefined,undefined,undefined,runtime),null);
 settings={deployment:replacement,controller:{...controller,wallet:a(3)}};assert.equal((await resolveDeploymentSigner(hosted,undefined,undefined,undefined,runtime)).address,replacement.address);
 const pending=async(name)=>{assert.equal(name,'service_reward_sponsor_auto_deployment');return {error:null,data:{sender:deployment.address}};};
 assert.equal(await resolveDeploymentSigner(hosted,identity,uuid(3),pending,runtime),null);
});

test('V5 upgrade retains the active gas wallet and owner, requiring a new exact grant',async()=>{
 const {configuredDeploymentUpgrade,prepareWalletCreation,readWalletAdministration}=await import('../dist/features/rewards/wallet-administration.js');
 const f=fixture();f.seed();const current=await readWalletAdministration(identity,env,f.rpc);
 const next={...replacement,protocolVersion:5,factory:a(5),signerId:'v5-signer',policyId:'v5-policy'};
 const configured={...env,RACESON_CONTROLLER_DEPLOYMENT_UPGRADE_V5:JSON.stringify(next)};
 assert.deepEqual(configuredDeploymentUpgrade(configured,current.settings),next);
 const prepared=await prepareWalletCreation(identity,{upgrade:true,expectedRevision:current.revision,expectedFingerprint:current.fingerprint},configured,async()=>controller.subject,f.rpc);
 assert.equal(prepared.mode,'upgrade');assert.equal(prepared.currentWalletAddress,replacement.address);assert.deepEqual(prepared.deployment,next);assert.equal(f.writes,0);
 for(const bad of [{...next,address:a(7)},{...next,ownerId:'other'},{...next,walletId:'other'},{...next,appId:'other'},{...next,signerId:replacement.signerId},{...next,factory:replacement.factory}]){
  assert.throws(()=>configuredDeploymentUpgrade({...configured,RACESON_CONTROLLER_DEPLOYMENT_UPGRADE_V5:JSON.stringify(bad)},current.settings),/upgrade_unavailable/);
 }
 await assert.rejects(()=>prepareWalletCreation(identity,{upgrade:true,role:'controller',expectedRevision:current.revision,expectedFingerprint:current.fingerprint},configured,async()=>controller.subject,f.rpc),/upgrade_unavailable/);
});

test('the same creation wallet retains the original factory grant for pending jobs',async()=>{
 const v5={...replacement,factory:a(8),signerId:'v5-signer',policyId:'v5-policy',protocolVersion:5};
 const runtime=async()=>({error:null,data:{revision:2,settings:{deployment:v5,controller},controllers:[],deployments:[replacement]}});
 const pending=async()=>({error:null,data:{sender:replacement.address,transaction:{to:replacement.factory}}});
 assert.equal((await resolveDeploymentSigner(env,identity,uuid(3),pending,runtime)).factoryAddress,replacement.factory);
 assert.equal((await resolveDeploymentSigner(env,undefined,undefined,undefined,runtime)).factoryAddress,v5.factory);
 const bad=async()=>({error:null,data:{sender:replacement.address,transaction:{to:a(9)}}});
 assert.equal(await resolveDeploymentSigner(env,identity,uuid(3),bad,runtime),null);
});

test('saved V4 plans without a transaction retain their factory after the V5 upgrade',async()=>{
 const v5={...replacement,factory:a(8),signerId:'v5-signer',policyId:'v5-policy',protocolVersion:5};
 const hosted={...env,RACESON_REWARD_PORTAL_MODE:'testnet',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 const state={revision:2,settings:{deployment:v5,controller},controllers:[],deployments:[replacement]};
 const runtime=async()=>({error:null,data:state}),unreserved=async()=>({error:null,data:null});
 assert.equal((await resolveDeploymentSigner(hosted,identity,uuid(3),unreserved,runtime,4)).factoryAddress,replacement.factory);
 assert.equal((await resolveDeploymentSigner(hosted,identity,uuid(3),unreserved,runtime,5)).factoryAddress,v5.factory);
 const conflicting=async()=>({error:null,data:{sender:replacement.address,transaction:{to:replacement.factory}}});
 assert.equal(await resolveDeploymentSigner(hosted,identity,uuid(3),conflicting,runtime,5),null);
 state.deployments=[];
 assert.equal(await resolveDeploymentSigner(hosted,identity,uuid(3),unreserved,runtime,4),null);
});
