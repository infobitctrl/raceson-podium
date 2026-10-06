import {test} from 'node:test';import assert from 'node:assert/strict';
import {toHex} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {plan as original,deploymentHash,fundingHash,settlementFixture} from '../../../packages/rewards-chain/test/sponsor-settlement-fixture.mjs';
import {hostedCopySettlementFacts} from '../../../packages/db/dist/rewards/hosted-copy-settlement.js';
import {hostedCopyControllerRpc} from '../../../packages/db/dist/rewards/hosted-copy-controller.js';
import {currentSettlement,preparedSettlement,settlementView,recoverSettlementReceipt} from '../dist/features/rewards/sponsor-settlement-v4-service.js';
import {advanceControllerTransaction} from '../dist/features/rewards/controller-transactions.js';
import {dispatchRewardController} from '../dist/routes/rewards/controller.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const id=n=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=privateKeyToAccount(toHex(99123n,{size:32})); // Synthetic fixture only.
const actor={subject:'did:privy:disposable_settlement',wallet:account.address.toLowerCase()},plan={...original,chainId:10143,operator:actor.wallet};
function owned(){const {f,state,mined}=settlementFixture(plan),facts={setupId:id(1),slot:0,execution:{plan,deploymentHash,fundingHash},receipts:[]},calls=[];let job=null;
 const rpc=async(name,a)=>{calls.push([name,a]);if(name==='service_reward_demo_copy_settlement'){assert.equal(a.p_subject,actor.subject);assert.equal(a.p_sender,actor.wallet);assert.equal(a.p_setup_id,id(1));assert.equal(a.p_slot,0);
  if(a.p_action==='receipt')facts.receipts=[{id:a.p_input.requestId,body:structuredClone(a.p_input.body)}];return{data:structuredClone(facts),error:null};}
  assert.equal(name,'service_reward_controller_transaction');if(a.p_action==='reserve')job={id:a.p_id,subject:actor.subject,sender:actor.wallet,context:a.p_context,transaction:a.p_transaction,signedTransaction:null,hash:null,confirmed:false};
  if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed,hash:a.p_hash};if(a.p_action==='confirm')job={...job,confirmed:true};return{data:job,error:null};};
 const originalReceipt=f.reader.getTransactionReceipt;f.reader.getTransactionReceipt=async p=>{if(([deploymentHash,fundingHash,toHex(12n,{size:32})].includes(p.hash)||p.hash===job?.hash&&f.anchor===31n))return originalReceipt(p);throw Error('synthetic receipt pending');};
 const baseBalance=f.reader.getBalance;f.reader.getBalance=async p=>p.address===actor.wallet?10n**18n:baseBalance(p);f.reader.estimateGas=async()=>100000n;f.reader.getGasPrice=async()=>1n;f.reader.getTransactionCount=async()=>0;let sent=0;f.reader.sendRawTransaction=async()=>{sent++;throw Error('synthetic ambiguous response');};
 const d={reader:f.reader,assertActive:async()=>{},readFacts:hostedCopySettlementFacts(actor,id(1),0,rpc)};
 return{f,state,mined,facts,calls,rpc,d,getJob:()=>job,getSent:()=>sent};}
test('native store freezes actor and rejects cross-scope/malformed receipts and fixed-method expansion',async()=>{
 const o=owned(),a={...actor},facts=hostedCopySettlementFacts(a,id(1),0,o.rpc);a.wallet=plan.funder;a.subject='did:privy:foreign';assert.equal((await facts()).execution.plan.operator,actor.wallet);
 o.facts.slot=1;await assert.rejects(facts);o.facts.slot=0;o.facts.execution.plan={...plan,operator:plan.funder};await assert.rejects(facts);
 const calls=[],rpc=hostedCopyControllerRpc(actor,async(n,a)=>{calls.push(n);return{data:null,error:null};}),args={p_subject:actor.subject,p_sender:actor.wallet,p_setup_id:id(1),p_slot:0,p_action:'read',p_input:{}};
 await rpc('service_reward_demo_copy_settlement',args);for(const patch of [{p_sender:plan.funder},{p_subject:'did:privy:foreign'},{p_approval_id:id(2)},{p_chain_id:1}])await assert.rejects(()=>rpc('service_reward_demo_copy_settlement',{...args,...patch}));assert.equal(calls.length,1);
});
test('status and preparation bind original funded escrow and explicit action, with source/authority fencing',async()=>{
 const o=owned(),v=await settlementView(o.d);assert.equal(v.pot.paidWei,'10');assert.equal(v.lanes.expired.remainingWei,'30');assert.equal(v.available[0].action,'close');assert(!('input' in v));
 const prep=await preparedSettlement(o.d,'close',v.sourceHash);assert.equal(prep.transaction.value,'0');assert.equal(prep.transaction.from,actor.wallet);
 await assert.rejects(()=>preparedSettlement(o.d,'returnExpired',v.sourceHash));await assert.rejects(()=>preparedSettlement(o.d,'close','f'.repeat(64)));
 const originalRead=o.f.reader.readContract;o.f.reader.readContract=async p=>{o.facts.execution.fundingHash=toHex(999n,{size:32});return originalRead(p);};await assert.rejects(()=>currentSettlement(o.d),/source_not_ready/);
 const revoked=owned();revoked.d.assertActive=async()=>{throw Error('controller_auth_required');};await assert.rejects(()=>settlementView(revoked.d),/auth_required/);assert.equal(revoked.calls.length,0);
});
test('manual exact receipt recovery uses original lane amounts/recipients and cannot substitute a hash or paid funds',async()=>{
 const o=owned();o.state.stage=4;await o.mined('returnExpired');const v=await recoverSettlementReceipt(o.d,id(8),toHex(12n,{size:32}),'returnExpired');
 assert.equal(v.receipts[0].body.amountWei,'30');assert.equal(v.receipts[0].body.recipient,plan.expiredTreasury);assert.equal(v.pot.paidWei,'10');assert.equal(v.lanes.expired.remainingWei,'0');assert.equal(v.lanes.unallocated.remainingWei,'60');
 await assert.rejects(()=>recoverSettlementReceipt(o.d,id(9),toHex(12n,{size:32}),'returnUnallocated'));
 const writes=o.calls.filter(([n,a])=>a.p_action==='receipt');assert.equal(writes.length,1);
});
test('settlement journal reserves exact zero-value original method and recovers identical signed bytes after ambiguous send',async()=>{
 const o=owned(),v=await settlementView(o.d),deps={actor,reader:o.f.reader,assertActive:o.d.assertActive,rpc:o.rpc};
 const r={action:'prepare',kind:'settlement',setupId:id(1),slot:0,operation:'close',expectedSourceHash:v.sourceHash};
 const j=await advanceControllerTransaction(deps,r);assert.equal(j.context.action,'close');assert.equal(j.context.recipient,null);assert.equal(j.transaction.value,'0');assert.equal(j.transaction.gas,'120000');
 assert.deepEqual(await advanceControllerTransaction(deps,r),j);await assert.rejects(()=>advanceControllerTransaction(deps,{...r,operation:'returnExpired'}),/pending/);
 const t=j.transaction,bytes=await account.signTransaction({chainId:10143,to:t.to,data:t.data,value:0n,nonce:Number(t.nonce),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)});
 const pending=await advanceControllerTransaction(deps,{action:'submit',id:j.id,signedTransaction:bytes});assert.equal(pending.confirmed,false);assert.equal(o.getSent(),1);
 const recovered=await advanceControllerTransaction(deps,{action:'resume',id:j.id});assert.equal(recovered.hash,pending.hash);assert.equal(o.getJob().signedTransaction,bytes);assert.equal(o.getSent(),2);
 assert.equal(o.calls.filter(([,a])=>a.p_action==='reserve').length,1);
 await o.mined('close',pending.hash);const confirmed=await advanceControllerTransaction(deps,{action:'resume',id:j.id});assert.equal(confirmed.confirmed,true);assert.equal(o.facts.receipts[0].body.transactionHash,pending.hash);assert.equal(o.facts.receipts[0].body.amountWei,'0');assert.equal(o.getSent(),2);
});
test('bounded hosted route accepts only native identity, exact slot/action/hash input and read/receipt methods',async()=>{
 const pair=await generateKeyPair('ES256'),policy={appId:'synthetic_privy_app',verificationKey:await exportSPKI(pair.publicKey),subject:actor.subject,wallet:actor.wallet},token=await new SignJWT({sid:'synthetic_session'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(policy.appId).setSubject(actor.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
 const o=owned();let body,response,credential=token,resolves=0;const url=new URL(`https://podium.raceson.com/api/v1/rewards/control/campaigns/${id(1)}/settlement/0`),deps={config:()=>({origin:url.origin,chainId:10143}),controllerPolicy:()=>policy,requireToken:async()=>credential,reader:o.f.reader,resolveRpc:()=>{resolves++;return o.rpc;},applyPrivateSessionHeaders(){},readJsonBody:async()=>body,sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};}};
 const request=(method='GET',u=url)=>dispatchRewardController({method,headers:{}},{setHeader(){}},u,deps);
 credential='ordinary-auth';await request();assert.equal(response.status,401);assert.equal(resolves,0);credential=token;
 await request();assert.equal(response.status,200);assert.equal(response.data.schema,'podium-sponsor-settlement-view-v1');
 body={action:'receipt',requestId:id(3),operation:'returnExpired',transactionHash:toHex(12n,{size:32}),recipient:plan.funder,amountWei:'100'};await request('POST');assert.equal(response.status,400);
 await request('GET',new URL(url+'?operator=browser'));assert.equal(response.status,400);await request('GET',new URL(url.href.slice(0,-1)+'01'));assert.equal(response.status,400);
 for(const method of ['GET','POST','PATCH','DELETE'])assert.equal(hostedCopyRequestAllowed(method,url,'sponsor-drafts-v1',true),['GET','POST'].includes(method));
 assert.equal(hostedCopyRequestAllowed('GET',url,'sponsor-drafts-v1',false),false);
});
