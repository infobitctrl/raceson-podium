import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {decodeFunctionData,parseTransaction,keccak256,toHex} from 'viem';
import {sponsorAllocationFixture,sponsorFixtureId as id} from './fixtures/sponsor-allocation.mjs';
import {fixture as chainFixture,deploymentHash,fundingHash} from '../../../packages/rewards-chain/test/sponsor-settlement-fixture.mjs';
import {decodeRewardAllocationSourceV3} from '@raceson/domain/rewards/allocation-preview-v3';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {sponsorAllocationDocumentHashV4 as digest,reviewPublicationRpc} from '@raceson/db/rewards';
import {composeSponsorUploadV4} from '../dist/features/rewards/sponsor-upload-v4-service.js';
import {reviewPublication} from '../dist/features/rewards/review-publication-service.js';
import {sponsorLifecycleAbi,sponsorLifecycleCommitmentV4} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
import {rewardUploadDigest} from '@raceson/rewards-chain';
import {inspectReviewWallet,publicationSigningRequest,signAuthorizedPublication} from '../dist/features/rewards/review-publication-privy.js';
const json=v=>JSON.parse(JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v));
function fixture(){
 const account=privateKeyToAccount(toHex(908n,{size:32})),f=sponsorAllocationFixture();
 f.launch.setup.chainId=10143;f.launch.setup.configuration.budgetMon='0.0000000000000001';f.launch.setup.configuration.policy.claimWindowDays=1;
 f.launch.setup.configuration.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);
 Object.assign(f.plan,{chainId:10143,operator:account.address.toLowerCase(),budgetWei:'100',caps:['100','0','0','0','0','0'],claimLifetime:86400});
 f.source=decodeRewardAllocationSourceV3(f.source);
 const document={schema:'raceson-sponsor-allocation-document-v4',...f,slot:0,contextHash:'c'.repeat(64),calculation:previewSponsorAllocation(f.launch,f.plan,f.binding,f.source).pots[0]};
 const chain=chainFixture({funded:true,executionPlan:f.plan}),upload={document,documentHash:digest(document),contextHash:document.contextHash,approvalId:id(900),current:true,execution:{plan:f.plan,deploymentHash,fundingHash},snapshotSalt:toHex(100n,{size:32}),prepared:null,recipients:document.calculation.recipients.map((r,i)=>({beneficiaryKind:r.beneficiaryKind,beneficiaryId:r.beneficiaryId,amountWei:r.amountWei,entitlementId:toHex(200n+BigInt(i),{size:32}),opaqueBeneficiaryId:toHex(300n+BigInt(i),{size:32}),explanationSalt:toHex(400n+BigInt(i),{size:32})}))};
 const programme=chain.created.contractAddress,pkg=composeSponsorUploadV4(upload,programme);
 upload.prepared={id:id(901),packageHash:digest(pkg),package:pkg,preparedAt:'2026-10-07T00:00:00.000Z',actorUserId:id(902)};
 const evidence={schema:'synthetic-official-results'},publication={id:id(903),body:{schema:'raceson-sponsor-publication-v4',approvalId:upload.approvalId,contextHash:upload.contextHash,packageHash:upload.prepared.packageHash,evidence,timing:{reviewPeriod:'0',reviewStartedAt:'1790000000',officialPublishedAt:'1790000000',publicationEvidenceHash:'0x'+digest(evidence)}},current:true,createdAt:'2026-10-07T00:00:00.000Z'};publication.bodyHash=digest(publication.body);
 const facts={upload,publication,receipts:[]},scope={chainId:10143,setupId:f.launch.setup.id,slot:0,approvalId:upload.approvalId},identity={userId:id(902),sessionId:id(904)};
 const binding={plan:f.plan,slot:0,deploymentHash,fundingHash,campaignAddress:pkg.campaignAddress,snapshotDigest:pkg.snapshotDigest,awards:pkg.awards.map(a=>({...a,amount:BigInt(a.amount)})),publication:publication.body.timing};
 const commitment=sponsorLifecycleCommitmentV4(binding),base={...chain.reader},calls=[],jobs=[],transactions=new Map(),state={count:0,stage:1,allocated:0n,nonce:0};
 let job=null,failBroadcast=false,revoked=false,signCount=0;
 const rpc=async(name,args)=>{
  assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_actor_session_id,identity.sessionId);
  if(revoked)return {data:null,error:{message:'reward_account_session_required'}};
  calls.push(name);
  if(name==='service_reward_demo_copy_lifecycle')return {data:json(facts),error:null};
  if(name==='service_reward_demo_copy_review_publication_receipt'){facts.receipts.push({id:args.p_id,body:args.p_receipt});return {data:json(facts),error:null};}
  assert.equal(name,'service_reward_demo_copy_review_publication_transaction');assert.equal(args.p_operator,f.plan.operator);assert.equal(args.p_setup_id,scope.setupId);assert.equal(args.p_approval_id,scope.approvalId);
  if(args.p_action==='reserve'){assert(!job||job.confirmed);job={id:args.p_id,subject:'service:review-publication',sender:f.plan.operator,context:args.p_context,transaction:args.p_transaction,signedTransaction:null,hash:null,confirmed:false};jobs.push(job);}
  if(args.p_action==='signed'){assert(!job.signedTransaction||job.signedTransaction===args.p_signed);job.signedTransaction=args.p_signed;job.hash=args.p_hash;}
  if(args.p_action==='confirm'){assert(facts.receipts.some(r=>r.id===job.id&&r.body.transactionHash===job.hash));job.confirmed=true;}
  return {data:json(args.p_action==='read'&&!args.p_id&&job?.confirmed?null:job),error:null};
 };
 const reader={...base,getBalance:async({address})=>address.toLowerCase()===f.plan.operator?10n**18n:100n,getTransactionCount:async()=>state.nonce,estimateGas:async()=>100000n,getGasPrice:async()=>1n,
  readContract:async a=>{
   if(a.functionName==='state')return state.stage;
   if(a.functionName==='entitlementCount')return BigInt(state.count);
   if(a.functionName==='allocated')return a.args[0]===1n?state.allocated:0n;
   if(a.functionName==='claimDeadline')return state.stage===3?1800086400n:0n;
   if(a.functionName==='uploadDigest')return state.count?rewardUploadDigest(binding.awards.slice(0,state.count),1,100n).digest:toHex(0n,{size:32});
   if(a.functionName==='allocationDigest')return state.stage>=2?commitment.allocationDigest:toHex(0n,{size:32});
   if(a.functionName==='snapshotDigest')return state.stage>=2?binding.snapshotDigest:toHex(0n,{size:32});
   return base.readContract(a);
  },getTransaction:async args=>transactions.get(args.hash)?.tx??base.getTransaction(args),getTransactionReceipt:async args=>{if(args.hash===deploymentHash||args.hash===fundingHash)return base.getTransactionReceipt(args);const r=transactions.get(args.hash)?.receipt;if(!r)throw Error('not mined');return r;},
  sendRawTransaction:async({serializedTransaction})=>{if(failBroadcast){failBroadcast=false;throw Error('uncertain network');}const hash=keccak256(serializedTransaction);if(transactions.has(hash))return hash;
   const tx=parseTransaction(serializedTransaction),decoded=decodeFunctionData({abi:sponsorLifecycleAbi,data:tx.data});
   if(decoded.functionName==='uploadAwards'){state.count+=decoded.args[0].length;state.allocated=decoded.args[0].reduce((n,a)=>n+a.amount,state.allocated);}
   if(decoded.functionName==='stageAllocation')state.stage=2;if(decoded.functionName==='activate')state.stage=3;state.nonce++;
   const block=await base.getBlock({blockNumber:30n});transactions.set(hash,{tx:{...tx,value:tx.value??0n,hash,input:tx.data,from:f.plan.operator,blockHash:block.hash,blockNumber:block.number,transactionIndex:0},receipt:{transactionHash:hash,from:f.plan.operator,to:pkg.campaignAddress,status:'success',blockHash:block.hash,blockNumber:block.number,transactionIndex:0}});return hash;
  }};
 const signer={address:f.plan.operator,verifyReady:async()=>{},request:(t,expiry)=>publicationSigningRequest('c'.repeat(25),'wallet',t,expiry),sign:async(t,signature,expiry)=>{assert.equal(signature,'S'.repeat(88));assert(expiry>Date.now());signCount++;return account.signTransaction({type:'legacy',chainId:10143,to:t.to,data:t.data,value:0n,nonce:Number(t.nonce),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)});}};
 const deps={rpc,reader,resolveAccess:async()=>({status:'owned',signer})},prepare=command=>reviewPublication(identity,scope,command,deps);
 const run=async command=>{const v=await prepare(command);return v.authorization?prepare({...command,transactionId:v.authorization.transactionId,authorizationSignature:'S'.repeat(88),requestExpiry:Number(v.authorization.request.headers['privy-request-expiry'])}):v;};
 return {run,prepare,facts,deps,scope,identity,calls,jobs,state,command:{expectedDocumentHash:upload.documentHash},signCount:()=>signCount,uncertain:()=>{failBroadcast=true;},revoke:()=>{revoked=true;}};
}
test('reviewer drives verified upload, staging and activation without native user impersonation; GET never signs',async()=>{
 const f=fixture();assert.equal((await f.run()).claimsOpen,false);assert.equal(f.signCount(),0);assert.equal(f.jobs.length,0);
 for(let i=0;i<12;i++){const v=await f.run(f.command);if(v.claimsOpen&&(!v.pending||v.pending.confirmed))break;}
 assert.equal((await f.run()).claimsOpen,true);assert.equal(f.state.stage,3);assert.equal(f.jobs.length,Math.ceil(f.state.count/32)+2);assert.equal(f.signCount(),f.jobs.length);assert(f.jobs.every(j=>j.confirmed));assert.equal(f.facts.receipts.length,f.jobs.length);
 const count=f.signCount();await f.run(f.command);assert.equal(f.signCount(),count);
});
test('ambiguous send retries identical signed bytes and nonce; revoked reviewer cannot advance',async()=>{
 const f=fixture();f.uncertain();await f.run(f.command);assert.equal(f.signCount(),1);const bytes=f.jobs[0].signedTransaction;
 await f.run(f.command);assert.equal(f.signCount(),1);assert.equal(f.jobs[0].signedTransaction,bytes);
 f.revoke();await assert.rejects(f.run(f.command));assert.equal(f.signCount(),1);
});
test('missing reviewer ownership, changed digest and stale source never reserve or sign',async()=>{
 const f=fixture();f.deps.resolveAccess=async()=>({status:'transfer_required',signer:null});assert.equal((await f.run()).ownership,'transfer_required');await assert.rejects(f.run(f.command),/review_wallet_ownership_required/);assert.equal(f.jobs.length,0);
 const g=fixture();await assert.rejects(g.run({expectedDocumentHash:'a'.repeat(64)}),/controller_source_not_ready/);assert.equal(g.signCount(),0);
 g.facts.upload.current=false;await assert.rejects(g.run(g.command),/controller_source_not_ready/);assert.equal(g.jobs.length,0);
 const h=fixture();h.deps.resolveAccess=async()=>({status:'owned',signer:{address:'0x'+'11'.repeat(20)}});await assert.rejects(h.run(h.command),/review_wallet_ownership_required/);assert.equal(h.jobs.length,0);
});
test('publication transport cannot fall through to native authority or other privileged RPCs',async()=>{
 const rpc=reviewPublicationRpc({userId:id(1),sessionId:id(2)},{chainId:10143,setupId:id(3),approvalId:id(4),slot:0},'0x'+'11'.repeat(20),async()=>assert.fail('must not call DB'));
 await assert.rejects(rpc('service_reward_controller_transaction',{p_subject:'did:privy:forged',p_sender:'0x'+'11'.repeat(20)}),/controller_scope_required/);
 await assert.rejects(rpc('service_reward_wallet_runtime',{}),/controller_scope_required/);
});
test('provider ownership belongs only to the exact custom-auth reviewer; app and native ownership are not reviewer permission',async()=>{
 const identity={userId:id(902),sessionId:id(904)},operator='0x'+'11'.repeat(20),registered={wallet:operator,walletId:'wallet',ownerId:'original',subject:'did:privy:original'};
 let ownerSubject=registered.subject,targetId='did:privy:reviewer',linkedId=identity.userId;
 const wallet={id:'wallet',address:operator,chain_type:'ethereum',owner_id:'owner',additional_signers:[],policy_ids:[]};
 const client=(w=wallet,quorum={})=>({wallets:()=>({get:async()=>w}),users:()=>({getByCustomAuthID:async()=>({id:targetId,linked_accounts:[{type:'custom_auth',custom_user_id:linkedId}]})}),keyQuorums:()=>({get:async()=>({authorization_threshold:1,authorization_keys:[],user_ids:[ownerSubject],key_quorum_ids:[],...quorum})})});
 assert.equal((await inspectReviewWallet(client(),identity,operator,registered,'app')).status,'transfer_required');
 ownerSubject=targetId;assert.equal((await inspectReviewWallet(client(),identity,operator,registered,'app')).status,'owned');
 ownerSubject='did:privy:stranger';await assert.rejects(inspectReviewWallet(client(),identity,operator,registered,'app'),/review_wallet_unverified/);
 ownerSubject=targetId;linkedId=id(905);await assert.rejects(inspectReviewWallet(client(),identity,operator,registered,'app'),/review_wallet_unverified/);linkedId=identity.userId;
 for(const [w,q] of [[{...wallet,additional_signers:[{signer_id:'background'}]},{}],[wallet,{authorization_keys:[{public_key:'service'}]}],[wallet,{user_ids:[targetId,registered.subject]}],[{...wallet,exported_at:1},{}]])await assert.rejects(inspectReviewWallet(client(w,q),identity,operator,registered,'app'),/review_wallet_unverified/);
 const missing=client();missing.users=()=>({getByCustomAuthID:async()=>{throw {status:404};}});ownerSubject=registered.subject;assert.equal((await inspectReviewWallet(missing,identity,operator,registered,'app')).status,'connect_required');
});

test('handover verifies the original owner, fixes the reviewer recipient and recovers a lost provider response',async()=>{
 const {generateKeyPair,exportSPKI,SignJWT}=await import('jose');
 const {reviewWalletHandover}=await import('../dist/features/rewards/review-wallet-handover.js');
 const {privateKey,publicKey}=await generateKeyPair('ES256'),key=await exportSPKI(publicKey),f=fixture(),appId='c'.repeat(25),previous='did:privy:original',target='did:privy:reviewer';
 const env={RACESON_REWARD_CONTROLLER:JSON.stringify({appId,verificationKey:key,subject:previous,wallet:f.facts.upload.execution.plan.operator}),RACESON_REWARD_PRIVY_APP_ID:appId};
 const wallet={id:'wallet',address:f.facts.upload.execution.plan.operator,chain_type:'ethereum',owner_id:'originalowner',additional_signers:[],policy_ids:[]};
 const registered={subject:previous,wallet:wallet.address,walletId:wallet.id,ownerId:wallet.owner_id};let ownerSubject=previous,updates=0,failAfterUpdate=true;const journal=[];
 const client={wallets:()=>({get:async()=>wallet,update:async(walletId,args)=>{updates++;assert.equal(walletId,wallet.id);assert.deepEqual(args.owner,{user_id:target});assert.deepEqual(args.additional_signers,[]);assert.deepEqual(args.authorization_context,{signatures:['S'.repeat(80)]});assert(!('authorization_private_keys' in args.authorization_context));wallet.owner_id='newowner';ownerSubject=target;if(failAfterUpdate){failAfterUpdate=false;throw Error('uncertain provider');}return wallet;}}),users:()=>({getByCustomAuthID:async()=>({id:target,linked_accounts:[{type:'custom_auth',custom_user_id:f.identity.userId}]})}),keyQuorums:()=>({get:async()=>({authorization_threshold:1,authorization_keys:[],user_ids:[ownerSubject],key_quorum_ids:[]})})};
 const readWallet=async()=>({client,registered,revision:2,access:await inspectReviewWallet(client,f.identity,wallet.address,registered,appId)});
 const rpc=async(name,args)=>{if(name!=='service_reward_demo_copy_review_wallet_handover')return f.deps.rpc(name,args);assert.equal(args.p_actor_user_id,f.identity.userId);assert.equal(args.p_reviewer_subject,target);if(args.p_action==='read')return {data:journal.length?{requestId:id(999)}:null,error:null};journal.push(args);return {data:{completed:args.p_action==='confirm'},error:null};};
 const run=c=>reviewWalletHandover(f.identity,f.scope,c,env,rpc,readWallet),view=await run();assert.equal(updates,0);assert.equal(journal.length,0);
 const token=await new SignJWT({sid:'owner-session'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(appId).setSubject(previous).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const command={action:'transfer',requestId:id(999),expectedFingerprint:view.fingerprint,ownerToken:token,authorizationSignature:'S'.repeat(80),requestExpiry:Date.now()+90000};
 await assert.rejects(run({...command,ownerToken:'forged'}),/controller_auth_required/);assert.equal(updates,0);assert.equal(journal.length,0);
 await assert.rejects(run({...command,expectedFingerprint:'a'.repeat(64)}),/review_wallet_handover_conflict/);assert.equal(updates,0);
 await assert.rejects(run({...command,requestExpiry:Date.now()-1}),/review_wallet_handover_conflict/);assert.equal(updates,0);
 await assert.rejects(run(command),/uncertain provider/);assert.equal(updates,1);assert.equal(journal.length,1);
 const recovering=await run();assert.equal(recovering.acknowledgementRequired,true);const recovered=await run({action:'acknowledge',requestId:id(999),expectedFingerprint:recovering.fingerprint});assert.equal(recovered.status,'owned');assert.equal(recovered.ownerSubject,target);assert.equal(updates,1);assert.equal(journal.at(-1).p_action,'confirm');assert.equal(journal.at(-1).p_owner_id,'newowner');
});

test('prepare and refresh never sign; unsigned retry reuses the exact saved reservation',async()=>{
 const f=fixture(),first=await f.prepare(f.command);assert(first.authorization);assert.equal(f.signCount(),0);assert.equal(f.jobs.length,1);
 const read=await f.prepare();assert.equal(read.authorization,null);assert.equal(f.signCount(),0);
 const second=await f.prepare(f.command);assert.equal(second.authorization.transactionId,first.authorization.transactionId);assert.equal(f.jobs.length,1);
 assert.deepEqual(second.authorization.request.body,first.authorization.request.body);
 for(const command of [
  {...f.command,transactionId:id(999),authorizationSignature:'S'.repeat(88),requestExpiry:Date.now()+90000},
  {...f.command,transactionId:first.authorization.transactionId,authorizationSignature:'S'.repeat(88),requestExpiry:Date.now()-1},
 ])await assert.rejects(f.prepare(command),/review_publication_authorization_required/);
 assert.equal(f.signCount(),0);f.revoke();await assert.rejects(f.run(f.command));assert.equal(f.signCount(),0);
});
test('real Privy SDK submits the exact browser-authorized RPC without exchanging a JWT or logging provider details',async()=>{
 const {PrivyClient}=await import('@privy-io/node');const requests=[];
 const client=new PrivyClient({appId:'c'.repeat(25),appSecret:'fictional-test-secret',maxRetries:0,fetch:async(url,init)=>{
  requests.push({url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)});
  return new Response(JSON.stringify({method:'eth_signTransaction',data:{signed_transaction:'0xab',encoding:'hex'}}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const tx={chainId:10143,to:'0x'+'11'.repeat(20),data:'0xab',value:'0',nonce:'0',gas:'120000',gasPrice:'1'},expiry=Date.now()+90000;
 const expected=publicationSigningRequest('c'.repeat(25),'wallet',tx,expiry);
 assert.equal(await signAuthorizedPublication(client,'wallet','c'.repeat(25),tx,'S'.repeat(88),expiry),'0xab');
 assert.equal(requests.length,1);assert.equal(requests[0].url,expected.url);assert.deepEqual(requests[0].body,expected.body);
 assert.equal(requests[0].headers.get('privy-authorization-signature'),'S'.repeat(88));assert.equal(requests[0].headers.get('privy-request-expiry'),String(expiry));
 const failed=new PrivyClient({appId:'c'.repeat(25),appSecret:'fictional-test-secret',maxRetries:0,fetch:async()=>new Response(JSON.stringify({error:'secret provider detail'}),{status:403,headers:{'content-type':'application/json'}})});
 await assert.rejects(signAuthorizedPublication(failed,'wallet','c'.repeat(25),tx,'S'.repeat(88),expiry),/^Error: review_publication_authorization_failed$/);
});
