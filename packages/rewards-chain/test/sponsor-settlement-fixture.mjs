// Owned synthetic original runtime/deposit fixture; no network, keys or chain writes.
import assert from 'node:assert/strict';
import {observeSponsorSettlementV4,sponsorSettlementDataV4,sponsorSettlementAbiV4 as abi} from '../dist/sponsor-settlement-v4.js';
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
function fixture({funded = false, viaFactory = false, executionPlan = plan} = {}) {
  const plan=executionPlan;
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

export {plan,deploymentHash,fundingHash,fixture};

function settlementFixture(executionPlan=plan){const plan=executionPlan,input={plan,slot:0,deploymentHash,fundingHash};let settlementHash=toHex(12n,{size:32});const f=fixture({funded:true,executionPlan:plan}),base={...f.reader},state={stage:3,paused:false,deadline:1799999999n,allocated:40n,paid:10n,unallocatedReturned:0n,expiredReturned:0n};let tx,r;
 f.reader.readContract=async p=>{const v=state;if(p.functionName==='state')return v.stage;if(p.functionName==='paused')return v.paused;if(p.functionName==='claimDeadline')return v.deadline;if(p.functionName==='allocated')return p.args[0]===1n?v.allocated:0n;if(p.functionName==='paid')return p.args[0]===1n?v.paid:0n;if(p.functionName==='entitlementCount')return 2n;if(p.functionName==='unallocatedReturned')return v.unallocatedReturned;if(p.functionName==='expiredReturned')return v.expiredReturned;if(p.functionName==='treasuryReturned')return v.unallocatedReturned+v.expiredReturned;return base.readContract(p);};
 f.reader.getBalance=async()=>100n-state.paid-state.unallocatedReturned-state.expiredReturned;
 f.reader.getTransaction=async p=>p.hash===settlementHash?tx:base.getTransaction(p);f.reader.getTransactionReceipt=async p=>p.hash===settlementHash?r:base.getTransactionReceipt(p);
 async function mined(action,nextHash=settlementHash){settlementHash=nextHash;const before=await observeSponsorSettlementV4(f.reader,input),lane=action==='returnUnallocated'?before.lanes.unallocated:before.lanes.expired;
  const operation=action==='close'?{action,recipient:null,amountWei:'0'}:{action,recipient:lane.recipient,amountWei:lane.remainingWei};
  f.anchor=31n;state.stage=4;if(action==='returnUnallocated')state.unallocatedReturned=BigInt(lane.originalWei);if(action==='returnExpired')state.expiredReturned=BigInt(lane.originalWei);
  tx={chainId:plan.chainId,hash:settlementHash,from:plan.operator,to:before.pot.address,value:0n,input:sponsorSettlementDataV4(action),nonce:1,blockNumber:31n,blockHash:hash(131),transactionIndex:0};
  r={transactionHash:settlementHash,from:tx.from,to:tx.to,contractAddress:null,status:'success',blockNumber:31n,blockHash:hash(131),transactionIndex:0,logs:[{address:tx.to,removed:false,transactionHash:settlementHash,blockNumber:31n,blockHash:hash(131),
   topics:encodeEventTopics({abi,eventName:action==='close'?'Closed':'TreasuryReturned',...(action==='close'?{}:{args:{treasury:operation.recipient}})}),data:action==='close'?'0x':encodeAbiParameters([{type:'uint256'}],[BigInt(operation.amountWei)])}]};
  return{operation,tx,r};
 }
 return{f,state,mined};}

export {settlementFixture};
