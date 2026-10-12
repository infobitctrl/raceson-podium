import type {IncomingMessage,ServerResponse} from 'node:http';
import {rewardPublicCampaign,rewardPublicAwards,rewardPublicDirectory,rewardSponsorExecution,rewardSponsorLaunch} from '@raceson/db/rewards';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {decodePublicSponsorCampaign,type PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {sponsorLaunchPlan,type SponsorLaunch} from '@raceson/domain/rewards/sponsor-launch';
import {observeSponsorProgramme,type SponsorChainObservation,type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import {decodePublicCampaignSource,decodePublicCampaignSnapshot} from '@raceson/domain/rewards/public-directory';
import {observePublicPot} from '../../features/rewards/public-pot-observation.js';
import type {Hex} from 'viem';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import type {RewardAccountIdentity,RewardLedgerRpc} from '@raceson/db/rewards';

import {publicAwardPage,publicAwardQuery} from '../../features/rewards/public-awards-service.js';

type Deps = OrganizerRewardRouteDependencies & {sponsorReader?:SponsorChainReader;publicRpc?:RewardLedgerRpc;
 resolveSponsorRpc?:(identity:RewardAccountIdentity,id:string)=>Promise<RewardLedgerRpc>;
 resolvePublicationRpc?:(identity:RewardAccountIdentity,id:string)=>RewardLedgerRpc};
export function publicCampaignObservation(campaign:PublicSponsorCampaign, observation:SponsorChainObservation):PublicSponsorCampaign {
 if (!observation.funded || observation.cancelled || observation.address!==campaign.address || observation.fundingHash!==campaign.fundingHash) throw Error('campaign_funding_required');
 return decodePublicSponsorCampaign({...campaign,blockNumber:observation.blockNumber,blockTimestamp:observation.blockTimestamp,
  pots:campaign.pots.map(p=>{
   const o=observation.pots.find(pot=>pot.slot===p.slot);
   if(!o || o.amountWei!==p.amountWei)throw Error('invalid_public_campaign');
   return {...p,state:o.state,paused:o.paused,allocatedWei:o.allocatedWei,paidWei:o.paidWei,remainingWei:o.remainingWei,returnedWei:o.returnedWei,claimDeadline:o.claimDeadline};
  })});
}
export function createPublicCampaign(launch:SponsorLaunch, observation:SponsorChainObservation):PublicSponsorCampaign {
 const plan=sponsorLaunchPlan(launch.setup),config=launch.setup.configuration;
 return publicCampaignObservation({id:launch.setup.id,name:config.name,chainId:launch.setup.chainId,budgetWei:plan.budgetWei,
  address:observation.address,fundingHash:observation.fundingHash!,blockNumber:observation.blockNumber,blockTimestamp:observation.blockTimestamp,
  pots:plan.pots.filter(p=>p.shareBps>0).map(p=>({slot:config.guided!.pots.find(g=>g.nodeId===p.id)!.slot,name:p.name,amountWei:p.amountWei!,
   state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:p.amountWei!,returnedWei:'0',claimDeadline:'0',
   groups:p.groups.filter(g=>g.shareBps>0).map(g=>({name:g.name,amountWei:g.amountWei!})),
  }))},observation);
}
export async function dispatchPublicCampaign(req:IncomingMessage,res:ServerResponse,url:URL,deps:Deps) {
 const timings:string[]=[];
 const timed=async<T>(name:string,read:()=>Promise<T>):Promise<T>=>{
  const start=performance.now();
  try{return await read();}finally{
   timings.push(`${name};dur=${(performance.now()-start).toFixed(1)}`);
   if(!res.headersSent)res.setHeader('Server-Timing',timings.join(', '));
  }
 };
 const source=/^\/api\/v1\/rewards\/public-campaigns\/([^/]+)\/(source|snapshot)$/.exec(url.pathname);
 if(source){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if(!setupId(source[1])||[...url.searchParams].length){deps.sendError(res,400,'invalid_public_campaign','Invalid campaign request.');return true;}
  try{
   const config=deps.config();if(!config)throw Error('unavailable');
   // Read only the existing public projection. The snapshot retains its original
   // verification time; neither response includes the private execution record.
   const directory=await rewardPublicDirectory(config.chainId,deps.publicRpc??deps.rpc);
   const item=directory.items.find(item=>item.campaign.id===source[1]);
   if(!item){deps.sendError(res,404,'public_campaign_not_found','Campaign not found.');return true;}
   deps.sendSuccess(res,source[2]==='snapshot'
    ?decodePublicCampaignSnapshot({campaign:item.campaign,selection:item.selection,publishedAt:item.publishedAt})
    :decodePublicCampaignSource({id:source[1],chainId:config.chainId,selection:item.selection}));
  }catch{deps.sendError(res,503,'public_campaign_unavailable','Campaign source is temporarily unavailable.');}
  return true;
 }
 const awards=/^\/api\/v1\/rewards\/public-campaigns\/([^/]+)\/pots\/([0-5])\/awards$/.exec(url.pathname);
 if(awards){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  try{
   const config=deps.config(),id=awards[1],slot=Number(awards[2]),query=publicAwardQuery(url.searchParams);
   if(!setupId(id))throw Error('invalid_public_awards');
   if(!config||!deps.sponsorReader)throw Error('public_awards_unavailable');
   const saved=await timed('campaign',()=>rewardPublicCampaign(config.chainId,id,undefined,deps.publicRpc??deps.rpc));
   if(!saved||!saved.campaign.pots.some(p=>p.slot===slot)){deps.sendError(res,404,'public_campaign_not_found','Prize pot not found.');return true;}
   const reader=deps.sponsorReader;
   const [raw,observed]=await Promise.all([timed('awards',()=>rewardPublicAwards(config.chainId,id,slot,deps.publicRpc??deps.rpc)),timed('observation',()=>observePublicPot(reader,saved.record.plan,saved.record.deploymentHash as Hex,saved.record.fundingHash as Hex,slot,query.blockNumber===undefined?undefined:BigInt(query.blockNumber)))]);
   const plan=saved.record.plan;
   deps.sendSuccess(res,await timed('rows',()=>publicAwardPage(reader,observed,{id,chainId:config.chainId,slot,groups:saved.campaign.pots.find(p=>p.slot===slot)!.groups,
    ...(plan.version===5||plan.version===6?{walletRegistry:{address:plan.walletRegistry!,version:plan.version}}:{})},raw,query)));
  }catch(error){const invalid=error instanceof Error&&error.message==='invalid_public_awards';deps.sendError(res,invalid?400:503,invalid?'invalid_public_awards':'public_awards_unavailable',invalid?'Invalid reward request.':'Reward status is temporarily unavailable. Please retry.');}
  return true;
 }
 const match=/^\/api\/v1\/rewards\/public-campaigns\/([^/]+)$/.exec(url.pathname);
 if(!match)return false;
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET' && req.method!=='POST'){res.setHeader('Allow','GET, POST');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
 try {
  const config=deps.config();if(!config || !deps.sponsorReader)throw Error('public_campaign_unavailable');
  const id=match[1];if(!setupId(id) || [...url.searchParams].length)throw Error('invalid_public_campaign');
  if(req.method==='POST'){
   deps.applyPrivateSessionHeaders(res);
   const identity=await deps.requireIdentity(req);
   const body=await deps.readJsonBody(req);
   if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length)throw Error('invalid_public_campaign');
   const rpc=deps.resolveSponsorRpc?await deps.resolveSponsorRpc(identity,id):deps.rpc;
   const record=await rewardSponsorExecution(identity,config.chainId,id,undefined,rpc);
   if(!record?.deploymentHash || !record.fundingHash)throw Error('campaign_funding_required');
   const saved=await rewardSponsorLaunch(identity,config.chainId,id,undefined,rpc);
   if(!saved.launch || saved.launch.id!==record.plan.launchId || saved.setup.revision!==record.plan.setupRevision)throw Error('reward_setup_conflict');
   const observation=await observeSponsorProgramme(deps.sponsorReader,record.plan,record.deploymentHash as Hex,record.fundingHash as Hex);
   const published=await rewardPublicCampaign(config.chainId,id,{identity,campaign:createPublicCampaign(saved.launch,observation)},deps.resolvePublicationRpc?.(identity,id)??deps.publicRpc??deps.rpc);
   if(!published)throw Error('public_campaign_unavailable');
   deps.sendSuccess(res,publicCampaignObservation(published.campaign,observation));
  } else {
   const saved=await timed('campaign',()=>rewardPublicCampaign(config.chainId,id,undefined,deps.publicRpc??deps.rpc));
   if(!saved){deps.sendError(res,404,'public_campaign_not_found','This campaign has not completed setup.');return true;}
   const reader=deps.sponsorReader;
   const observation=await timed('observation',()=>observePublicPot.programme(reader,saved.record.plan,saved.record.deploymentHash as Hex,saved.record.fundingHash as Hex));
   deps.sendSuccess(res,publicCampaignObservation(saved.campaign,observation));
  }
 } catch(error){
  const code=error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to complete setup.');
  else if(code==='Untrusted browser origin')deps.sendError(res,403,'forbidden','This browser request is not allowed.');
  else if(['reward_demo_sponsor_required','reward_demo_account_required'].includes(code))deps.sendError(res,403,'reward_demo_sponsor_required','Use the provisioned sponsor account to complete setup.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,'reward_setup_not_found','Campaign not found.');
  else if(['campaign_funding_required','reward_setup_conflict'].includes(code))deps.sendError(res,409,code,'Confirm the deposit for this saved campaign before completing setup.');
  else if(code==='invalid_public_campaign')deps.sendError(res,400,code,'Invalid campaign request.');
  else deps.sendError(res,503,'public_campaign_unavailable','Campaign status is temporarily unavailable. Please retry.');
 }
 return true;
}
