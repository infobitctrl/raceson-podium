import {parseAbi,type Address,type Hex} from 'viem';
import {rewardUploadDigest} from '@raceson/rewards-chain';
import {decodePublicRewardPage,PUBLIC_REWARD_PAGE_SIZE,type PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import type {SponsorChainReader,SponsorChainObservation} from '@raceson/rewards-chain/sponsor-v4';
const abi=parseAbi([
 'function uploadDigest() view returns(bytes32)',
 'function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)',
]);
function check(v:unknown):asserts v {if(!v)throw Error('public_awards_unavailable');}
export type PublicAwardQuery={offset:number;sort:'reward'|'amount';direction:'asc'|'desc'};
export function publicAwardQuery(params:URLSearchParams):PublicAwardQuery {
 if([...params.keys()].some(k=>!['offset','sort','direction'].includes(k)||params.getAll(k).length!==1))throw Error('invalid_public_awards');
 const offset=params.get('offset')??'0',sort=params.get('sort')??'reward',direction=params.get('direction')??'asc';
 if(!/^(0|[1-9][0-9]{0,4})$/.test(offset)||Number(offset)>10000||Number(offset)%PUBLIC_REWARD_PAGE_SIZE!==0||!['reward','amount'].includes(sort)||!['asc','desc'].includes(direction))throw Error('invalid_public_awards');
 return {offset:Number(offset),sort:sort as 'reward'|'amount',direction:direction as 'asc'|'desc'};
}
/** No additional wallet authority: reads bounded rows at one finalized block.
 * An absent/mismatched chain record never becomes a claimed/unclaimed assertion. */
export async function publicAwardPage(reader:SponsorChainReader,observed:SponsorChainObservation,
 scope:{id:string;chainId:10143|31337;slot:number},raw:unknown,query:PublicAwardQuery):Promise<PublicRewardPage> {
 const pot=observed.pots.find(p=>p.slot===scope.slot);
 check(observed.funded&&!observed.cancelled&&pot);
 const base={campaignId:scope.id,slot:scope.slot,chainId:scope.chainId,blockNumber:observed.blockNumber,blockTimestamp:observed.blockTimestamp,...query};
 if(raw===null){check(pot.entitlementCount==='0'&&pot.allocatedWei==='0');return decodePublicRewardPage({...base,total:0,availability:'awaiting_approval',rows:[]});}
 const p=raw as {chainId:number;slot:number;programmeAddress:string;campaignAddress:string;fundingHash:string;uploadDigest:Hex;awards:{entitlementId:Hex;beneficiaryId:Hex;explanationHash:Hex;amount:string;pot:0|1;beneficiaryKind:0|1}[]};
 check(p && p.chainId===scope.chainId && p.slot===scope.slot && p.programmeAddress===observed.address && p.campaignAddress===pot.address && p.fundingHash===observed.fundingHash && Array.isArray(p.awards) && p.awards.length<=10000);
 const commitment=rewardUploadDigest(p.awards.map(r=>({...r,amount:BigInt(r.amount)})),scope.slot===0?1:0,BigInt(pot.amountWei));
 check(commitment.digest===p.uploadDigest);
 const args={address:pot.address as Address,abi,blockNumber:BigInt(observed.blockNumber)};
 const digest=await reader.readContract({...args,functionName:'uploadDigest'});
 if(pot.state!==1)check(digest===commitment.digest && pot.entitlementCount===commitment.count.toString() && pot.allocatedWei===commitment.total.toString());
 const sorted=p.awards.map((award,index)=>({award,number:index+1})).sort((a,b)=>{
  const n=query.sort==='amount'?(BigInt(a.award.amount)<BigInt(b.award.amount)?-1:BigInt(a.award.amount)>BigInt(b.award.amount)?1:0):a.number-b.number;
  return (query.direction==='desc'?-n:n)||a.number-b.number;
 });
 const rows:PublicRewardPage['rows']=await Promise.all(sorted.slice(query.offset,query.offset+PUBLIC_REWARD_PAGE_SIZE).map(async({award:r,number})=>{
  const row=await reader.readContract({...args,functionName:'entitlements',args:[r.entitlementId]});
  const missing=row[1]===0n;
  if(missing)check(pot.state===1&&row[0]==='0x'+'0'.repeat(64)&&row[2]==='0x'+'0'.repeat(64)&&row[3]===0n&&BigInt(row[4])===0n&&!row[6]);
  else check(row[0]===r.beneficiaryId&&row[1]===BigInt(r.amount)&&row[2]===r.explanationHash&&row[5]===r.pot&&row[7]===r.beneficiaryKind
    && (row[6]?BigInt(row[4])!==0n:BigInt(row[4])===0n));
  return {id:r.entitlementId,number,kind:r.beneficiaryKind===0?'athlete':'club',amountWei:r.amount,status:missing?'planned':row[6]?'claimed':'unclaimed'};
 }));
 const after=await reader.getBlock({blockNumber:args.blockNumber});
 check(after.hash===observed.blockHash&&after.timestamp.toString()===observed.blockTimestamp&&await reader.getChainId()===scope.chainId);
 return decodePublicRewardPage({...base,total:p.awards.length,rows,availability:pot.state>=4?'closed':pot.paused?'paused':pot.state===3?(BigInt(pot.claimDeadline)>BigInt(observed.blockTimestamp)?'open':'closed'):'awaiting_distribution'});
}
