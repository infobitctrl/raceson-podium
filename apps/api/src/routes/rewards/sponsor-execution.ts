import type {IncomingMessage, ServerResponse} from "node:http";
import {z} from "zod";
import {rewardSponsorExecution, rewardSponsorLaunch,type RewardLedgerRpc,type RewardAccountIdentity} from "@raceson/db/rewards";
import {createSponsorExecutionPlan, decodeSponsorExecutionPolicy, type SponsorExecutionPolicy} from "@raceson/domain/rewards/sponsor-execution";
import {observeSponsorProgramme, SponsorReceiptError, type SponsorChainReader, type SponsorChainObservation} from "@raceson/rewards-chain/sponsor-v4";
import type {Hex} from "viem";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";
import {advanceSponsorCreation,sponsorCreationStatus,type SponsorCreationDeps} from "../../features/rewards/sponsor-creation-service.js";

const uuid = z.string().uuid();
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(v => BigInt(v) !== 0n);
const command = z.discriminatedUnion("action", [
  z.object({action:z.literal("launch")}).strict(),
  z.object({action:z.literal("retry_creation"),hash}).strict(),
  z.object({action: z.literal("prepare"), launchId: uuid, funder: z.string().regex(/^0x[0-9a-fA-F]{40}$/)}).strict(),
  z.object({action: z.literal("deployment"), hash}).strict(), z.object({action: z.literal("funding"), hash}).strict(),
]);
export type SponsorExecutionDependencies = OrganizerRewardRouteDependencies & {sponsorPolicy?: () => SponsorExecutionPolicy | null; sponsorReader?: SponsorChainReader; creation?:SponsorCreationDeps;resolveCreation?: (identity:Parameters<typeof advanceSponsorCreation>[0],id:string,rpc?:RewardLedgerRpc,protocolVersion?:4|5)=>Promise<SponsorCreationDeps>;resolveSponsorPolicy?:()=>Promise<SponsorExecutionPolicy|null>;resolveRpc?:(identity:RewardAccountIdentity,id:string)=>Promise<RewardLedgerRpc>};

/** Explicit server configuration is an execution gate; no wallet addresses or
 * review policy are guessed from historical pilots. No operator key is loaded. */
export function sponsorExecutionPolicyFromEnv(env: Record<string, string | undefined>) {
  const raw = env.RACESON_SPONSOR_V4_POLICY;
  if (!raw) return null;
  return decodeSponsorExecutionPolicy(JSON.parse(raw));
}
export async function dispatchSponsorExecution(req: IncomingMessage, res: ServerResponse, url: URL, deps: SponsorExecutionDependencies) {
  const match = /^\/api\/v1\/rewards\/distribution-setups\/([^/]+)\/execution$/.exec(url.pathname);
  if (!match) return false;
  deps.applyPrivateSessionHeaders(res);
  if (req.method !== "GET" && req.method !== "POST") {res.setHeader("Allow", "GET, POST"); deps.sendError(res, 405, "method_not_allowed", "Unsupported method."); return true;}
  let submittedReceiptHash: string | null = null;
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req), id = uuid.parse(match[1]);
    if ([...url.searchParams].length) throw Error("invalid_sponsor_execution");
    if(deps.resolveRpc)deps={...deps,rpc:await deps.resolveRpc(identity,id)};
    const action = req.method === "POST" ? command.parse(await deps.readJsonBody(req)) : null;
    if (action?.action === "deployment" || action?.action === "funding") submittedReceiptHash = action.hash;
    const policy = deps.resolveSponsorPolicy?await deps.resolveSponsorPolicy():deps.sponsorPolicy?.() ?? null;
    let record = await rewardSponsorExecution(identity, config.chainId, id, undefined, deps.rpc);
    if (action?.action === "prepare") {
      if (!policy) throw Error("sponsor_execution_not_configured");
      const saved = await rewardSponsorLaunch(identity, config.chainId, id, undefined, deps.rpc);
      if (!saved.launch || saved.launch.id !== action.launchId || saved.launch.setup.revision !== saved.setup.revision) throw Error("reward_setup_conflict");
      record = await rewardSponsorExecution(identity, config.chainId, id, {plan: createSponsorExecutionPlan(saved.launch, action.funder, policy)}, deps.rpc);
    }
    let observation: SponsorChainObservation | null = null;
    let deploymentHash = action?.action === "deployment" ? action.hash : record?.deploymentHash;
    const fundingHash = action?.action === "funding" ? action.hash : record?.fundingHash;
    if((action?.action==="launch"||action?.action==="retry_creation")&&!record)throw Error("invalid_sponsor_execution");
    // A confirmed account is observed from its immutable plan and chain receipt.
    // Creation-provider outages must not block its status or prize deposit.
    if(!record?.deploymentHash&&deps.resolveCreation)deps={...deps,creation:await deps.resolveCreation(identity,id,deps.rpc,record?.plan.version)};
    let creationReady=false;try{if(!record?.deploymentHash&&deps.creation?.signer){await deps.creation.signer.verifyReady?.();creationReady=true;}}catch{/* Fail closed until the actual provider grant and factory are verified. */}
    let creation=(deps.creation||record?.deploymentHash)&&config.chainId===10143?await sponsorCreationStatus(identity,id,record,creationReady,deps.rpc,deps.creation?.signer?.address):undefined;
    const verifyCreation=action?.action==="deployment"&&creation?.hash===action.hash;
    if((action?.action==="launch"||action?.action==="retry_creation"||verifyCreation)&&!record?.deploymentHash){
      if(deps.creation&&config.chainId===10143){
        const advanced=await advanceSponsorCreation(identity,id,record!,{...deps.creation,rpc:deps.rpc},action?.action==="retry_creation"?action.hash:undefined,verifyCreation);
        const {observation:verified,...creationState}=advanced;
        creation=creationState;
        observation=verified??null;
        record=await rewardSponsorExecution(identity,config.chainId,id,undefined,deps.rpc);
        deploymentHash=record?.deploymentHash;
      }else creation={status:"unavailable",reason:"configuration",hash:null};
    }
    if (action && !verifyCreation && !["prepare","launch","retry_creation"].includes(action.action) && (!record || !deploymentHash)) throw Error("invalid_sponsor_execution");
    if (record && deploymentHash) {
      if (!deps.sponsorReader) throw Error("sponsor_observation_unavailable");
      // Confirmation already verified this exact programme in this request.
      // Reuse that evidence only for the same hashes; never across requests.
      if (!observation || observation.deploymentHash !== deploymentHash || (observation.fundingHash ?? null) !== (fundingHash ?? null))
        observation = await observeSponsorProgramme(deps.sponsorReader, record.plan, deploymentHash as Hex, fundingHash as Hex | undefined);
      if (action?.action === "deployment" || action?.action === "funding") {
        record = await rewardSponsorExecution(identity, config.chainId, id, action.action === "deployment" ? {deploymentHash: action.hash} : {fundingHash: action.hash}, deps.rpc);
      } else {
        // Recheck ownership/session after slow chain I/O; observations never replace Auth.
        await rewardSponsorExecution(identity, config.chainId, id, undefined, deps.rpc);
      }
    }
    deps.sendSuccess(res, {enabled: policy !== null, record, observation,...(creation?{creation}:{})});
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code)) deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if(['reward_demo_account_required','reward_demo_sponsor_required'].includes(code))deps.sendError(res,403,'reward_demo_sponsor_required','Use the sponsor account that saved this campaign.');
    else if (code === "reward_setup_not_found") deps.sendError(res, 404, code, "Campaign not found.");
    else if (code === "reward_setup_conflict") deps.sendError(res, 409, code, "A different version or transaction is already saved. Reload this campaign.");
    else if(['reward_launch_sources_required','copy_scope_changed','copy_projection_changed'].includes(code))deps.sendError(res,409,'reward_launch_sources_required','The saved event source could not be verified. Reload the campaign before continuing.');
    else if (code === "sponsor_execution_not_configured") deps.sendError(res, 409, code, "The demo operator and return treasury must be configured before deployment.");
    else if (code === "invalid_sponsor_execution" || error instanceof z.ZodError) deps.sendError(res, 400, "invalid_sponsor_execution", "Check the execution request.");
    else if (submittedReceiptHash && error instanceof SponsorReceiptError && error.transactionHash === submittedReceiptHash) {
      if (error.code === "sponsor_receipt_pending") deps.sendError(res, 425, error.code, "This transaction has no finalized receipt yet. Keep its hash and retry verification; do not send it again.");
      else deps.sendError(res, 422, error.code, "The finalized receipt confirms that this transaction reverted. It did not complete the requested action.");
    }
    else if (submittedReceiptHash && code === "sponsor_chain_verification_failed") deps.sendError(res, 422, "sponsor_receipt_mismatch", "This receipt could not be verified against the saved campaign. Check the transaction hash; no receipt was saved.");
    else deps.sendError(res, 503, "sponsor_observation_unavailable", "Receipt verification is unavailable because a provider or required data read failed. Keep the transaction hash and retry verification; its outcome is unknown.");
  }
  return true;
}
