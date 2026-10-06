import type {IncomingMessage,ServerResponse} from 'node:http';
import {rewardPublicDirectory} from '@raceson/db/rewards';
import type {RewardLedgerRpc} from '@raceson/db/rewards';
import {decodePublicDirectory,type PublicDirectory,type DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {observeSponsorProgramme,type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Hex} from 'viem';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {publicCampaignObservation} from './public-campaign.js';
type Deps=OrganizerRewardRouteDependencies&{sponsorReader?:SponsorChainReader;publicRpc?:RewardLedgerRpc};
type Entry={until:number;value?:PublicDirectory;loading?:Promise<PublicDirectory>};
// Only public projections are cached. Publications already contain verified chain snapshots.
// The long-running demo API owns background work; no chain facts are persisted here.
const cache=new WeakMap<SponsorChainReader,Map<number,Entry>>();
const observationTime=(items:DirectoryCampaign[])=>items.length
 ?new Date(Math.min(...items.map(i=>Number(i.campaign.blockTimestamp)*1000))).toISOString()
 :new Date().toISOString();
/** Publish a completed full observer result; preserve all other campaigns and economics. */
export function mergeDirectoryObservation(directory:PublicDirectory,index:number,observation:Awaited<ReturnType<typeof observeSponsorProgramme>>):PublicDirectory{
 const item=directory.items[index];if(!item)throw Error('directory_index');
 const campaign=publicCampaignObservation(item.campaign,observation);
 if(BigInt(campaign.blockNumber)<BigInt(item.campaign.blockNumber)||BigInt(campaign.blockTimestamp)<BigInt(item.campaign.blockTimestamp))throw Error('older_observation');
 return decodePublicDirectory({...directory,items:directory.items.map((value,position)=>position===index?{...item,campaign}:value),
  checkedAt:observationTime(directory.items.map((value,position)=>position===index?{...item,campaign}:value)),refreshStatus:'refreshing'});
}
async function loadPublished(chainId:10143|31337,deps:Deps,entry:Entry):Promise<PublicDirectory>{
 const saved=await rewardPublicDirectory(chainId,deps.publicRpc??deps.rpc);
 if(saved.items.length>200)throw Error('directory_capacity'); // Never silently truncate totals.
 const items=saved.items.map(({campaign,selection,publishedAt})=>{
  const previous=entry.value?.items.find(i=>i.campaign.id===campaign.id&&i.publishedAt===publishedAt
   &&i.campaign.address===campaign.address&&i.campaign.fundingHash===campaign.fundingHash);
  return {campaign:previous&&BigInt(previous.campaign.blockNumber)>BigInt(campaign.blockNumber)?previous.campaign:campaign,selection,publishedAt,verified:true};
 });
 const initial=decodePublicDirectory({chainId,items,sponsors:saved.sponsors,checkedAt:observationTime(items),refreshStatus:items.length?'refreshing':'current'});
 entry.value=initial;
 if(!items.length){entry.until=Date.now()+30_000;return initial;}
 let expired=false,latest=initial;
 async function refresh(){
  let failed=false;
  for(let offset=0;offset<saved.items.length;offset+=4){
   if(expired)throw Error('refresh_timeout');
   await Promise.all(saved.items.slice(offset,offset+4).map(async({record},index)=>{
    const item=items[offset+index];
    try{
     const observation=await observeSponsorProgramme(deps.sponsorReader!,record.plan,record.deploymentHash as Hex,record.fundingHash as Hex);
     if(expired)return item; // A late result cannot overwrite the timed-out projection.
     latest=mergeDirectoryObservation(latest,offset+index,observation);
     entry.value=latest; // Other campaigns can still be checking; expose only this fully verified result.
     return latest.items[offset+index];
    }catch{failed=true;return item;}
   }));
  }
  return decodePublicDirectory({...latest,refreshStatus:failed?'failed':'current'});
 }
 // A stalled provider must not leave the browser polling indefinitely. Late results
 // are discarded, and publication/last-observed facts keep their original timestamp.
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('refresh_timeout'));},90_000);timer.unref();});
 const work=refresh().finally(()=>{entry.until=Date.now()+30_000;});
 void Promise.race([work,deadline]).then(value=>{entry.value=value;},()=>{entry.value={...latest,refreshStatus:'failed'};})
  .finally(()=>{clearTimeout(timer);});
 return initial;
}
export async function dispatchPublicDirectory(req:IncomingMessage,res:ServerResponse,url:URL,deps:Deps){
 if(url.pathname!=='/api/v1/rewards/public-campaigns')return false;
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
 if([...url.searchParams].length){deps.sendError(res,400,'invalid_public_directory','Invalid directory request.');return true;}
 try{
  const config=deps.config(),reader=deps.sponsorReader;
  if(!config||!reader)throw Error('unavailable');
  let byChain=cache.get(reader);if(!byChain){byChain=new Map();cache.set(reader,byChain);}
  let entry=byChain.get(config.chainId);
  if(!entry){entry={until:0};byChain.set(config.chainId,entry);}
  if(!entry.loading&&entry.until<=Date.now()){
   const current=entry;current.until=Infinity;
   current.loading=loadPublished(config.chainId,deps,current).catch(error=>{byChain!.delete(config.chainId);throw error;}).finally(()=>{current.loading=undefined;});
  }
  deps.sendSuccess(res,entry.loading?await entry.loading:entry.value!);
 }catch{deps.sendError(res,503,'public_directory_unavailable','Campaigns are temporarily unavailable. Please retry.');}
 return true;
}
