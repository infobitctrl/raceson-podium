import {sponsorLifecycleV4} from "../../features/rewards/sponsor-lifecycle-v4-service.js";
import type {IncomingMessage, ServerResponse} from "node:http";
import {sponsorUploadV4} from "../../features/rewards/sponsor-upload-v4-service.js";
import type {SponsorChainReader} from "@raceson/rewards-chain/sponsor-v4";
import {z} from "zod";
import {sponsorAllocationReviewV4} from "../../features/rewards/sponsor-allocation-v4-service.js";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";
const uuid = z.string().uuid().refine(v => v === v.toLowerCase() && v !== "00000000-0000-0000-0000-000000000000");
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const command = z.object({requestId: uuid, expectedApprovalId: uuid.nullable(), contextHash: hash, documentHash: hash, decision: z.enum(["approved", "held"])}).strict();
const lifecycleCommand = z.discriminatedUnion("action", [z.object({action:z.literal("publication"),requestId:uuid,documentHash:hash}).strict(),z.object({action:z.literal("receipt"),requestId:uuid,transactionHash:z.string().regex(/^0x[0-9a-f]{64}$/),operation:z.enum(["upload","stage","activate"]),start:z.number().int().min(0).max(10000),end:z.number().int().min(0).max(10000)}).strict()]);
const uploadCommand = z.object({requestId: uuid, contextHash: hash, documentHash: hash}).strict();
export async function dispatchSponsorAllocationV4(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies & {sponsorReader?: SponsorChainReader}) {
  const match = /^\/api\/v1\/organizer\/rewards\/sponsor-setups\/([^/]+)\/allocations\/([0-5])(?:\/([^/]+)\/(upload|lifecycle|handoff))?$/.exec(url.pathname);
  if (!match) return false;
  deps.applyPrivateSessionHeaders(res);
  if (req.method !== "GET" && req.method !== "POST") {res.setHeader("Allow", "GET, POST"); deps.sendError(res, 405, "method_not_allowed", "Unsupported method."); return true;}
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_sponsor_allocation");
    const scope = {chainId: config.chainId, setupId: uuid.parse(match[1]), slot: Number(match[2])};
    if (match[3]) {
      const uploadScope = {...scope, approvalId: uuid.parse(match[3])};
      if (match[4] === "lifecycle" || match[4] === "handoff") {
        const change = req.method === "POST" ? lifecycleCommand.parse(await deps.readJsonBody(req)) : undefined;
        if (match[4] === "handoff" && change?.action === "receipt") throw Error("invalid_sponsor_lifecycle");
        deps.sendSuccess(res, await sponsorLifecycleV4(identity, uploadScope, change as Parameters<typeof sponsorLifecycleV4>[2], {rpc:deps.rpc,reader:deps.sponsorReader,...(match[4] === "handoff" ? {view:"handoff" as const} : {})})); return true;
      }
      const change = req.method === "POST" ? uploadCommand.parse(await deps.readJsonBody(req)) : undefined;
      deps.sendSuccess(res, await sponsorUploadV4(identity, uploadScope, change, {rpc: deps.rpc, reader: deps.sponsorReader}));
      return true;
    }
    const change = req.method === "POST" ? command.parse(await deps.readJsonBody(req)) : undefined;
    deps.sendSuccess(res, await sponsorAllocationReviewV4(identity, scope, change, deps.rpc));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code)) deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (["reward_setup_not_found", "reward_planning_not_found", "reward_sponsor_approval_not_found"].includes(code)) deps.sendError(res, 404, "reward_setup_not_found", "No campaign results available for this account.");
    else if (["reward_sponsor_lifecycle_not_ready", "reward_sponsor_historical_review_unavailable", "reward_sponsor_upload_required", "reward_sponsor_lifecycle_conflict", "reward_sponsor_upload_conflict", "reward_sponsor_funding_not_ready", "reward_planning_revision_changed", "reward_sponsor_source_not_ready", "reward_sponsor_approval_conflict", "reward_review_issue_open", "reward_final_allocation_source_not_ready", "reward_league_publication_not_ready", "reward_historical_source_missing"].includes(code)) deps.sendError(res, 409, code, "Review the current official results before approving awards.");
    else if (code === "invalid_sponsor_lifecycle" || code === "invalid_sponsor_upload" || code === "invalid_sponsor_allocation" || error instanceof z.ZodError) deps.sendError(res, 400, "invalid_sponsor_allocation", "Check the award review request.");
    else deps.sendError(res, 503, "reward_sponsor_review_unavailable", "Award review could not be loaded or saved.");
  }
  return true;
}
