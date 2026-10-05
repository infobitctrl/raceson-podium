import test from 'node:test';
import assert from 'node:assert/strict';
import {TransactionNotFoundError, TransactionReceiptNotFoundError, encodeAbiParameters, encodeEventTopics, getContractAddress, hashDomain, keccak256, padHex, stringToHex, toHex} from 'viem';
import {SponsorReceiptError, observeSponsorProgramme, observeSponsorProgrammePot, sponsorContractConfiguration, sponsorDeploymentData, sponsorFundingData, sponsorProgrammeBuild, sponsorCampaignBuild, sponsorProgrammeAbi, sponsorFactoryBuild, sponsorFactoryAbi, sponsorFactoryData, sponsorFactoryProgrammeAddress, sponsorFactorySalt} from '../dist/sponsor-v4.js';

const hash = n => toHex(n, {size:32}), address = n => toHex(n, {size:20});
const deploymentHash = hash(10), fundingHash = hash(11), factory = address(99);
const plan = {version:4, launchId:'73000000-0000-4000-8000-000000000003', setupRevision:1, configurationHash:'a'.repeat(64), chainId:31337,
  funder:address(1), operator:address(2), unallocatedTreasury:address(3), expiredTreasury:address(1), claimLifetime:86400,
  reviewPeriods:[0,0,0,0,0,0], caps:['100','0','0','0','0','0'], budgetWei:'100'};
const word = v => typeof v === 'string' ? padHex(v) : toHex(v, {size:32});
// Extract only a hash-verified runtime template from the committed creation code.
// This synthetic reader uses no generated artifacts, network or chain process.
function template(build) {
  const bytecode = build.bytecode ?? sponsorProgrammeBuild.bytecode;
  for (let i = bytecode.indexOf('608080604052'); i >= 0; i = bytecode.indexOf('608080604052', i + 2)) {
    const value = '0x' + bytecode.slice(i, i + build.runtimeBytes * 2);
    if (keccak256(value) === (build.runtimeTemplateHash ?? build.runtimeHash)) return value;
  }
  throw Error('Pinned runtime template not found');
}
const programmeTemplate = template(sponsorProgrammeBuild), campaignTemplate = template(sponsorCampaignBuild), factoryCode = template(sponsorFactoryBuild);
function code(build, initial, values) {
  let result = initial;
  for (const [name, offsets] of Object.entries(build.offsets)) for (const offset of offsets) {
    const at = 2 + offset * 2;
    assert.equal(values[name].length, 66);
    result = result.slice(0, at) + values[name].slice(2) + result.slice(at + 64);
  }
  return result;
}
function fixture({funded = false, viaFactory = false} = {}) {
  const c = sponsorContractConfiguration(plan);
  const programme = (viaFactory ? sponsorFactoryProgrammeAddress(plan,factory) : getContractAddress({from:plan.operator,nonce:0n})).toLowerCase();
  const child = getContractAddress({from:programme,nonce:1n}).toLowerCase();
  const base = {chainId:plan.chainId, transactionIndex:0, gas:20_000_000n, nonce:0};
  const deployment = {...base, hash:deploymentHash, from:plan.operator, to:viaFactory ? factory : null, value:0n,
    input:viaFactory ? sponsorFactoryData(plan) : sponsorDeploymentData(plan), blockNumber:10n, blockHash:hash(110)};
  const funding = {...base, hash:fundingHash, from:plan.funder, to:programme, value:100n, input:sponsorFundingData(), blockNumber:20n, blockHash:hash(120)};
  const receiptFor = tx => ({transactionHash:tx.hash, from:tx.from, to:tx.to, contractAddress:null, status:'success', blockNumber:tx.blockNumber, blockHash:tx.blockHash, transactionIndex:0, logs:[]});
  const created = {...receiptFor(deployment), contractAddress:viaFactory ? null : programme};
  if (viaFactory) created.logs = [{address:factory, removed:false, data:'0x', topics:encodeEventTopics({abi:sponsorFactoryAbi,eventName:'ProgrammeCreated',args:{configurationHash:sponsorFactorySalt(plan), programme}})}];
  const deposited = receiptFor(funding);
  deposited.logs = [{address:programme, removed:false, transactionHash:fundingHash, blockHash:funding.blockHash, blockNumber:funding.blockNumber,
    data:encodeAbiParameters([{type:'uint256'}],[100n]), topics:encodeEventTopics({abi:sponsorProgrammeAbi,eventName:'ProgrammeFunded',args:{funder:plan.funder}})}];
  const programmeCode = code(sponsorProgrammeBuild, programmeTemplate, {
    funder:word(c.funder), operator:word(c.operator), unallocatedTreasury:word(c.unallocatedTreasury), expiredTreasury:word(c.expiredTreasury),
    programmeId:c.programmeId, programmeManifestHash:c.manifestHash, budget:word(100n), claimLifetime:word(86400n),
  });
  const name = 'RacesOnRewardCampaign', version = '5';
  const short = s => padHex(stringToHex(s),{size:31,dir:'right'}) + toHex(s.length,{size:1}).slice(2);
  const campaignCode = code(sponsorCampaignBuild, campaignTemplate, {
    operator:word(c.operator), treasury:word(c.unallocatedTreasury), expiredTreasury:word(c.expiredTreasury), cancellationTreasury:word(c.funder),
    fundingSource:word(programme), CLAIM_LIFETIME:word(86400n), programmeId:c.programmeId, campaignId:c.campaignIds[0], programmeManifestHash:c.manifestHash,
    enabledPot:word(1), reviewPeriod:word(0), _cachedChainId:word(plan.chainId), _cachedThis:word(child), _hashedName:keccak256(stringToHex(name)),
    _hashedVersion:keccak256(stringToHex(version)), _name:short(name), _version:short(version),
    _cachedDomainSeparator:hashDomain({domain:{name,version,chainId:BigInt(plan.chainId),verifyingContract:child},types:{EIP712Domain:[
      {name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]}}),
  });
  const state = {deployment, funding, created, deposited, anchor:30n};
  state.reader = {
    getChainId:async()=>plan.chainId,
    getBlock:async ({blockNumber})=>({number:blockNumber ?? state.anchor,hash:hash(100n + (blockNumber ?? state.anchor)),timestamp:1800000000n}),
    getTransaction:async ({hash})=>hash === deploymentHash ? state.deployment : state.funding,
    getTransactionReceipt:async ({hash})=>hash === deploymentHash ? state.created : state.deposited,
    getCode:async ({address})=>address.toLowerCase() === factory ? factoryCode : address.toLowerCase() === programme ? programmeCode : campaignCode,
    getBalance:async()=>funded ? 100n : 0n,
    readContract:async ({functionName, args})=>{
      if (functionName === 'funded') return funded;
      if (functionName === 'cancelled' || functionName === 'paused') return false;
      if (functionName === 'caps') return args[0] === 0n ? 100n : 0n;
      if (functionName === 'campaigns') return args[0] === 0n ? child : address(0);
      if (functionName === 'state') return funded ? 1 : 0;
      if (functionName === 'accountedFunding') return funded ? 100n : 0n;
      return 0n;
    },
  };
  return state;
}
const observe = (f, action = 'deployment') => observeSponsorProgramme(f.reader,plan,deploymentHash,action === 'funding' ? fundingHash : undefined);
test('selected-pot observation preserves funding, runtime, cap and canonical-state guards',async()=>{
 const f=fixture({funded:true,viaFactory:true});
 assert.deepEqual(await observeSponsorProgrammePot(f.reader,plan,deploymentHash,fundingHash,0),await observe(f,'funding'));
 for(const slot of [-1,1,6,0.5])await assert.rejects(()=>observeSponsorProgrammePot(f.reader,plan,deploymentHash,fundingHash,slot));
 for(const mutate of [
  f=>{f.deposited.logs=[];},
  f=>{f.reader.getCode=async()=> '0x6000';},
  f=>{const read=f.reader.readContract;f.reader.readContract=async a=>a.functionName==='caps'&&a.args[0]===5n?1n:read(a);},
  f=>{const read=f.reader.readContract;f.reader.readContract=async a=>a.functionName==='paid'?101n:read(a);},
  f=>{const read=f.reader.getBlock;f.reader.getBlock=async a=>a.blockNumber===30n?{number:30n,hash:hash(999)}:read(a);},
 ]){const changed=fixture({funded:true,viaFactory:true});mutate(changed);await assert.rejects(()=>observeSponsorProgrammePot(changed.reader,plan,deploymentHash,fundingHash,0));}
});
const typed = (code, expectedHash) => e => e instanceof SponsorReceiptError && e.code === code && e.transactionHash === expectedHash;
const invalid = e => !(e instanceof SponsorReceiptError) && e.message === 'sponsor_chain_verification_failed';
function actionObjects(f, action) {return action === 'deployment' ? [f.deployment,f.created,deploymentHash] : [f.funding,f.deposited,fundingHash];}

for (const viaFactory of [false,true]) test(`successful ${viaFactory ? 'factory' : 'direct'} creation and funding retain exact observations`, async()=>{
  const unfunded = await observe(fixture({viaFactory}));
  assert.equal(unfunded.funded,false); assert.equal(unfunded.fundingHash,null); assert.equal(unfunded.pots[0].remainingWei,'0');
  const funded = await observe(fixture({funded:true,viaFactory}),'funding');
  assert.equal(funded.funded,true); assert.equal(funded.fundingHash,fundingHash); assert.equal(funded.pots[0].remainingWei,'100');
});

for (const action of ['deployment','funding']) {
  for (const method of ['getTransaction','getTransactionReceipt']) test(`${action}: typed missing ${method} is pending; provider and lookalike failures are unchanged`, async()=>{
    const f = fixture(), [,,wanted] = actionObjects(f,action), original = f.reader[method];
    const missing = method === 'getTransaction' ? new TransactionNotFoundError({hash:wanted}) : new TransactionReceiptNotFoundError({hash:wanted});
    f.reader[method] = async args => {if(args.hash === wanted) throw missing; return original(args);};
    await assert.rejects(observe(f,action),typed('sponsor_receipt_pending',wanted));
    for (const error of [new Error('RPC timeout'),Object.assign(new Error('could not be found'),{name:missing.name})]) {
      f.reader[method] = async args => {if(args.hash === wanted) throw error; return original(args);};
      await assert.rejects(observe(f,action),e=>e === error);
    }
  });
  for (const status of ['success','reverted']) test(`${action}: matching unfinalized ${status} receipt stays pending`, async()=>{
    const f = fixture(), [tx,receipt,wanted] = actionObjects(f,action);
    tx.blockNumber = receipt.blockNumber = 40n; tx.blockHash = receipt.blockHash = hash(140); receipt.status = status;
    if (status === 'reverted') receipt.contractAddress = null;
    await assert.rejects(observe(f,action),typed('sponsor_receipt_pending',wanted));
  });
  test(`${action}: canonical finalized revert is terminal without success logs`, async()=>{
    const f = fixture(), [,receipt,wanted] = actionObjects(f,action);
    receipt.status = 'reverted'; receipt.contractAddress = null; receipt.logs = [];
    await assert.rejects(observe(f,action),typed('sponsor_receipt_reverted',wanted));
  });
  for (const patch of [
    (tx,r)=>tx.hash=hash(999), (tx,r)=>r.transactionHash=hash(999), (tx,r)=>tx.chainId=1,
    (tx,r)=>tx.value=999n, (tx,r)=>tx.input='0x', (tx,r)=>r.from=address(77),
    (tx,r)=>r.to=address(77), (tx,r)=>r.transactionIndex=2,
    (tx,r)=>tx.blockHash=r.blockHash=hash(999),
  ]) test(`${action}: mismatched or noncanonical revert never gets a receipt classification (${patch})`, async()=>{
    const f = fixture(), [tx,receipt] = actionObjects(f,action);
    receipt.status = 'reverted'; receipt.contractAddress = null; patch(tx,receipt);
    await assert.rejects(observe(f,action),invalid);
  });
  test(`${action}: known invalid transaction is not pending even when receipt is missing`, async()=>{
    for (const patch of [tx=>tx.input='0x', tx=>tx.chainId=1, tx=>tx.blockHash=hash(999)]) {
      const f = fixture(), [tx,,wanted] = actionObjects(f,action), original=f.reader.getTransactionReceipt;
      patch(tx); f.reader.getTransactionReceipt=async args=>{if(args.hash===wanted)throw new TransactionReceiptNotFoundError({hash:wanted});return original(args);};
      await assert.rejects(observe(f,action),invalid);
    }
  });
  test(`${action}: changing finalized anchor suppresses missing and reverted classifications`, async()=>{
    for (const missing of [false,true]) {
      const f=fixture(), [,receipt,wanted]=actionObjects(f,action), original=f.reader.getBlock;
      receipt.status='reverted';receipt.contractAddress=null;
      f.reader.getBlock=async args=>args.blockNumber===f.anchor?{number:f.anchor,hash:hash(999)}:original(args);
      if(missing){const get=f.reader.getTransaction;f.reader.getTransaction=async args=>{if(args.hash===wanted)throw new TransactionNotFoundError({hash:wanted});return get(args);};}
      await assert.rejects(observe(f,action),invalid);
    }
  });
}
test('factory revert verifies expected factory runtime and constructor payload before classification',async()=>{
  const f=fixture({viaFactory:true});f.created.status='reverted';f.created.logs=[];
  await assert.rejects(observe(f),typed('sponsor_receipt_reverted',deploymentHash));
  const get=f.reader.getCode;f.reader.getCode=async args=>args.address.toLowerCase()===factory?'0x6000':get(args);
  await assert.rejects(observe(f),invalid);
});
test('wrong reader chain does not become pending even if every lookup reports missing',async()=>{
  const f=fixture();f.reader.getChainId=async()=>1;f.reader.getTransaction=async()=>{throw new TransactionNotFoundError({hash:deploymentHash});};
  await assert.rejects(observe(f),invalid);
});
test('success still rejects corrupt runtime and incorrect deposit logs',async()=>{
  const f=fixture();f.reader.getCode=async()=> '0x6000';await assert.rejects(observe(f),invalid);
  const g=fixture({funded:true});g.deposited.logs=[];await assert.rejects(observe(g,'funding'),invalid);
});
test('funding revert requires the saved funder and exact programme destination',async()=>{
  for(const patch of [tx=>tx.from=address(77),tx=>tx.to=address(77)]){
    const f=fixture();f.deposited.status='reverted';patch(f.funding);
    await assert.rejects(observe(f,'funding'),invalid);
  }
});
test('reorganization during classification is unavailable, not finalized revert or pending',async()=>{
  for(const status of ['success','reverted']){
    const f=fixture();f.created.status=status;if(status==='reverted')f.created.contractAddress=null;
    f.deployment.blockNumber=f.created.blockNumber=40n;f.deployment.blockHash=f.created.blockHash=hash(140);
    const get=f.reader.getBlock;let reads=0;
    f.reader.getBlock=async args=>args.blockNumber===40n&&++reads===3?{number:40n,hash:hash(999)}:get(args);
    await assert.rejects(observe(f),invalid);
  }
});
test('chain change during a missing-receipt lookup suppresses pending classification',async()=>{
  const f=fixture();let reads=0;f.reader.getChainId=async()=>++reads===1?plan.chainId:1;
  f.reader.getTransactionReceipt=async()=>{throw new TransactionReceiptNotFoundError({hash:deploymentHash});};
  await assert.rejects(observe(f),invalid);
});

test('selected-pot latency measurement with a fixed 25ms per RPC',async()=>{
 const f=fixture({funded:true,viaFactory:true});let calls=0,active=0,peak=0;
 const reader=Object.fromEntries(Object.entries(f.reader).map(([name,read])=>[name,async(...args)=>{
  calls++;active++;peak=Math.max(peak,active);
  try{await new Promise(r=>setTimeout(r,25));return await read(...args);}finally{active--;}
 }]));
 const start=performance.now();
 const result=await observeSponsorProgrammePot(reader,plan,deploymentHash,fundingHash,0);
 assert.equal(result.funded,true);assert.equal(result.pots[0].remainingWei,'100');
 assert.equal(calls,44,'all provenance, runtime, funding and canonical-block reads remain');
 assert.ok(peak>=12,'independent pinned reads must overlap instead of adding round-trip latency');
 console.log(JSON.stringify({measurement:'synthetic25ms',calls,peak,elapsedMs:Math.round(performance.now()-start)}));
});
