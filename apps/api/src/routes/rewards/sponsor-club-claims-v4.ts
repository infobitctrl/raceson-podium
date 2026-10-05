import type {IncomingMessage,ServerResponse} from "node:http";
import {z} from "zod";
import {listSponsorClubClaimsV4} from "@raceson/db/rewards";
import {sponsorClubClaimV4,type SponsorClubClaimChangeV4} from "../../features/rewards/sponsor-club-claims-v4-service.js";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";
import type {SponsorClubClaimReaderV4} from "@raceson/rewards-chain/sponsor-claim-reader-v4";
const uuid=z.string().uuid(),hex=z.string().regex(/^0x[0-9a-f]{64}$/),hash=z.string().regex(/^[0-9a-f]{64}$/);
const command=z.discriminatedUnion("action",[
 z.object({action:z.literal("request"),approvalId:uuid,entitlementId:hex,requestId:uuid}).strict(),
 z.object({action:z.literal("prepare"),sourceStamp:hash,profileFingerprint:hash,attestation:z.unknown()}).strict(),
 z.object({action:z.literal("recipient"),signature:z.string().regex(/^0x([0-9a-f]{2}){1,8192}$/)}).strict(),
 z.object({action:z.literal("operator"),signature:z.string().regex(/^0x[0-9a-f]{130}$/)}).strict(),
 z.object({action:z.literal("receipt"),transactionHash:hex}).strict(),z.object({action:z.literal("revoke")}).strict(),
]);
export async function dispatchSponsorClubClaimsV4(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies&{sponsorReader?:SponsorClubClaimReaderV4}){
 const m=/^\/api\/v1\/(athlete|organizer)\/rewards\/sponsor-club-claims(?:\/([^/]+))?$/.exec(url.pathname);if(!m)return false;
 deps.applyPrivateSessionHeaders(res);
 try{const config=deps.config();if(!config)return false;const actor=await deps.requireIdentity(req),role=m[1]==="athlete"?"recipient":"operator";
  if(!m[2]){
   if(req.method!=="GET")throw Error("invalid_sponsor_claim");
   const q=z.object({approvalId:uuid.optional()}).strict().parse(Object.fromEntries(url.searchParams));
   if(role==="recipient"&&q.approvalId||role==="operator"&&!q.approvalId)throw Error("invalid_sponsor_claim");
   deps.sendSuccess(res,await listSponsorClubClaimsV4(actor,config.chainId,q.approvalId??null,deps.rpc));return true;
  }
  if(!["GET","POST"].includes(req.method??"")||[...url.searchParams].length)throw Error("invalid_sponsor_claim");
  const c=req.method==="POST"?command.parse(await deps.readJsonBody(req)):undefined;
  if(c&&(role==="recipient"?!["request","recipient"].includes(c.action):["request","recipient"].includes(c.action)))throw Error("invalid_sponsor_claim");
  deps.sendSuccess(res,await sponsorClubClaimV4(actor,{chainId:config.chainId,claimId:uuid.parse(m[2]),role},c as SponsorClubClaimChangeV4|undefined,{rpc:deps.rpc,reader:deps.sponsorReader}));
 }catch(e){const code=e&&typeof e==="object"&&"code"in e?String(e.code):e instanceof Error?e.message:"";
  if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
  else if(code==="reward_claim_scope_required")deps.sendError(res,404,code,"Claim not found for this account.");
  else if(e instanceof z.ZodError||code==="invalid_sponsor_claim")deps.sendError(res,400,"invalid_sponsor_claim","Check the claim request.");
  else if(["reward_sponsor_claim_conflict","reward_sponsor_claim_not_ready","reward_planning_revision_changed","reward_recipient_consent_required"].includes(code))deps.sendError(res,409,code,"Refresh the claim before continuing.");
  else deps.sendError(res,503,"reward_sponsor_claim_unavailable","The claim could not be verified.");
 }return true;
}
