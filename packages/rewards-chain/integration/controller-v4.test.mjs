import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorAllocationFixture,sponsorFixtureId as id} from '../../../apps/api/test/fixtures/sponsor-allocation.mjs';
import {decodeRewardAllocationSourceV3} from '@raceson/domain/rewards/allocation-preview-v3';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {sponsorAllocationDocumentHashV4 as digest,copyRewardLedgerDocument as copy} from '@raceson/db/rewards';
import {composeSponsorUploadV4} from '../../../apps/api/dist/features/rewards/sponsor-upload-v4-service.js';
import {dispatchRewardController} from '../../../apps/api/dist/routes/rewards/controller.js';
import {sponsorDeploymentData,sponsorFundingData} from '../dist/sponsor-v4.js';
const h=n=>'0x'+n.toString(16).padStart(64,'0');
test('Privy-only controller deploys and publishes a source-bound allocation on a disposable Monad-mode chain',{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain({chainId:10143});
 try{
  const f=sponsorAllocationFixture(),funder=fixtureSigner(0x987);
  f.plan.chainId=10143;f.launch.setup.chainId=10143;f.plan.operator=chain.operator.address.toLowerCase();f.plan.funder=funder.address.toLowerCase();
  f.source=decodeRewardAllocationSourceV3(f.source);
  await chain.testClient.setBalance({address:funder.address,value:10n**20n});
  const pair=await generateKeyPair('ES256'),config={appId:'cmtx921we00fu0cifaab7exez',verificationKey:await exportSPKI(pair.publicKey),subject:'did:privy:syntheticcontroller',wallet:f.plan.operator};
  const token=await new SignJWT({sid:'synthetic-session'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(config.appId).setSubject(config.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
  let record={plan:f.plan,deploymentHash:null,fundingHash:null},raw,body,response,held=false,writes=0,displayReads=0,staleDisplay=false;
  const deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),controllerPolicy:()=>config,requireToken:async()=>token,reader:chain.publicClient,
   requireIdentity:()=>{throw Error('Supabase account must not be requested');},readJsonBody:async()=>body,applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code},
   rpc:async(name,args)=>{
    assert.equal(args.p_operator,f.plan.operator);assert.equal(args.p_subject,config.subject);assert.equal(args.p_chain_id,10143);assert.equal(args.p_setup_id,f.launch.setup.id);assert.ok(!('p_actor_user_id' in args));
    if(held)return{data:null,error:{message:'controller_source_not_ready'}};
    if(name==='service_reward_controller_result_display'){
     assert.equal(args.p_approval_id,raw.upload.approvalId);assert.ok(!('p_receipt' in args));displayReads++;
     return{data:{documentHash:staleDisplay?'0'.repeat(64):raw.upload.documentHash,snapshot:null},error:null};
    }
    assert.equal(name,'service_reward_controller_v4');
    if(args.p_receipt){writes++;if(args.p_receipt.action==='deployment')record={...record,deploymentHash:args.p_receipt.transactionHash};else raw.receipts.push({id:args.p_request_id,body:args.p_receipt});}
    return{data:args.p_approval_id?copy(raw):record,error:null};
   }};
  const request=async(approval,change)=>{body=change;await dispatchRewardController({method:change?'POST':'GET',headers:{}},{setHeader(){}},new URL(`http://127.0.0.1:3102/api/v1/rewards/control/campaigns/${f.launch.setup.id}${approval?`/allocations/${approval}`:''}`),deps);return response;};
  const deploy=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(f.plan),gas:25000000n});
  const deployed=await chain.publicClient.waitForTransactionReceipt({hash:deploy});assert.equal(deployed.status,'success');await chain.testClient.mine({blocks:96,interval:1});
  assert.equal((await request(null,{requestId:id(890),transactionHash:deploy,operation:'deployment',start:0,end:0})).status,200);
  assert.equal(record.deploymentHash,deploy);assert.equal(writes,1);
  const funding=await chain.operatorClient.sendTransaction({account:funder,to:deployed.contractAddress,data:sponsorFundingData(),value:BigInt(f.plan.budgetWei),gas:2000000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:funding})).status,'success');await chain.testClient.mine({blocks:96,interval:1});record.fundingHash=funding;
  const slot=1,calculation=previewSponsorAllocation(f.launch,f.plan,f.binding,f.source).pots[slot];
  const document={schema:'raceson-sponsor-allocation-document-v4',...f,slot,contextHash:'c'.repeat(64),calculation};
  const upload={document,documentHash:digest(document),contextHash:document.contextHash,approvalId:id(900),current:true,execution:record,snapshotSalt:h(100),prepared:null,
   recipients:calculation.recipients.map((r,i)=>{const {groupIds,...rest}=r;return{...rest,entitlementId:h(200+i),opaqueBeneficiaryId:h(300+i),explanationSalt:h(400+i)};})};
  const package_=composeSponsorUploadV4(upload,deployed.contractAddress);
  upload.prepared={id:id(901),packageHash:digest(package_),package:package_,preparedAt:'2026-09-23T08:00:00.000Z',actorUserId:id(902)};
  const evidence={schema:'synthetic-local-controller-test',officialResultsHash:h(99)};
  const publication={schema:'raceson-sponsor-publication-v4',approvalId:upload.approvalId,contextHash:upload.contextHash,packageHash:upload.prepared.packageHash,evidence,
   timing:{reviewPeriod:'0',reviewStartedAt:'1790100000',officialPublishedAt:'1790100000',publicationEvidenceHash:`0x${digest(evidence)}`}};
  raw={upload,publication:{id:id(903),body:publication,bodyHash:digest(publication),current:true,createdAt:'2026-09-23T08:00:00.000Z'},receipts:[]};
  let index=910;
  for(const action of ['upload','stage','activate']){
   const result=await request(upload.approvalId);assert.equal(result.status,200,JSON.stringify(result));const tx=result.data.transaction;assert.equal(tx.action,action);assert.equal(tx.from,f.plan.operator);assert.equal(tx.value,'0');
   for(const recipient of upload.recipients)assert.ok(!JSON.stringify(tx).includes(recipient.beneficiaryId),'Private beneficiary IDs stay out of every unsigned chain instruction');
   staleDisplay=true;const writesBeforeStale=writes;assert.equal((await request(upload.approvalId)).status,409);assert.equal(writes,writesBeforeStale);staleDisplay=false;
   held=true;assert.equal((await request(upload.approvalId)).status,409);held=false;
   const hash=await chain.operatorClient.sendTransaction({to:tx.to,data:tx.data,gas:2000000n});assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');await chain.testClient.mine({blocks:96,interval:1});
   const before=writes;assert.notEqual((await request(upload.approvalId,{requestId:id(index++),transactionHash:deploy,operation:action,start:tx.start,end:tx.end})).status,200);assert.equal(writes,before);
   assert.equal((await request(upload.approvalId,{requestId:id(index++),transactionHash:hash,operation:action,start:tx.start,end:tx.end})).status,200,JSON.stringify(response));
  }
  assert.equal(response.data.pot.state,3);assert.equal(response.data.transaction,null);assert.equal(response.data.pot.paidWei,'0');assert.equal(response.data.receipts.length,3);
  // The authenticated controller now receives a separate sporting review
  // projection. It is not a public response or the raw private upload ledger.
  // Chain instructions/receipts still contain only opaque recipient identities.
  assert.ok(displayReads>0);assert.ok(!('upload' in response.data));
  for(const recipient of upload.recipients)assert.ok(!JSON.stringify({transaction:response.data.transaction,receipts:response.data.receipts,pot:response.data.pot}).includes(recipient.beneficiaryId),'Private beneficiary IDs stay out of chain instructions and receipts');
  assert.equal(response.data.review.results.allocatedWei,calculation.proposedWei.toString());
  assert.equal(response.data.review.allocatedWei,calculation.proposedWei.toString());assert.equal(response.data.review.retainedWei,calculation.retainedWei.toString());
  const original=raw.upload.document.calculation.proposedWei;raw.upload.document.calculation.proposedWei=original+1n;
  assert.notEqual((await request(upload.approvalId)).status,200);raw.upload.document.calculation.proposedWei=original;
 }finally{await chain.stop();}
});
