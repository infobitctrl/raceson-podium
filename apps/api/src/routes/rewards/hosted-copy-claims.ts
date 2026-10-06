import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyAthleteAwards,hostedCopyClaimFacts,hostedCopyClaimReviews} from '@raceson/db/rewards';
import {hostedCopyOperationsEnabled} from '../../features/rewards/hosted-copy-preview.js';
import {sponsorClaimFromFactsV4,type SponsorClaimChangeV4} from '../../features/rewards/sponsor-claims-v4-service.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
const uuid=z.string().uuid(),hex=z.string().regex(/^0x[0-9a-f]{64}$/),hash=z.string().regex(/^[0-9a-f]{64}$/);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),approvalId:uuid,entitlementId:hex,destinationId:uuid}).strict(),
 z.object({action:z.literal('recipient'),signature:z.string().regex(/^0x[0-9a-f]{130}$/)}).strict(),
 z.object({action:z.literal('prepare'),sourceStamp:hash,profileFingerprint:hash,attestation:z.unknown()}).strict(),
 z.object({action:z.literal('revoke')}).strict(),
]);
export async function dispatchHostedCopyClaims(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{sponsorReader?:SponsorChainReader}){
 const reviewList=url.pathname==='/api/v1/rewards/demo-copy/claim-reviews';
 const list=url.pathname==='/api/v1/rewards/demo-copy/athlete-awards';
 const m=/^\/api\/v1\/(athlete\/rewards\/sponsor-claims|rewards\/demo-copy\/claim-reviews)\/([^/]+)$/.exec(url.pathname);
 if(!list&&!reviewList&&!m)return false;deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143)throw Error('hosted_copy_unavailable');
  if(req.method!=='GET'&&!(m&&req.method==='POST'))throw Error('invalid_sponsor_claim');
  const actor=await deps.requireIdentity(req),rpc=deps.rpc??((name,args)=>createAdminSupabaseClient(env).rpc(name,args));
  if(reviewList){const q=z.object({approvalId:uuid,after:uuid.optional()}).strict().parse(Object.fromEntries(url.searchParams));
   if([...url.searchParams.keys()].length!==Object.keys(q).length)throw Error('invalid_sponsor_claim');
   deps.sendSuccess(res,await hostedCopyClaimReviews(actor,q.approvalId,q.after??null,rpc));return true;}
  if(list){const q=z.object({after:hex.optional()}).strict().parse(Object.fromEntries(url.searchParams));if([...url.searchParams.keys()].length!==Object.keys(q).length)throw Error('invalid_sponsor_claim');
   deps.sendSuccess(res,await hostedCopyAthleteAwards(actor,q.after??null,rpc));return true;}
  if([...url.searchParams].length)throw Error('invalid_sponsor_claim');
  const role=m![1].startsWith('athlete')?'recipient':'reviewer',id=uuid.parse(m![2]);
  const change=req.method==='POST'?command.parse(await deps.readJsonBody(req)):undefined;
  if(change&&!(role==='recipient'?['request','recipient']:['prepare','revoke']).includes(change.action))throw Error('invalid_sponsor_claim');
  const scope={chainId:10143 as const,claimId:id,role:role==='recipient'?'recipient' as const:'operator' as const};
  deps.sendSuccess(res,await sponsorClaimFromFactsV4(scope,change as SponsorClaimChangeV4|undefined,{
   origin:deps.config()!.origin,reader:deps.sponsorReader,readFacts:hostedCopyClaimFacts(actor,id,role,rpc),signer:role==='recipient',
  }));
 }catch(e){const code=e&&typeof e==='object'&&'code'in e?String(e.code):e instanceof Error?e.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(code==='Untrusted browser origin'||['reward_demo_reviewer_required','reward_demo_account_required'].includes(code))deps.sendError(res,403,'reward_claim_scope_required','This account cannot review these claims.');
  else if(code==='reward_claim_scope_required')deps.sendError(res,404,code,'Claim not found for this account.');
  else if(e instanceof z.ZodError||code==='invalid_sponsor_claim')deps.sendError(res,400,'invalid_sponsor_claim','Check the claim request.');
  else if(['reward_sponsor_claim_conflict','reward_sponsor_claim_not_ready','reward_planning_revision_changed','reward_recipient_consent_required'].includes(code))deps.sendError(res,409,code,'Refresh the claim before continuing.');
  else deps.sendError(res,503,'reward_sponsor_claim_unavailable','The copied claim could not be verified.');
 }return true;
}
