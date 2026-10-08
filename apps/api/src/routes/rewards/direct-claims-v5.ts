import {clubDirectClaimV5} from '../../features/rewards/club-direct-claims-v5-service.js';
import type {RewardClubSafeDeploymentReader} from '@raceson/rewards-chain';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyOperationsEnabled} from '../../features/rewards/hosted-copy-preview.js';
import {directClaimV5,type IdentityBindingIssuerV1} from '../../features/rewards/direct-claims-v5-service.js';
import {directIdentityIssuerFromEnv} from '../../features/rewards/direct-claims-privy.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
const uuid=z.string().uuid(),hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),proofId:uuid}).strict(),z.object({action:z.literal('receipt'),hash}).strict(),z.object({action:z.literal('registrationReceipt'),hash}).strict(),
]);
export async function dispatchDirectClaimsV5(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{sponsorReader?:SponsorChainReader;identityIssuer?:IdentityBindingIssuerV1|null}){
 const match=/^\/api\/v1\/athlete\/rewards\/direct-claims\/([^/]+)\/([^/]+)$/.exec(url.pathname);
 const club=/^\/api\/v1\/club\/rewards\/direct-claims\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
 const route=match??club;if(!route)return false;
 deps.applyPrivateSessionHeaders(res);
 try{
  const env=loadServerEnv();if(!hostedCopyOperationsEnabled(process.env,env)||deps.config()?.chainId!==10143||!deps.sponsorReader)throw Error('hosted_copy_unavailable');
  if(!['GET','POST'].includes(req.method??'')||[...url.searchParams].length)throw Error('invalid_sponsor_claim');
  const actor=await deps.requireIdentity(req),approvalId=uuid.parse(route[1]),entitlementId=hash.parse(route[2]);
  const change=req.method==='POST'?command.parse(await deps.readJsonBody(req)):undefined;
  if(change?.action==='registrationReceipt'&&!club)throw Error('invalid_sponsor_claim');
  const rpc=deps.rpc??((name,args)=>createAdminSupabaseClient(env).rpc(name,args));
  const shared={rpc,reader:deps.sponsorReader,issuer:deps.identityIssuer===undefined?directIdentityIssuerFromEnv(process.env):deps.identityIssuer};
  if(club){
   if(!safeReader(deps.sponsorReader))throw Error('hosted_copy_unavailable');
   deps.sendSuccess(res,await clubDirectClaimV5(actor,approvalId,entitlementId,uuid.parse(club[3]),change as Parameters<typeof clubDirectClaimV5>[4],{...shared,reader:deps.sponsorReader}));
  }else deps.sendSuccess(res,await directClaimV5(actor,approvalId,entitlementId,change as Parameters<typeof directClaimV5>[3],shared));
 }catch(e){const code=e&&typeof e==='object'&&'code'in e?String(e.code):e instanceof Error?e.message:'';
  if(['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to the isolated demo.');
  else if(code==='Untrusted browser origin')deps.sendError(res,403,'reward_claim_scope_required','This origin cannot request claims.');
  else if(['reward_claim_scope_required','reward_club_owner_required'].includes(code))deps.sendError(res,404,code,'Award not found for this account.');
  else if(e instanceof z.ZodError||code==='invalid_sponsor_claim')deps.sendError(res,400,'invalid_sponsor_claim','Check the claim request.');
  else if(['reward_wallet_challenge_expired','reward_destination_proof_required','reward_sponsor_claim_not_ready','reward_sponsor_claim_conflict','reward_club_treasury_required'].includes(code))deps.sendError(res,409,code,'Refresh the reward and verify your selected wallet.');
  else deps.sendError(res,503,'reward_direct_claim_unavailable','The claim could not be verified. Refresh its status before trying again.');
 }return true;
}

function safeReader(reader:SponsorChainReader):reader is SponsorChainReader & RewardClubSafeDeploymentReader{return 'getStorageAt' in reader && typeof reader.getStorageAt==='function';}
