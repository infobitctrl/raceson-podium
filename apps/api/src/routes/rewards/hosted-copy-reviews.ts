import type {IncomingMessage,ServerResponse} from 'node:http';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyReviewBranding,hostedCopyReviewSources,composeHostedCopyAllocation,hostedCopyLifecycleRpc,hostedCopySetupNodeId} from '@raceson/db/rewards';
import {rewardReviewIssues} from '@raceson/db/rewards';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {hostedCopyOperationsEnabled,hostedCopyPin} from '../../features/rewards/hosted-copy-preview.js';
import {hostedCopySelections,hostedCopyUnaffiliatedReview,hostedCopyReviewNote} from '../../features/rewards/hosted-copy-review.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {z} from 'zod';
import {hostedCopyCategoryEvidence} from '../../features/rewards/hosted-copy-review-evidence.js';
import {hostedCopyAwardReview} from '../../features/rewards/hosted-copy-approval-service.js';
import {sponsorUploadV4} from '../../features/rewards/sponsor-upload-v4-service.js';
import {sponsorLifecycleV4} from '../../features/rewards/sponsor-lifecycle-v4-service.js';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import {hostedReviewFunding} from '../../features/rewards/hosted-copy-review-funding.js';
import {hostedReviewStatus} from '../../features/rewards/hosted-copy-review-status.js';
import {readHostedCopyCatalogue} from '../../features/rewards/hosted-copy-catalogue.js';
import {reviewPublication,reviewPublicationCommand} from '../../features/rewards/review-publication-service.js';
import {reviewPublicationAccessFromEnv} from '../../features/rewards/review-publication-privy.js';
import {reviewWalletHandover,reviewWalletHandoverCommand} from '../../features/rewards/review-wallet-handover.js';
import type {RewardAccountIdentity} from '@raceson/db/rewards';
import type {SponsorCreationDeps} from '../../features/rewards/sponsor-creation-service.js';
const uuid=z.string().uuid().refine(v=>!!setupId(v)),hash=z.string().regex(/^[0-9a-f]{64}$/);
const decision=z.object({requestId:uuid,expectedApprovalId:uuid.nullable(),contextHash:hash,documentHash:hash,decision:z.enum(['approved','held'])}).strict();
const upload=z.object({requestId:uuid,contextHash:hash,documentHash:hash}).strict();
const publication=z.object({action:z.literal('publication'),requestId:uuid,documentHash:hash}).strict();
export async function dispatchHostedCopyReviews(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{sponsorReader?:SponsorChainReader;publicationReader?:SponsorCreationDeps['reader'];resolveReviewerWallet?:(identity:RewardAccountIdentity)=>Promise<{address:string;owned:true;balanceWei:string}|null>}){
 const issueOnly=/^\/api\/v1\/rewards\/demo-copy\/reviews\/[^/]+\/allocations\/[0-5]\/issues$/.test(url.pathname);
 const statusOnly=/^\/api\/v1\/rewards\/demo-copy\/reviews\/[^/]+\/status$/.test(url.pathname);
 const match=/^\/api\/v1\/rewards\/demo-copy\/reviews(?:\/([^/]+)(?:\/allocations\/([0-5])(?:\/([^/]+)\/(upload|handoff|publish|wallet-ownership))?)?)?$/.exec(statusOnly||issueOnly?url.pathname.slice(0,-7):url.pathname);
 if(!match)return false;deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();
  if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(req.method!=='GET'&&!(match[2]&&req.method==='POST')){res.setHeader('Allow',match[2]?'GET, POST':'GET');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if([...url.searchParams].length||match[1]&&!setupId(match[1]))throw Error('invalid_reward_setup');
  const actor=await deps.requireIdentity(req),id=match[1]??null;
  const rpc=deps.rpc??((name:string,args:Record<string,unknown>)=>createAdminSupabaseClient(env).rpc(name,args));
  if(issueOnly){deps.sendSuccess(res,await rewardReviewIssues(actor,{chainId:10143,setupId:id!,slot:Number(match[2])},req.method==='POST'?await deps.readJsonBody(req):undefined,rpc,true));return true;}
  if(match[3]){
   const scope={chainId:10143 as const,setupId:id!,slot:Number(match[2]),approvalId:uuid.parse(match[3])},transport=hostedCopyLifecycleRpc(actor,rpc);
   if(match[4]==='publish'){
    if(!deps.publicationReader)throw Error('hosted_copy_unavailable');
    deps.sendSuccess(res,await reviewPublication(actor,scope,req.method==='POST'?reviewPublicationCommand.parse(await deps.readJsonBody(req)):undefined,{rpc,reader:deps.publicationReader,resolveAccess:(operator,campaign)=>reviewPublicationAccessFromEnv(actor,operator,campaign,req.method==='POST'?String(req.headers.authorization??'').replace(/^Bearer /,''):undefined,process.env,rpc)}));
   }
   else if(match[4]==='wallet-ownership')deps.sendSuccess(res,await reviewWalletHandover(actor,scope,req.method==='POST'?reviewWalletHandoverCommand.parse(await deps.readJsonBody(req)):undefined,process.env,rpc));
   else if(match[4]==='upload')deps.sendSuccess(res,await sponsorUploadV4(actor,scope,req.method==='POST'?upload.parse(await deps.readJsonBody(req)):undefined,{rpc:transport,reader:deps.sponsorReader}));
   else deps.sendSuccess(res,await sponsorLifecycleV4(actor,scope,req.method==='POST'?publication.parse(await deps.readJsonBody(req)):undefined,{rpc:transport,view:'handoff'}));
   return true;
  }
  if(match[2]){deps.sendSuccess(res,await hostedCopyAwardReview(actor,id!,Number(match[2]),rpc,req.method==='POST'?decision.parse(await deps.readJsonBody(req)):undefined));return true;}
  const records=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(statusOnly){
   const record=records[0]!,status=await hostedReviewStatus(actor,record,rpc,deps.sponsorReader);
   const fresh=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
   if(fresh[0]!.launch.id!==record.launch.id||JSON.stringify(fresh[0]!.execution)!==JSON.stringify(record.execution))throw Error('reward_setup_conflict');
   deps.sendSuccess(res,status);return true;
  }
  const {catalogue}=await readHostedCopyCatalogue(env);
  for(const record of records)for(const pool of record.summary.pools)pool.name=pool.slot===0?catalogue.name:catalogue.rounds.find(round=>round.slot===pool.slot)!.name;
  const branding=await hostedCopyReviewBranding(actor,id,records.map(r=>r.summary.id),rpc);
  if(id===null){const wallet=deps.resolveReviewerWallet?await deps.resolveReviewerWallet(actor).catch(()=>null):undefined;deps.sendSuccess(res,{version:'podium-copy-review-queue-v1',...(wallet!==undefined?{wallet}:{}),items:records.map(r=>({...r.summary,branding:branding.find(b=>b.id===r.summary.id)!}))});return true;}
  const record=records[0]!;
  const result=composeHostedCopyAllocation(record.launch.setup,record.source!,hostedCopyPin,hostedCopySelections(hostedCopyPin),hostedCopyUnaffiliatedReview(hostedCopyPin));
  const groups=result.allocation.groups.filter(g=>g.budgetWei>0n).map(g=>{
   const category=catalogue.categories.find(c=>hostedCopySetupNodeId(id,`group:${g.slot}:${c.id}`)===g.nodeId);
   const track=category&&catalogue.rounds.find(r=>r.slot===g.slot)?.tracks.find(t=>t.competitionId===category.competitionId);
   return {...g,classification:category?{trackId:category.competitionId,trackName:track?.name??category.competitionName,categoryName:category.name}:null,
    results:category?hostedCopyCategoryEvidence(record.source!,g.slot,category.id,hostedCopySelections(hostedCopyPin)):undefined};
  });
  const funding=await hostedReviewFunding(record.execution,deps.sponsorReader);
  // Recheck live source authority after calculation before returning private rows.
  const fresh=await hostedCopyReviewSources(actor,id,hostedCopyPin,rpc);
  if(fresh[0]!.launch.id!==record.launch.id||JSON.stringify(fresh[0]!.execution)!==JSON.stringify(record.execution))throw Error('reward_setup_conflict');
  deps.sendSuccess(res,JSON.parse(JSON.stringify({...result.allocation,groups,pools:record.summary.pools,funding,selection:record.summary.selection,branding:branding[0],reviewNote:hostedCopyReviewNote(hostedCopyPin)},(_key,v)=>typeof v==='bigint'?v.toString():v)));
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error?error.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(code==='Untrusted browser origin')deps.sendError(res,403,'forbidden','This browser request is not allowed.');
  else if(['reward_demo_account_required','reward_demo_reviewer_required'].includes(code))deps.sendError(res,403,'reward_demo_reviewer_required','An active results-team or master-administrator account is required.');
  else if(code==='reward_review_issue_not_owned')deps.sendError(res,403,code,'Only the reporting reviewer can withdraw this flag.');
  else if(['reward_review_issue_open','reward_review_issue_conflict','reward_review_issue_limit'].includes(code))deps.sendError(res,409,code,'Reload reported issues before approving or retrying.');
  else if(code==='invalid_reward_review_issue')deps.sendError(res,400,code,'Check the issue report.');
  else if(code==='reward_setup_not_found')deps.sendError(res,404,code,'No source-bound campaign is available.');
  else if(code==='reward_setup_conflict')deps.sendError(res,409,code,'Reload the current contract version before reviewing.');
  else if(['review_publication_authorization_required','review_publication_authorization_failed'].includes(code))deps.sendError(res,409,code,'Wallet authorization was not completed. Resume publication from your reviewer session.');
  else if(['review_wallet_ownership_required','review_wallet_unverified','review_wallet_unavailable','review_wallet_handover_conflict','controller_auth_required'].includes(code))deps.sendError(res,409,code,'The assigned reviewer must own this campaign wallet. Check reviewer access before publishing.');
  else if(['controller_source_not_ready','controller_transaction_pending','controller_transaction_reverted','controller_balance_required','controller_gas_limit','controller_scope_required'].includes(code))deps.sendError(res,409,code,'Publication is paused. Reload the current awards or retry the saved transaction.');
  else if(['reward_planning_revision_changed','reward_sponsor_approval_conflict','reward_sponsor_source_not_ready','reward_sponsor_upload_conflict','reward_sponsor_funding_not_ready','reward_sponsor_upload_required','reward_sponsor_lifecycle_not_ready','reward_sponsor_lifecycle_conflict','reward_sponsor_historical_review_unavailable'].includes(code))deps.sendError(res,409,code,'Reload the exact saved awards and confirmed funding before continuing.');
  else if(code==='reward_sponsor_approval_not_found')deps.sendError(res,404,code,'No approved award version is available.');
  else if(['invalid_sponsor_allocation','invalid_sponsor_upload','invalid_sponsor_lifecycle'].includes(code)||error instanceof z.ZodError)deps.sendError(res,400,'invalid_sponsor_allocation','Check the award review request.');
  else if(code==='invalid_reward_setup')deps.sendError(res,400,code,'Select a source-bound campaign.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The verified review sources could not be loaded.');
 }
 return true;
}
