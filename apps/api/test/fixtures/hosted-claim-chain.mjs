import assert from 'node:assert/strict';
import {toHex,padHex,keccak256,stringToHex,hashDomain,getContractAddress,encodeAbiParameters,encodeEventTopics,parseTransaction} from 'viem';
import {sponsorProgrammeBuild,sponsorCampaignBuild,sponsorContractConfiguration,sponsorDeploymentData,sponsorFundingData,sponsorProgrammeAbi} from '../../../../packages/rewards-chain/dist/sponsor-v4.js';
import {sponsorLifecycleCommitmentV4} from '../../../../packages/rewards-chain/dist/sponsor-lifecycle-v4.js';
const h=n=>toHex(BigInt(n),{size:32}),word=v=>typeof v==='string'?padHex(v):h(v);
// Synthetic canonical chain reader; runtime templates are hash-verified against
// committed builds. This fixture performs no network or on-chain writes.
function template(build){const bytecode=build.bytecode??sponsorProgrammeBuild.bytecode;for(let i=bytecode.indexOf('608080604052');i>=0;i=bytecode.indexOf('608080604052',i+2)){const code='0x'+bytecode.slice(i,i+build.runtimeBytes*2);if(keccak256(code)===build.runtimeTemplateHash)return code;}throw Error('Pinned runtime template missing');}
function runtime(build,values){let result=template(build);for(const[name,offsets]of Object.entries(build.offsets))for(const offset of offsets){const at=2+offset*2;assert.equal(values[name].length,66);result=result.slice(0,at)+values[name].slice(2)+result.slice(at+64);}return result;}
export function hostedClaimChain(f,{paymentBlock=31n}={}){
 const plan=f.plan,c=sponsorContractConfiguration(plan),programme=getContractAddress({from:plan.operator,nonce:0n}).toLowerCase(),campaign=f.package.campaignAddress;
 const publication=f.publication.timing,award={...f.package.awards[0],amount:BigInt(f.package.awards[0].amount)},allocation=sponsorLifecycleCommitmentV4({plan,slot:0,...f.package,awards:[award],publication});
 const short=s=>padHex(stringToHex(s),{size:31,dir:'right'})+toHex(s.length,{size:1}).slice(2),name='RacesOnRewardCampaign',version='5';
 const programmeCode=runtime(sponsorProgrammeBuild,{funder:word(c.funder),operator:word(c.operator),unallocatedTreasury:word(c.unallocatedTreasury),expiredTreasury:word(c.expiredTreasury),programmeId:c.programmeId,programmeManifestHash:c.manifestHash,budget:word(c.budget),claimLifetime:word(c.claimLifetime)});
 const campaignCode=runtime(sponsorCampaignBuild,{operator:word(c.operator),treasury:word(c.unallocatedTreasury),expiredTreasury:word(c.expiredTreasury),cancellationTreasury:word(c.funder),fundingSource:word(programme),CLAIM_LIFETIME:word(c.claimLifetime),programmeId:c.programmeId,campaignId:c.campaignIds[0],programmeManifestHash:c.manifestHash,enabledPot:word(1n),reviewPeriod:word(0n),_cachedChainId:word(10143n),_cachedThis:word(campaign),_hashedName:keccak256(stringToHex(name)),_hashedVersion:keccak256(stringToHex(version)),_name:short(name),_version:short(version),_cachedDomainSeparator:hashDomain({domain:{name,version,chainId:10143n,verifyingContract:campaign},types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]}})});
 const tx=(hash,block,from,to,input,value)=>({chainId:10143,hash,blockNumber:block,blockHash:h(100n+block),transactionIndex:0,gas:20_000_000n,nonce:0,from,to,input,value});
 const deployment=tx(f.package.deploymentHash,10n,plan.operator,null,sponsorDeploymentData(plan),0n),funding=tx(f.package.fundingHash,20n,plan.funder,programme,sponsorFundingData(),101n);
 const receipt=t=>({transactionHash:t.hash,from:t.from,to:t.to,status:'success',blockNumber:t.blockNumber,blockHash:t.blockHash,transactionIndex:0,contractAddress:null,logs:[]});
 const created={...receipt(deployment),contractAddress:programme},deposited={...receipt(funding),logs:[{address:programme,removed:false,transactionHash:funding.hash,blockHash:funding.blockHash,blockNumber:20n,data:encodeAbiParameters([{type:'uint256'}],[101n]),topics:encodeEventTopics({abi:sponsorProgrammeAbi,eventName:'ProgrammeFunded',args:{funder:plan.funder}})}]};
 const state={sent:[],payment:null,paid:false,anchor:30n};
 state.reader={getChainId:async()=>10143,getBlock:async({blockNumber})=>{const n=blockNumber??state.anchor;return{number:n,hash:h(100n+n),timestamp:150n+(n>30n?1n:0n)};},
  getTransaction:async({hash})=>hash===deployment.hash?deployment:hash===funding.hash?funding:state.payment,
  getTransactionReceipt:async({hash})=>{if(hash===deployment.hash)return created;if(hash===funding.hash)return deposited;if(state.payment?.hash===hash)return receipt(state.payment);throw Error('Receipt not yet observed');},
  getCode:async({address})=>address.toLowerCase()===programme?programmeCode:address.toLowerCase()===campaign?campaignCode:'0x',
  getBalance:async({address})=>address===plan.operator?10n**18n:state.paid?0n:101n,estimateGas:async()=>200000n,getGasPrice:async()=>100000000000n,getTransactionCount:async()=>10,
  readContract:async({functionName,args})=>{
   if(functionName==='funded')return true;if(['cancelled','paused'].includes(functionName))return false;
   if(functionName==='caps')return args[0]===0n?101n:0n;if(functionName==='campaigns')return args[0]===0n?campaign:'0x'+'0'.repeat(40);
   if(functionName==='state')return 3;if(functionName==='accountedFunding')return 101n;if(functionName==='claimDeadline')return 1000n;if(functionName==='entitlementCount')return 1n;
   if(functionName==='allocated')return args[0]===1n?101n:0n;if(functionName==='paid')return state.paid&&args[0]===1n?101n:0n;if(functionName==='treasuryReturned')return 0n;
   if(functionName==='entitlements')return[award.beneficiaryId,101n,award.explanationHash,state.paid?1n:0n,state.paid?(f.destination?.address??f.nomination.candidate.safeAddress):'0x'+'0'.repeat(40),1,state.paid,award.beneficiaryKind];
   if(functionName==='allocationDigest')return allocation.allocationDigest;if(functionName==='snapshotDigest')return allocation.snapshotDigest;if(functionName==='uploadDigest')return allocation.uploadDigest;
   if(functionName==='reviewStartedAt'||functionName==='officialPublishedAt')return 100n;if(functionName==='publicationEvidenceHash')return publication.publicationEvidenceHash;throw Error('Unexpected synthetic contract read');
  },sendRawTransaction:async({serializedTransaction})=>{state.sent.push(serializedTransaction);const p=parseTransaction(serializedTransaction);state.payment={...tx(keccak256(serializedTransaction),paymentBlock,plan.operator,p.to,p.data,p.value??0n),nonce:p.nonce};state.paid=true;state.anchor=paymentBlock;throw Error('Synthetic lost broadcast acknowledgement');},
 };return state;
}
