import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { listRewardPlanningDrafts, readRewardPlanningDraft, saveRewardPlanningDraft, copyRewardLedgerDocument, readRewardSourceMappingV2, saveRewardSourceMappingV2, readRewardPublishedPreviewV2 } from "@raceson/db/rewards";
import { previewPublishedRewardsV2 } from "@raceson/domain/rewards/published-preview-v2";
import { deriveLeagueParticipationMetrics } from "@raceson/domain/rewards/league-participation-metrics";
import { decodeParticipationReviewChange } from "@raceson/domain/rewards/participation-review";
import { rewardParticipationReview } from "@raceson/db/rewards";
import { historicalMappingOnlyV3 } from "@raceson/domain/rewards/historical-catalogue-v3";
import { decodeRewardProgrammeDraftV2, previewRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { previewRewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { RewardCalculationError } from "@raceson/domain/rewards";
import { rewardFrozenProposalsV2, rewardHistoricalSourceV3 } from "@raceson/db/rewards";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
import { readProgrammeFundingViewV3, type ProgrammeFundingRegistryV3 } from "../../features/rewards/programme-funding-v3-service.js";
import { readRegisteredProgrammeFundingV3 } from "../../features/rewards/programme-registry-v3-service.js";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { prepareProgrammeDepositQuoteV3, inspectProgrammeDepositV3 } from "../../features/rewards/programme-deposit-v3-service.js";
import { decodeProgrammeDepositQuoteV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { decodeFinaleBindingChangeV3 } from "@raceson/domain/rewards/finale-binding-v3";
import { rewardFinaleBindingV3, readNativeFinaleSourceV3 } from "@raceson/db/rewards";
import { allocationApprovalV3 } from "../../features/rewards/allocation-approval-v3-service.js";
import { nativeContinuityReviewV3 } from "../../features/rewards/native-finale-continuity-service.js";
import { decodeNativeContinuityChangeV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
import { decodeLeaguePolicyChangeV3 } from "@raceson/domain/rewards/league-standings-v3";
import { leaguePolicyWorkspaceV3 } from "../../features/rewards/league-policy-v3-service.js";
import { allocationUploadV3 } from "../../features/rewards/allocation-upload-v3-service.js";
import { readProgrammeExecutionStatusV3 } from "@raceson/db/rewards";

const uuid = z.string().uuid().refine(v => v !== "00000000-0000-0000-0000-000000000000" && v.toLowerCase() === v);
const update = z.object({ expectedRevision: z.number().int().positive().max(2147483645), rules: z.unknown() }).strict();
const mappingUpdate = z.object({ expectedRevision: z.number().int().nonnegative().max(2147483645),
  expectedRulesRevision: z.number().int().positive().max(2147483645), catalogueHash: z.string().regex(/^[0-9a-f]{64}$/), mapping: z.unknown() }).strict();
const freezeRequest = z.object({ rulesRevision: z.number().int().positive().max(2147483645), mappingRevision: z.number().int().positive().max(2147483645),
  catalogueHash: z.string().regex(/^[0-9a-f]{64}$/), sourceHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export async function dispatchRewardPlanningRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies & {
  programmeFundingRegistry?: ProgrammeFundingRegistryV3; programmeFundingReader?: RewardProgrammeReaderV3 }) {
  const match = /^\/api\/v1\/organizer\/rewards\/drafts(?:\/([^/]+)(?:\/(mapping|finale|native-finale|native-continuity|league-policy|participation-review|participation-metrics|published-preview|historical-source|funding|deposit-review|deposit-status|proposals\/[1-5]|allocation-approval\/[1-4]|allocation-upload\/[1-4]\/[^/]+|allocation-execution\/[1-4]\/[^/]+\/[^/]+|final-allocation-execution\/[56]\/[^/]+\/[^/]+))?)?$/.exec(url.pathname);
  const execution = match?.[2]?.startsWith("allocation-execution/") || match?.[2]?.startsWith("final-allocation-execution/");
  if (execution && req.method !== "GET") return false;
  const proposals = match?.[2]?.startsWith("proposals/");
  const allocation = match?.[2]?.startsWith("allocation-approval/");
  const upload = match?.[2]?.startsWith("allocation-upload/");
  const deposit = match?.[2]?.startsWith("deposit-");
  if (!match || (deposit ? req.method !== "POST" : proposals || allocation || upload || ["participation-review", "historical-source", "finale", "native-continuity", "league-policy"].includes(match[2] ?? "") ? !["GET", "POST"].includes(req.method ?? "") : req.method !== "GET" && !(match[1] && req.method === "PATCH"))) return false;
  if (["published-preview", "participation-metrics", "funding", "native-finale"].includes(match[2] ?? "") && req.method !== "GET") return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw new Error("invalid_reward_query");
    if (!match[1]) {
      deps.sendSuccess(res, { items: await listRewardPlanningDrafts(identity, config.chainId, deps.rpc) });
    } else {
      const draftId = uuid.parse(match[1]);
      if (execution) {
        const [, slot, approvalId, uploadId] = match[2]!.split("/");
        deps.sendSuccess(res, await readProgrammeExecutionStatusV3(identity, { chainId: config.chainId, draftId,
          slot: Number(slot), approvalId: uuid.parse(approvalId), uploadId: uuid.parse(uploadId) }, deps.rpc)); return true;
      }
      if (upload) {
        const [, slot, approvalId] = match[2]!.split("/");
        const change = req.method === "POST" ? z.object({ requestId: uuid, contextHash: z.string().regex(/^[0-9a-f]{64}$/),
          documentHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(await deps.readJsonBody(req)) : undefined;
        deps.sendSuccess(res, await allocationUploadV3(identity, { chainId: config.chainId, draftId,
          slot: Number(slot), approvalId: uuid.parse(approvalId) }, change, deps.rpc)); return true;
      }
      if (match[2] === "league-policy") {
        let change;
        if (req.method === "POST") {
          const body = await deps.readJsonBody(req);
          try { change = decodeLeaguePolicyChangeV3(body); } catch { throw new Error("invalid_reward_query"); }
        }
        deps.sendSuccess(res, await leaguePolicyWorkspaceV3(identity, config.chainId, draftId, change, deps.rpc)); return true;
      }
      if (match[2] === "native-continuity") {
        let change;
        if (req.method === "POST") {
          const body = await deps.readJsonBody(req);
          try { change = decodeNativeContinuityChangeV3(body); } catch { throw new Error("invalid_reward_query"); }
        }
        deps.sendSuccess(res, await nativeContinuityReviewV3(identity, config.chainId, draftId, change, deps.rpc)); return true;
      }
      if (match[2] === "native-finale") {
        deps.sendSuccess(res, await readNativeFinaleSourceV3(identity, config.chainId, draftId, deps.rpc)); return true;
      }
      if (allocation) {
        const change = req.method === "POST" ? z.object({ requestId: uuid, expectedApprovalId: uuid.nullable(),
          contextHash: z.string().regex(/^[0-9a-f]{64}$/), documentHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(await deps.readJsonBody(req)) : undefined;
        deps.sendSuccess(res, copyRewardLedgerDocument(await allocationApprovalV3(identity,
          { chainId: config.chainId, draftId, slot: Number(match[2]!.split("/")[1]) }, change,
          { reader: deps.programmeFundingReader, rpc: deps.rpc })));
        return true;
      }
      if (match[2] === "finale") {
        const change = req.method === "POST" ? decodeFinaleBindingChangeV3(await deps.readJsonBody(req)) : undefined;
        deps.sendSuccess(res, copyRewardLedgerDocument(await rewardFinaleBindingV3(identity, config.chainId, draftId, change, deps.rpc)));
        return true;
      }
      if (match[2] === "historical-source") {
        const change = req.method === "POST" ? z.object({ slot: z.number().int().min(1).max(4), requestId: uuid,
          expectedReviewId: uuid.nullable(), contextHash: z.string().regex(/^[0-9a-f]{64}$/),
          decision: z.enum(["confirmed_final", "held"]) }).strict().parse(await deps.readJsonBody(req)) : undefined;
        deps.sendSuccess(res, copyRewardLedgerDocument(await rewardHistoricalSourceV3(identity, config.chainId, draftId, change, deps.rpc)));
        return true;
      }
      if (deposit) {
        const dependencies = { reader: deps.programmeFundingReader, rpc: deps.rpc };
        if (match[2] === "deposit-review") {
          const body = z.object({ amountMon: z.string().max(50) }).strict().parse(await deps.readJsonBody(req));
          deps.sendSuccess(res, await prepareProgrammeDepositQuoteV3(identity, { chainId: config.chainId, draftId }, body.amountMon, dependencies));
        } else {
          const body = z.object({ quote: z.unknown(), transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict().parse(await deps.readJsonBody(req));
          const quote = decodeProgrammeDepositQuoteV3(body.quote);
          if (quote.draftId !== draftId || quote.chainId !== config.chainId) throw new Error("invalid_reward_query");
          deps.sendSuccess(res, await inspectProgrammeDepositV3(identity, quote, body.transactionHash as `0x${string}`, dependencies));
        }
        return true;
      }
      if (match[2] === "funding") {
        const record = await readRewardPlanningDraft(identity, config.chainId, draftId, deps.rpc);
        const view = deps.programmeFundingRegistry ? await readProgrammeFundingViewV3(record, deps.programmeFundingRegistry)
          : await readRegisteredProgrammeFundingV3(identity, record, { reader: deps.programmeFundingReader, rpc: deps.rpc });
        // Authorization and exact revision are rechecked after external chain IO.
        const current = await readRewardPlanningDraft(identity, config.chainId, draftId, deps.rpc);
        if (current.revision !== record.revision) {
          deps.sendError(res, 409, "reward_planning_revision_changed", "Settings changed. Reload before inspecting funding."); return true;
        }
        deps.sendSuccess(res, view); return true;
      }
      if (proposals) {
        const expectation = req.method === "POST" ? freezeRequest.parse(await deps.readJsonBody(req)) : undefined;
        const items = await rewardFrozenProposalsV2(identity, config.chainId, draftId, Number(match[2]!.split("/")[1]), expectation, deps.rpc);
        deps.sendSuccess(res, copyRewardLedgerDocument({ items })); return true;
      }
      if (match[2] === "participation-review") {
        const change = req.method === "POST" ? decodeParticipationReviewChange(await deps.readJsonBody(req)) : undefined;
        deps.sendSuccess(res, await rewardParticipationReview(identity, config.chainId, draftId, change, deps.rpc)); return true;
      }
      if (match[2] === "participation-metrics") {
        const data = await readRewardPublishedPreviewV2(identity, config.chainId, draftId, deps.rpc);
        const metrics = data.snapshot && data.sourceHash ? deriveLeagueParticipationMetrics(data.snapshot, data.sourceHash) : null;
        deps.sendSuccess(res, copyRewardLedgerDocument({ ...data, metrics })); return true;
      }
      if (match[2] === "published-preview") {
        const data = await readRewardPublishedPreviewV2(identity, config.chainId, draftId, deps.rpc);
        let preview = null;
        if (data.snapshot) {
          try { preview = previewPublishedRewardsV2(data.record.rules, historicalMappingOnlyV3(data.workspace.mapping, data.workspace.catalogue), data.snapshot); }
          catch (error) { if (!(error instanceof RewardCalculationError)) throw error; }
        }
        deps.sendSuccess(res, copyRewardLedgerDocument({ ...data, preview })); return true;
      }
      if (match[2]) {
        const record = await readRewardPlanningDraft(identity, config.chainId, draftId, deps.rpc);
        let workspace = await readRewardSourceMappingV2(identity, config.chainId, draftId, deps.rpc);
        if (record.revision !== workspace.rulesRevision) {
          deps.sendError(res, 409, "reward_planning_revision_changed", "Settings changed. Reload the mapping."); return true;
        }
        if (req.method === "PATCH") {
          const body = mappingUpdate.parse(await deps.readJsonBody(req));
          workspace = await saveRewardSourceMappingV2(identity, config.chainId, workspace, body.expectedRevision,
            body.expectedRulesRevision, body.catalogueHash, body.mapping, deps.rpc);
        }
        // Removed source IDs remain inspectable. A stale map never gets a
        // seemingly valid category preview or an automatic replacement.
        let preview = null;
        try { preview = previewRewardSourceMappingV2(record.rules, workspace.mapping, workspace.catalogue); }
        catch (error) { if (!(error instanceof RewardCalculationError)) throw error; }
        deps.sendSuccess(res, copyRewardLedgerDocument({ workspace, preview })); return true;
      }
      let record;
      if (req.method === "PATCH") {
        const body = update.parse(await deps.readJsonBody(req));
        const rules = decodeRewardProgrammeDraftV2(body.rules);
        record = await saveRewardPlanningDraft(identity, config.chainId, draftId, body.expectedRevision, rules, deps.rpc);
      } else record = await readRewardPlanningDraft(identity, config.chainId, draftId, deps.rpc);
      // All displayed amounts are reproducible from the same validated rules;
      // the server response explicitly calls this an unfunded planning preview.
      deps.sendSuccess(res, copyRewardLedgerDocument({ record, preview: previewRewardProgrammeDraftV2(record.rules) }));
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_planning_not_found") deps.sendError(res, 404, code, "Draft not found or no longer accessible.");
    else if (["reward_participation_review_conflict", "reward_participation_source_changed", "reward_participation_source_missing"].includes(String(code)))
      deps.sendError(res, 409, String(code), "Contribution review or source changed. Reload before saving again.");
    else if (code === "invalid_reward_participation_review" || message === "invalid_reward_participation_review")
      deps.sendError(res, 400, "invalid_reward_participation_review", "Check the contribution decisions and their reasons.");
    else if (code === "reward_historical_source_missing") deps.sendError(res, 409, code, "This draft has no eligible imported historical source.");
    else if (code === "reward_historical_review_conflict") deps.sendError(res, 409, code, "Source review changed. Reload before making another decision.");
    else if (code === "reward_continuity_conflict" || code === "reward_continuity_not_ready")
      deps.sendError(res, 409, code, "Reload the finale source and complete the explicit identity and category review.");
    else if (code === "reward_league_policy_conflict") deps.sendError(res, 409, code, "League policy changed. Reload before saving another revision.");
    else if (code === "reward_allocation_upload_not_found") deps.sendError(res, 404, code, "Allocation not found or no longer accessible.");
    else if (code === "reward_allocation_upload_conflict" || code === "reward_allocation_approval_conflict" || code === "reward_allocation_not_ready")
      deps.sendError(res, 409, code, "Reload the exact allocation, source review and verified funding before approval.");
    else if (code === "reward_finale_conflict" || code === "reward_finale_locked") deps.sendError(res, 409, code, "Finale binding changed or deployment is already reserved. Reload before continuing.");
    else if (code === "reward_planning_revision_changed") deps.sendError(res, 409, code, "Another edit was saved. Reload before saving again.");
    else if (code === "reward_programme_approval_required") deps.sendError(res, 409, code, "Programme approval or review policy changed. Reload before continuing.");
    else if (error instanceof z.ZodError || error instanceof RewardCalculationError || ["invalid_reward_query", "invalid_reward_finale", "invalid_reward_league_policy"].includes(message ?? ""))
      deps.sendError(res, 400, "invalid_reward_planning_request", "Check the saved programme, amounts and announced review policy.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Saved reward settings are temporarily unavailable.");
  }
  return true;
}
