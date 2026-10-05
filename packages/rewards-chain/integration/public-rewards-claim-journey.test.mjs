import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createPublicClient,http} from 'viem';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorDeploymentData,sponsorFundingData,observeSponsorProgramme,observeSponsorProgrammePot} from '../dist/sponsor-v4.js';
import {sponsorClaimMessagesV4} from '../dist/sponsor-claims-v4.js';
import {controllerReadBatch} from '../dist/canary-public-client.js';
import {rewardUploadDigest} from '../dist/index.js';
import {publicAwardPage} from '../../../apps/api/dist/features/rewards/public-awards-service.js';

// Synthetic athlete identities, synthetic source evidence and locally provisioned
// EOAs stand in for Privy-created wallets. No Privy API, retained DB or testnet IO.
test('two fresh simulated athlete wallets claim all 12 awards and public rows turn claimed',{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain();
 try{
  const sponsor=fixtureSigner(0xd300),athletes=[fixtureSigner(0xd301),fixtureSigner(0xd302)],h=n=>'0x'+n.toString(16).padStart(64,'0');
  for(const athlete of athletes)assert.equal(await chain.publicClient.getBalance({address:athlete.address}),0n);
  await chain.testClient.setBalance({address:sponsor.address,value:2n*10n**18n});
  const caps=['30000000000000000',...Array(5).fill('6000000000000000')];
  const plan={version:4,launchId:'73000000-0000-4000-8000-000000000095',setupRevision:1,configurationHash:'d'.repeat(64),chainId:31337,
   funder:sponsor.address.toLowerCase(),operator:chain.operator.address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:sponsor.address.toLowerCase(),claimLifetime:7*86400,reviewPeriods:[0,0,0,0,0,0],caps,budgetWei:'60000000000000000'};
  const abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
  const receipt=async(hash,success=true)=>{const r=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,success?'success':'reverted');return r;};
  const deployment=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(plan),gas:25_000_000n}),created=await receipt(deployment);
  const funding=await chain.operatorClient.sendTransaction({account:sponsor,to:created.contractAddress,data:sponsorFundingData(),value:BigInt(plan.budgetWei),gas:2_000_000n});await receipt(funding);
  await chain.testClient.mine({blocks:96,interval:1});
  const funded=await observeSponsorProgramme(chain.publicClient,plan,deployment,funding);
  // Exercise the same deployless batched read mechanism selected for public pages.
  const endpoint=chain.publicClient.transport.url;assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
  const batched=createPublicClient({chain:chain.publicClient.chain,cacheTime:0,batch:controllerReadBatch,transport:http(endpoint,{retryCount:0})});
  const evidence={environment:'disposable-local-chain',chainId:31337,privy:'SDK creation mocked separately; locally provisioned fresh EOAs here',sportingSource:'synthetic test fixture',testnetTransactionsSent:0,programme:funded.address,depositWei:plan.budgetWei,wallets:athletes.map(a=>({address:a.address,initialBalanceWei:'0'})),pots:[]};
  const write=(child,name,args,success=true)=>chain.operatorClient.writeContract({address:child,abi,functionName:name,args,gas:2_000_000n}).then(hash=>receipt(hash,success));
  for(const pot of funded.pots){
   const slot=pot.slot,child=pot.address,amount=BigInt(pot.amountWei)/2n;
   const awards=athletes.map((a,i)=>({entitlementId:h(i+1),beneficiaryId:h(i+11),explanationHash:h(i+21),pot:slot===0?1:0,beneficiaryKind:0,amount}));
   const upload=rewardUploadDigest(awards,slot===0?1:0,BigInt(pot.amountWei));
   await write(child,'uploadAwards',[awards]);
   const now=(await chain.publicClient.getBlock()).timestamp,snapshot=h(100+slot);
   await write(child,'stageAllocation',[snapshot,upload.digest,2n,now,now,h(200+slot)]);
   const digest=await chain.publicClient.readContract({address:child,abi,functionName:'allocationDigest'});
   await write(child,'activate',[digest,snapshot]);await chain.testClient.mine({blocks:96,interval:1});
   const raw={chainId:31337,slot,programmeAddress:funded.address,campaignAddress:child,fundingHash:funding,uploadDigest:upload.digest,awards:awards.map(a=>({...a,amount:a.amount.toString()}))};
   const scope={id:plan.launchId,chainId:31337,slot},query={offset:0,sort:'reward',direction:'asc'};
   let observed=await observeSponsorProgrammePot(batched,plan,deployment,funding,slot);
   const before=await publicAwardPage(batched,observed,scope,raw,query);assert.ok(before.rows.every(r=>r.status==='unclaimed'));
   const paid=[];
   for(let i=0;i<2;i++){
    const athlete=athletes[i],issuedAt=(await chain.publicClient.getBlock()).timestamp,expiresAt=issuedAt+86400n;
    const claim={entitlementId:awards[i].entitlementId,recipient:athlete.address,amount,pot:slot===0?'league':'race',nonce:0n,issuedAt,expiresAt,allocationDigest:digest};
    const messages=sponsorClaimMessagesV4({environment:'local-simulation',chainId:31337,verifyingContract:child},claim);
    const approval=await chain.operator.signTypedData(messages.authorization),consent=await athlete.signTypedData(messages.consent);
    const args=[claim.entitlementId,claim.recipient,0n,issuedAt,expiresAt,approval,consent];
    await write(child,'claim',[...args.slice(0,6),'0x'],false);
    const balance=await chain.publicClient.getBalance({address:athlete.address});
    const r=await write(child,'claim',args);
    assert.equal(await chain.publicClient.getBalance({address:athlete.address}),balance+amount);
    await write(child,'claim',args,false);
    paid.push({reward:claim.entitlementId,recipient:athlete.address,amountWei:amount.toString(),transactionHash:r.transactionHash,blockNumber:r.blockNumber.toString(),status:r.status});
   }
   await chain.testClient.mine({blocks:96,interval:1});observed=await observeSponsorProgrammePot(batched,plan,deployment,funding,slot);
   const after=await publicAwardPage(batched,observed,scope,raw,query);assert.ok(after.rows.every(r=>r.status==='claimed'));
   assert.equal(observed.pots[0].remainingWei,'0');assert.equal(observed.pots[0].paidWei,pot.amountWei);
   evidence.pots.push({slot,before:before.rows.map(r=>r.status),after:after.rows.map(r=>r.status),payments:paid});
  }
  const final=await observeSponsorProgramme(batched,plan,deployment,funding);
  assert.equal(final.pots.reduce((n,p)=>n+BigInt(p.paidWei),0n),BigInt(plan.budgetWei));
  assert.ok(final.pots.every(p=>p.remainingWei==='0'&&p.returnedWei==='0'));
  for(const wallet of evidence.wallets){wallet.finalBalanceWei=(await chain.publicClient.getBalance({address:wallet.address})).toString();assert.equal(wallet.finalBalanceWei,'30000000000000000');}
  evidence.paidWei=plan.budgetWei;evidence.completedAt=new Date().toISOString();
  if(process.env.PODIUM_CLAIM_SIMULATION_REPORT==='1')writeFileSync(new URL('../../../docs/delivery/rewards/public-awards-20260930/CLAIM-SIMULATION.json',import.meta.url),JSON.stringify(evidence,null,2));
 }finally{await chain.stop();}
});
