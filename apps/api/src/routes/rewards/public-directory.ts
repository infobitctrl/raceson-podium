import type {IncomingMessage,ServerResponse} from 'node:http';
import {rewardPublicDirectory} from '@raceson/db/rewards';
import type {RewardLedgerRpc} from '@raceson/db/rewards';
import {decodePublicDirectory,directoryObservationTime,mergePublicDirectory,type PublicDirectory} from '@raceson/domain/rewards/public-directory';
import {createPublicDirectoryReader,observePublicSponsorProgramme,type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Hex} from 'viem';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {publicCampaignObservation} from './public-campaign.js';
import {readDirectorySummaries,saveDirectorySummary,type PublicDirectoryCache} from '../../features/rewards/public-directory-cache.js';
type Deps=OrganizerRewardRouteDependencies&{sponsorReader?:SponsorChainReader;publicRpc?:RewardLedgerRpc;awaitRefresh?:boolean;summaryCache?:PublicDirectoryCache};
type Entry={until:number;value?:PublicDirectory;loading?:Promise<PublicDirectory>;refresh?:Promise<void>;timing?:{load:number;verify:number;summary:number}};
// Only public projections are cached. Publications already contain verified chain snapshots.
// Only a held full-verification request writes shared public summaries.
const cache=new WeakMap<SponsorChainReader,Map<number,Entry>>();
/** Publish a completed full observer result; preserve all other campaigns and economics. */
export function mergeDirectoryObservation(directory:PublicDirectory,index:number,observation:Awaited<ReturnType<typeof observePublicSponsorProgramme>>):PublicDirectory{
 const item=directory.items[index];if(!item)throw Error('directory_index');
 const campaign=publicCampaignObservation(item.campaign,observation);
 if(BigInt(campaign.blockNumber)<BigInt(item.campaign.blockNumber)||BigInt(campaign.blockTimestamp)<BigInt(item.campaign.blockTimestamp))throw Error('older_observation');
 return decodePublicDirectory({...directory,items:directory.items.map((value,position)=>position===index?{...item,campaign}:value),
  checkedAt:directoryObservationTime(directory.items.map((value,position)=>position===index?{...item,campaign}:value)),refreshStatus:'refreshing'});
}
async function loadPublished(chainId:10143|31337,deps:Deps,entry:Entry):Promise<PublicDirectory>{
 const began=performance.now();
 const saved=await rewardPublicDirectory(chainId,deps.publicRpc??deps.rpc);
 if(saved.items.length>200)throw Error('directory_capacity'); // Never silently truncate totals.
 const items=saved.items.map(({campaign,selection,publishedAt})=>({campaign,selection,publishedAt,verified:true}));
 const published=decodePublicDirectory({chainId,items,sponsors:saved.sponsors,checkedAt:directoryObservationTime(items),refreshStatus:items.length?'refreshing':'current'});
 const initial=mergePublicDirectory(await readDirectorySummaries(published,deps.summaryCache),entry.value);
 entry.value=initial;
 const timing=entry.timing={load:performance.now()-began,verify:0,summary:0};
 if(!items.length){entry.until=Date.now()+30_000;return initial;}
 let expired=false,latest=initial;const refreshStarted=performance.now();
 async function refresh(){
  const reader=createPublicDirectoryReader(deps.sponsorReader!);
  let failed=false,next=0;
  async function worker(){
   while(next<saved.items.length){
    if(expired)return;
    const index=next++,{record}=saved.items[index]!;
    try{
     const observation=await observePublicSponsorProgramme(reader,record.plan,record.deploymentHash as Hex,record.fundingHash as Hex);
     if(expired)return; // A late result cannot overwrite the timed-out projection.
     latest=mergeDirectoryObservation(latest,index,observation);
     entry.value=latest; // Other campaigns can still be checking; expose only this fully verified result.
     const saving=performance.now();
     await saveDirectorySummary(latest.items[index]!,deps.summaryCache);
     timing.summary=Math.max(timing.summary,performance.now()-saving);
    }catch{failed=true;}
   }
  }
  // Overlap up to 16 complete observers to fill the bounded eight-read RPC
  // batches. Transport pacing still limits starts to five HTTP requests/sec;
  // each freed slot takes the next campaign without waiting for slower ones.
  await Promise.all(Array.from({length:Math.min(16,saved.items.length)},worker));
  return decodePublicDirectory({...latest,refreshStatus:failed?'failed':'current'});
 }
 // A stalled provider must not leave the browser polling indefinitely. Late results
 // are discarded, and publication/last-observed facts keep their original timestamp.
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('refresh_timeout'));},90_000);timer.unref();});
 const work=refresh().finally(()=>{entry.until=Date.now()+30_000;});
 entry.refresh=Promise.race([work,deadline]).then(value=>{entry.value=value;},()=>{entry.value={...latest,refreshStatus:'failed'};})
  .finally(()=>{timing.verify=performance.now()-refreshStarted;clearTimeout(timer);});
 return initial;
}
export async function dispatchPublicDirectory(req:IncomingMessage,res:ServerResponse,url:URL,deps:Deps){
 const snapshot=url.pathname==='/api/v1/rewards/public-campaigns/snapshot';
 if(!snapshot&&url.pathname!=='/api/v1/rewards/public-campaigns')return false;
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
 if([...url.searchParams].length){deps.sendError(res,400,'invalid_public_directory','Invalid directory request.');return true;}
 try{
  const config=deps.config(),reader=deps.sponsorReader;
  if(!config||!reader)throw Error('unavailable');
  if(snapshot){
   // Published facts have already been verified at their original block. Do not
   // launch detached RPC work or let a slow live check delay public browsing.
   const saved=await rewardPublicDirectory(config.chainId,deps.publicRpc??deps.rpc);
   if(saved.items.length>200)throw Error('directory_capacity');
   const items=saved.items.map(({campaign,selection,publishedAt})=>({campaign,selection,publishedAt,verified:true}));
   const published=decodePublicDirectory({chainId:config.chainId,items,sponsors:saved.sponsors,checkedAt:directoryObservationTime(items),refreshStatus:'published'});
   const started=performance.now();
   const shared=await readDirectorySummaries(published,deps.summaryCache);
   const reused=shared.items.filter((item,index)=>BigInt(item.campaign.blockNumber)>BigInt(items[index]!.campaign.blockNumber)).length;
   res.setHeader('Server-Timing',`summaries;dur=${(performance.now()-started).toFixed(1)};desc="${reused} saved"`);
   deps.sendSuccess(res,mergePublicDirectory(shared,cache.get(reader)?.get(config.chainId)?.value));
   return true;
  }
  let byChain=cache.get(reader);if(!byChain){byChain=new Map();cache.set(reader,byChain);}
  let entry=byChain.get(config.chainId);
  if(!entry){entry={until:0};byChain.set(config.chainId,entry);}
  const mode=entry.loading||entry.until===Infinity?'joined':entry.until<=Date.now()?'fresh':'cached';
  if(!entry.loading&&entry.until<=Date.now()){
   const current=entry;current.until=Infinity;
   current.loading=loadPublished(config.chainId,deps,current).catch(error=>{byChain!.delete(config.chainId);throw error;}).finally(()=>{current.loading=undefined;});
  }
  if(entry.loading)await entry.loading;
  // Hosted functions may stop after a response, and a later poll may reach a
  // different process. Complete this bounded read within the request there.
  if(deps.awaitRefresh&&entry.refresh)await entry.refresh;
  if(entry.timing){const t=entry.timing;res.setHeader('Server-Timing',`directory;desc="${mode}", directory_load;dur=${t.load.toFixed(1)}, directory_verify;dur=${t.verify.toFixed(1)}, summary_write_max;dur=${t.summary.toFixed(1)}`);}
  deps.sendSuccess(res,entry.value!);
 }catch{deps.sendError(res,503,'public_directory_unavailable','Campaigns are temporarily unavailable. Please retry.');}
 return true;
}
