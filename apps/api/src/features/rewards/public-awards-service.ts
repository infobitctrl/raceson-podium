import {parseAbi,type Address,type Hex} from 'viem';
import {rewardUploadDigest} from '@raceson/rewards-chain';
import {walletRegistryAbiV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import {walletRegistryAbiV2} from '@raceson/rewards-chain/club-signatures-v6';
import {sponsorAddress} from '@raceson/domain/rewards/sponsor-execution';
import {decodePublicRewardPage,decodePublicRewardDisplay,PUBLIC_REWARD_PAGE_SIZE,type PublicRewardPage,type PublicRewardBreakdown,type PublicRewardDisplay} from '@raceson/domain/rewards/public-campaign';
import type {SponsorChainReader,SponsorChainObservation} from '@raceson/rewards-chain/sponsor-v4';
const abi=parseAbi([
 'function uploadDigest() view returns(bytes32)',
 'function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)',
]);
function check(v:unknown):asserts v {if(!v)throw Error('public_awards_unavailable');}
export type PublicAwardQuery={offset:number;sort:'reward'|'amount';direction:'asc'|'desc';blockNumber?:string;limit?:25|100|500};
export function publicAwardQuery(params:URLSearchParams):PublicAwardQuery {
 if([...params.keys()].some(k=>!['offset','sort','direction','blockNumber','limit'].includes(k)||params.getAll(k).length!==1))throw Error('invalid_public_awards');
 const limit=params.get('limit');
 if(limit!==null&&!['25','100','500'].includes(limit))throw Error('invalid_public_awards');
 const blockNumber=params.get('blockNumber');
 if(blockNumber!==null&&!/^(0|[1-9][0-9]{0,77})$/.test(blockNumber))throw Error('invalid_public_awards');
 const offset=params.get('offset')??'0',sort=params.get('sort')??'reward',direction=params.get('direction')??'asc';
 if(!/^(0|[1-9][0-9]{0,4})$/.test(offset)||Number(offset)>10000||Number(offset)%PUBLIC_REWARD_PAGE_SIZE!==0||!['reward','amount'].includes(sort)||!['asc','desc'].includes(direction))throw Error('invalid_public_awards');
 return {offset:Number(offset),sort:sort as 'reward'|'amount',direction:direction as 'asc'|'desc',...(blockNumber===null?{}:{blockNumber}),...(limit===null?{}:{limit:Number(limit) as 25|100|500})};
}
/** No additional wallet authority: reads bounded rows at one finalized block.
 * An absent/mismatched chain record never becomes a claimed/unclaimed assertion. */
export async function publicAwardPage(reader:SponsorChainReader,observed:SponsorChainObservation,
 scope:{id:string;chainId:10143|31337;slot:number;groups?:{name:string;amountWei:string}[];walletRegistry?:{address:string;version:5|6}},raw:unknown,query:PublicAwardQuery):Promise<PublicRewardPage> {
 const size=query.limit??PUBLIC_REWARD_PAGE_SIZE;
 check(size===25||size===100||size===500);
 const pot=observed.pots.find(p=>p.slot===scope.slot);
 check(observed.funded&&!observed.cancelled&&pot&&(query.blockNumber===undefined||query.blockNumber===observed.blockNumber));
 const base={campaignId:scope.id,slot:scope.slot,chainId:scope.chainId,blockNumber:observed.blockNumber,blockTimestamp:observed.blockTimestamp,offset:query.offset,sort:query.sort,direction:query.direction};
 if(raw===null){check(pot.entitlementCount==='0'&&pot.allocatedWei==='0');return decodePublicRewardPage({...base,total:0,availability:'awaiting_approval',rows:[]},size);}
 const p=raw as {chainId:number;slot:number;programmeAddress:string;campaignAddress:string;fundingHash:string;uploadDigest:Hex;awards:{entitlementId:Hex;beneficiaryId:Hex;explanationHash:Hex;amount:string;pot:0|1;beneficiaryKind:0|1;breakdown?:PublicRewardBreakdown[];display?:PublicRewardDisplay}[]};
 check(p && p.chainId===scope.chainId && p.slot===scope.slot && p.programmeAddress===observed.address && p.campaignAddress===pot.address && p.fundingHash===observed.fundingHash && Array.isArray(p.awards) && p.awards.length<=10000);
 const commitment=rewardUploadDigest(p.awards.map(r=>({...r,amount:BigInt(r.amount)})),scope.slot===0?1:0,BigInt(pot.amountWei));
 check(commitment.digest===p.uploadDigest);
 // Only an exact saved category may label a public award; never infer categories
 // from recipient order, amount or a private sporting identity.
 const categoryTotals=new Map<string,bigint>();
 for(const award of p.awards)if(award.display!==undefined){
  decodePublicRewardDisplay(award.display);
  check(award.beneficiaryKind===0 || award.display.club===null&&award.display.timeMs===null);
 }
 for(const award of p.awards)if(award.breakdown!==undefined){
  check(Array.isArray(award.breakdown)&&award.breakdown.length>0&&award.breakdown.length<=300);
  for(const b of award.breakdown){
   check(b&&Object.keys(b).sort().join()==='amountWei,category,place'&&typeof b.category==='string'
    &&typeof b.amountWei==='string'&&/^[1-9][0-9]{0,77}$/.test(b.amountWei)
    &&(b.place===null||Number.isSafeInteger(b.place)&&b.place>0));
   const group=scope.groups?.filter(g=>g.name===b.category);check(group?.length===1);
   const total=(categoryTotals.get(b.category)??0n)+BigInt(b.amountWei);check(total<=BigInt(group[0]!.amountWei));categoryTotals.set(b.category,total);
  }
  check(new Set(award.breakdown.map(b=>b.category)).size===award.breakdown.length
   &&award.breakdown.reduce((sum,b)=>sum+BigInt(b.amountWei),0n)===BigInt(award.amount));
 }
 const args={address:pot.address as Address,abi,blockNumber:BigInt(observed.blockNumber)};
 // The route supplies the registry from the same execution plan whose registry
 // bytecode and campaign immutables the public pot observer already verified.
 const registry=scope.walletRegistry;
 if(registry)check(sponsorAddress(registry.address)&&(registry.version===5||registry.version===6));
 const registrations=new Map<string,Promise<string|undefined>>();
 const registeredRecipient=(beneficiaryId:Hex,kind:0|1)=>{
  const key=`${beneficiaryId}:${kind}`;
  let pending=registrations.get(key);
  if(!pending){
   pending=(async()=>{
    const binding=await reader.readContract({address:registry!.address as Address,abi:registry!.version===6?walletRegistryAbiV2:walletRegistryAbiV1,functionName:'registrations',args:[beneficiaryId],blockNumber:args.blockNumber});
    check(typeof binding[0]==='string'&&/^0x[0-9a-fA-F]{40}$/.test(binding[0])&&typeof binding[2]==='bigint'&&binding[2]>=0n);
    if(binding[2]===0n){check(BigInt(binding[0])===0n);return undefined;}
    check(binding[1]===kind&&sponsorAddress(binding[0])&&binding[0].toLowerCase()!==registry!.address.toLowerCase());
    return binding[0];
   })();
   registrations.set(key,pending);
  }
  return pending;
 };
 const digest=await reader.readContract({...args,functionName:'uploadDigest'});
 if(pot.state!==1)check(digest===commitment.digest && pot.entitlementCount===commitment.count.toString() && pot.allocatedWei===commitment.total.toString());
 const sorted=p.awards.map((award,index)=>({award,number:index+1})).sort((a,b)=>{
  const n=query.sort==='amount'?(BigInt(a.award.amount)<BigInt(b.award.amount)?-1:BigInt(a.award.amount)>BigInt(b.award.amount)?1:0):a.number-b.number;
  return (query.direction==='desc'?-n:n)||a.number-b.number;
 });
 const rows:PublicRewardPage['rows']=await Promise.all(sorted.slice(query.offset,query.offset+size).map(async({award:r,number})=>{
  const row=await reader.readContract({...args,functionName:'entitlements',args:[r.entitlementId]});
  const missing=row[1]===0n;
  if(missing)check(pot.state===1&&row[0]==='0x'+'0'.repeat(64)&&row[2]==='0x'+'0'.repeat(64)&&row[3]===0n&&BigInt(row[4])===0n&&!row[6]);
  else check(row[0]===r.beneficiaryId&&row[1]===BigInt(r.amount)&&row[2]===r.explanationHash&&row[5]===r.pot&&row[7]===r.beneficiaryKind
    && (row[6]?BigInt(row[4])!==0n:BigInt(row[4])===0n));
  // A registered destination is not a payment. Preserve the actual paid address
  // even if this beneficiary later registers a different wallet.
  const registeredAddress=!missing&&!row[6]&&registry?await registeredRecipient(r.beneficiaryId,r.beneficiaryKind):undefined;
  return {id:r.entitlementId,number,kind:r.beneficiaryKind===0?'athlete':'club',amountWei:r.amount,status:missing?'planned':row[6]?'claimed':'unclaimed',...(!missing&&row[6]?{recipientAddress:row[4]}:{}),...(registeredAddress?{registeredAddress}:{}),...(r.breakdown?{breakdown:r.breakdown}: {}),...(r.display?{display:r.display}:{})};
 }));
 const after=await reader.getBlock({blockNumber:args.blockNumber});
 check(after.hash===observed.blockHash&&after.timestamp.toString()===observed.blockTimestamp&&await reader.getChainId()===scope.chainId);
 return decodePublicRewardPage({...base,total:p.awards.length,rows,availability:pot.state>=4?'closed':pot.paused?'paused':pot.state===3?(BigInt(pot.claimDeadline)>BigInt(observed.blockTimestamp)?'open':'closed'):'awaiting_distribution'},size);
}
