import {reviewerSponsorPolicy,reviewerWalletSummary} from './features/rewards/reviewer-operator.js';
import {dispatchDemoAccountSignIn} from './routes/rewards/demo-account-sign-in.js';
import {dispatchHostedCopyClubClaims} from './routes/rewards/hosted-copy-club-claims.js';
import {dispatchHostedCopyClubCreation} from './routes/rewards/hosted-copy-club-creation.js';
import {dispatchHostedCopyClaims} from './routes/rewards/hosted-copy-claims.js';
import {dispatchHostedCopyReviews} from './routes/rewards/hosted-copy-reviews.js';
import {hostedCopyNativeClubClaimQueue,hostedCopyNativeClubClaimFacts,hostedCopyNativeClaimQueue,hostedCopyNativeClaimFacts,hostedCopyBeneficiaryWalletRpc,hostedCopyClubWalletRpc} from '@raceson/db/rewards';
import {dispatchHostedCopyCatalogue} from './routes/rewards/hosted-copy-catalogue.js';
import { dispatchHostedCopyAllocation } from "./routes/rewards/hosted-copy-allocation.js";
import { dispatchHostedCopySponsor } from "./routes/rewards/hosted-copy-sponsor.js";
import {dispatchRewardOperations} from './routes/rewards/operations.js';
import { dispatchHostedCopyPreview } from './routes/rewards/hosted-copy-preview.js';
import { hostedCopyPreviewEnabled, hostedCopyRequestAllowed,hostedCopyOperationsEnabled,hostedCopyPin } from './features/rewards/hosted-copy-preview.js';
import {dispatchHostedCopyLaunch} from './routes/rewards/hosted-copy-launch.js';
import {hostedCopySponsor,hostedCopySponsorExecutionRpc,hostedCopyControllerRpc,hostedCopyPublicRpc,hostedCopyBrandingRpc,type RewardLedgerRpc} from '@raceson/db/rewards';
import {dispatchCampaignBranding} from './routes/rewards/campaign-branding.js';
import {dispatchWalletAdministration} from './routes/rewards/wallet-administration.js';
import {resolveControllerPolicy} from './features/rewards/wallet-administration.js';
import {resolveDeploymentSigner} from './features/rewards/wallet-runtime.js';
import {dispatchPublicDirectory} from "./routes/rewards/public-directory.js";
import {dispatchPublicCampaign} from "./routes/rewards/public-campaign.js";
import {dispatchRewardController} from "./routes/rewards/controller.js";
import {dispatchSponsorClubClaimsV4} from "./routes/rewards/sponsor-club-claims-v4.js";
import {dispatchSponsorClaimsV4} from "./routes/rewards/sponsor-claims-v4.js";
import {dispatchSponsorAllocationV4} from "./routes/rewards/sponsor-allocation-v4.js";
import {dispatchSponsorExecution, sponsorExecutionPolicyFromEnv} from "./routes/rewards/sponsor-execution.js";
import {dispatchSponsorLaunch} from "./routes/rewards/sponsor-launch.js";
import {dispatchSponsorSourceV4} from "./routes/rewards/sponsor-source-v4.js";
import {dispatchSetupEvents} from "./routes/rewards/setup-events.js";
import { dispatchDistributionSetups } from "./routes/rewards/distribution-setups.js";
import { dispatchProgrammeCreation } from "./routes/rewards/programme-creation.js";
import { dispatchTestProgrammes } from "./routes/rewards/test-programmes.js";
import { dispatchPublicRewardReport, type PublicRewardReportReader } from "./routes/rewards/public-report.js";
import { dispatchWorkflowV3, type WorkflowHostV3, type WorkflowEndpointV3 } from "./routes/rewards/workflow-v3.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadServerEnv,createAdminSupabaseClient } from "@raceson/db";
import { handleApiRequest, type ApiRouteExtension } from "./server.js";
import { dispatchAthleteRewardRoutes } from "./routes/rewards/athlete.js";
import { dispatchAthleteReadinessV3 } from "./routes/rewards/athlete-readiness-v3.js";
import { dispatchClubReadinessV3 } from "./routes/rewards/club-readiness-v3.js";
import { dispatchClubAllocationsV3 } from "./routes/rewards/club-allocations-v3.js";
import { dispatchOrganizerClubAwardsV3 } from "./routes/rewards/organizer-club-awards-v3.js";
import { dispatchAthleteClaimsV3 } from "./routes/rewards/athlete-claims-v3.js";
import { dispatchClubClaimsV3 } from "./routes/rewards/club-claims-v3.js";
import { dispatchClubPaymentActionsV3 } from "./routes/rewards/club-payment-actions-v3.js";
import { dispatchPaymentActionsV3 } from "./routes/rewards/athlete-payment-actions-v3.js";
import { dispatchLeaguePublicationV3 } from "./routes/rewards/league-publication-v3.js";
import { dispatchFinalAllocationV3 } from "./routes/rewards/final-allocation-v3.js";
import { dispatchFinalAllocationActionsV3 } from "./routes/rewards/final-allocation-actions-v3.js";
import { dispatchFinalPublicationV3 } from "./routes/rewards/final-publication-v3.js";
import { dispatchOrganizerRewardRoutes } from "./routes/rewards/organizer.js";
import { dispatchClubRewardRoutes } from "./routes/rewards/clubs.js";
import { dispatchRewardPlanningRoutes } from "./routes/rewards/planning.js";
import { dispatchProgrammeApprovalV3 } from "./routes/rewards/programme-approval-v3.js";
import { dispatchProgrammeActionsV3 } from "./routes/rewards/programme-actions-v3.js";
import { dispatchRoundPublicationV3 } from "./routes/rewards/round-publication-v3.js";
import { dispatchCanaryStatusRoute } from "./routes/rewards/canary.js";
import { dispatchFinalResultsCanaryStatusRoute } from "./routes/rewards/final-results-canary.js";
import { dispatchRewardResultReviewV3 } from "./routes/rewards/result-review-v3.js";
import { authenticateRewardRequest, rewardPortalConfig } from "./features/rewards/request-identity.js";
import { canaryPublicClient, controllerPublicClient } from "@raceson/rewards-chain/canary-public-client";
import { programmeLocalReader } from "./features/rewards/programme-local-reader.js";
import { dispatchPilotAcceptanceV3, type LocalPilotRunnerV3 } from "./routes/rewards/pilot-acceptance-v3.js";

const rewardRoutes = (localPilot?: LocalPilotRunnerV3, workflow?: WorkflowEndpointV3, publicReport?: PublicRewardReportReader): ApiRouteExtension => async (req, res, url, boundary) => {
  const deps = {
  config: () => rewardPortalConfig(process.env, boundary.env),
  requireIdentity: async (request) => authenticateRewardRequest(await boundary.requireAccessToken(request), boundary.env),
  readJsonBody: boundary.readJsonBody, sendSuccess: boundary.sendSuccess,
  sendError: boundary.sendError, applyPrivateSessionHeaders: boundary.applyPrivateSessionHeaders,
  } satisfies Parameters<typeof dispatchAthleteRewardRoutes>[3];
  const config = deps.config();
  if (await dispatchDemoAccountSignIn(req,res,url,{...deps,config,env:boundary.env,enabled:hostedCopyPreviewEnabled(process.env,boundary.env)})) return true;
  const copiedPublic=hostedCopyPreviewEnabled(process.env,boundary.env)?{
    publicRpc:hostedCopyPublicRpc((name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args)),
    resolvePublicationRpc:(identity:import('@raceson/db/rewards').RewardAccountIdentity,id:string)=>hostedCopyPublicRpc((name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args),identity,id),
    resolveSponsorRpc:async(identity:import('@raceson/db/rewards').RewardAccountIdentity,id:string)=>{
      const rpc:RewardLedgerRpc=(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args);
      const preflight=await hostedCopySponsor(identity,'read',id,undefined,hostedCopyPin,rpc);
      return hostedCopySponsorExecutionRpc(identity,id,rpc,preflight.sourceFingerprint);
    },
  }:{};
  if(hostedCopyOperationsEnabled(process.env,boundary.env)&&await dispatchHostedCopyClubCreation(req,res,url,{...deps,creationReader:config?.chainId===10143?canaryPublicClient:undefined}))return true;
  if(hostedCopyOperationsEnabled(process.env,boundary.env)&&await dispatchHostedCopyClubClaims(req,res,url,{...deps,sponsorReader:config?.chainId===10143?canaryPublicClient:undefined}))return true;
  if(hostedCopyOperationsEnabled(process.env,boundary.env)&&await dispatchHostedCopyClaims(req,res,url,{...deps,sponsorReader:config?.chainId===10143?canaryPublicClient:undefined}))return true;
  if(hostedCopyOperationsEnabled(process.env,boundary.env)&&await dispatchAthleteRewardRoutes(req,res,url,{...deps,
    resolveRpc:identity=>hostedCopyBeneficiaryWalletRpc(identity,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args))}))return true;
  if(hostedCopyOperationsEnabled(process.env,boundary.env)&&await dispatchClubRewardRoutes(req,res,url,{...deps,
    resolveRpc:identity=>hostedCopyClubWalletRpc(identity,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args))}))return true;
  if (await dispatchHostedCopyReviews(req,res,url,{...deps,sponsorReader:config?.chainId===10143?canaryPublicClient:undefined,publicationReader:config?.chainId===10143?controllerPublicClient:undefined,resolveReviewerWallet:identity=>reviewerWalletSummary(identity,process.env,address=>controllerPublicClient.getBalance({address:address as `0x${string}`,blockTag:'latest'}))}))return true;
  if (await dispatchHostedCopyCatalogue(req, res, url, deps)) return true;
  if (await dispatchHostedCopyAllocation(req, res, url, deps)) return true;
  if (await dispatchHostedCopySponsor(req, res, url, deps)) return true;
  if (await dispatchHostedCopyLaunch(req,res,url,deps))return true;
  if (await dispatchHostedCopyPreview(req, res, url, deps)) return true;
  if (await dispatchWalletAdministration(req,res,url,deps)) return true;
  if (await dispatchRewardOperations(req,res,url,deps)) return true;
  if (url.pathname.startsWith('/api/v1/rewards/control') && await dispatchRewardController(req,res,url,{...deps,requireToken:async request=>{const token=/^Bearer ([^\s]+)$/i.exec(request.headers.authorization??"")?.[1];if(!token)throw Error("Missing bearer token");return token;},
    ...(hostedCopyOperationsEnabled(process.env,boundary.env)?{resolveRpc:(actor:{subject:string;wallet:string})=>hostedCopyControllerRpc(actor,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args)),resolveNativeClubClaimQueue:(actor:{subject:string;wallet:string},id:string,after:string|null)=>hostedCopyNativeClubClaimQueue(actor,id,after,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args)),resolveNativeClubClaimFacts:(actor:{subject:string;wallet:string},id:string)=>hostedCopyNativeClubClaimFacts(actor,id,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args)),clubReader:canaryPublicClient,resolveNativeClaimQueue:(actor:{subject:string;wallet:string},id:string,after:string|null)=>hostedCopyNativeClaimQueue(actor,id,after,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args)),resolveNativeClaimFacts:(actor:{subject:string;wallet:string},id:string)=>hostedCopyNativeClaimFacts(actor,id,(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args))}:{}),
    controllerPolicy:token=>resolveControllerPolicy(process.env,token??'',typeof req.headers['x-podium-controller-wallet']==='string'?req.headers['x-podium-controller-wallet']:undefined),creationSigner:await resolveDeploymentSigner(process.env),reader:config?.chainId===10143?controllerPublicClient:undefined})) return true;
  if (await dispatchCampaignBranding(req,res,url,{...deps,...(hostedCopyOperationsEnabled(process.env,boundary.env)?{
    resolveRpc:(identity?:import('@raceson/db/rewards').RewardAccountIdentity)=>hostedCopyBrandingRpc((name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args),identity),
  }: {})})) return true;
  if (await dispatchPublicDirectory(req,res,url,{...deps,...copiedPublic,awaitRefresh:hostedCopyOperationsEnabled(process.env,boundary.env),sponsorReader:config?.chainId===10143?controllerPublicClient:config?.chainId===31337?programmeLocalReader:undefined})) return true;
  if (await dispatchPublicCampaign(req,res,url,{...deps,...copiedPublic,sponsorReader:config?.chainId===10143?controllerPublicClient:config?.chainId===31337?programmeLocalReader:undefined})) return true;
  if (await dispatchSetupEvents(req, res, url, deps)) return true;
  if (await dispatchSponsorSourceV4(req, res, url, deps)) return true;
  if (await dispatchSponsorClubClaimsV4(req, res, url, {...deps, sponsorReader: config?.chainId === 10143 ? canaryPublicClient : config?.chainId === 31337 ? programmeLocalReader : undefined})) return true;
  if (await dispatchSponsorClaimsV4(req, res, url, {...deps, sponsorReader: config?.chainId === 10143 ? canaryPublicClient : config?.chainId === 31337 ? programmeLocalReader : undefined})) return true;
  if (await dispatchSponsorAllocationV4(req, res, url, {...deps, sponsorReader: config?.chainId === 10143 ? canaryPublicClient : config?.chainId === 31337 ? programmeLocalReader : undefined})) return true;
  if (await dispatchSponsorLaunch(req, res, url, deps)) return true;
  if (await dispatchSponsorExecution(req, res, url, {...deps, sponsorPolicy: () => sponsorExecutionPolicyFromEnv(process.env),
    resolveSponsorPolicy:async()=>config?.chainId===10143?reviewerSponsorPolicy(sponsorExecutionPolicyFromEnv(process.env),process.env):sponsorExecutionPolicyFromEnv(process.env),
    sponsorReader: config?.chainId === 10143 ? canaryPublicClient : config?.chainId === 31337 ? programmeLocalReader : undefined,
    ...(hostedCopyOperationsEnabled(process.env,boundary.env)?{resolveRpc:async(identity,id)=>{
      const rpc:RewardLedgerRpc=(name,args)=>createAdminSupabaseClient(boundary.env).rpc(name,args);
      const preflight=await hostedCopySponsor(identity,'read',id,undefined,hostedCopyPin,rpc);
      return hostedCopySponsorExecutionRpc(identity,id,rpc,preflight.sourceFingerprint);
    }}:{}),
    ...(config?.chainId===10143?{resolveCreation:async(identity,id,rpc)=>({reader:canaryPublicClient,signer:await resolveDeploymentSigner(process.env,identity,id,rpc,undefined)})}:{})})) return true;
  if (await dispatchDistributionSetups(req, res, url, deps)) return true;
  if (await dispatchProgrammeCreation(req, res, url, deps)) return true;
  if (await dispatchTestProgrammes(req, res, url, deps)) return true;
  if (await dispatchPublicRewardReport(req, res, url, deps, publicReport)) return true;
  if (await dispatchWorkflowV3(req, res, url, deps, workflow)) return true;
  if (await dispatchPilotAcceptanceV3(req, res, url, deps, localPilot)) return true;
  if (await dispatchClubAllocationsV3(req, res, url, deps)) return true;
  if (await dispatchOrganizerClubAwardsV3(req, res, url, deps)) return true;
  if (await dispatchAthleteReadinessV3(req, res, url, deps)) return true;
  if (await dispatchRoundPublicationV3(req, res, url, deps)) return true;
  const planningDeps = { ...deps, programmeFundingReader: config?.chainId === 10143 ? canaryPublicClient : config?.chainId === 31337 ? programmeLocalReader : undefined };
  if (await dispatchClubReadinessV3(req, res, url, { ...deps, clubReaderV3: planningDeps.programmeFundingReader })) return true;
  if (await dispatchAthleteClaimsV3(req, res, url, { ...deps, claimV3Reader: planningDeps.programmeFundingReader })) return true;
  if (await dispatchClubClaimsV3(req, res, url, { ...deps, clubClaimV3Reader: planningDeps.programmeFundingReader })) return true;
  if (await dispatchClubPaymentActionsV3(req, res, url, { ...deps, clubPaymentReaderV3: planningDeps.programmeFundingReader })) return true;
  if (await dispatchPaymentActionsV3(req, res, url, { ...deps, paymentReaderV3: planningDeps.programmeFundingReader })) return true;
  if (await dispatchLeaguePublicationV3(req, res, url, deps)) return true;
  if (await dispatchFinalAllocationV3(req, res, url, planningDeps)) return true;
  if (await dispatchFinalAllocationActionsV3(req, res, url, planningDeps)) return true;
  if (await dispatchFinalPublicationV3(req, res, url, deps)) return true;
  if (await dispatchProgrammeActionsV3(req, res, url, { ...deps, programmeActionReader: planningDeps.programmeFundingReader })) return true;
  return await dispatchProgrammeApprovalV3(req, res, url, deps) || await dispatchRewardResultReviewV3(req, res, url, deps) || await dispatchFinalResultsCanaryStatusRoute(req, res, url, deps) || await dispatchCanaryStatusRoute(req, res, url, deps) || await dispatchRewardPlanningRoutes(req, res, url, planningDeps) || await dispatchAthleteRewardRoutes(req, res, url, deps) || await dispatchOrganizerRewardRoutes(req, res, url, deps)
    || await dispatchClubRewardRoutes(req, res, url, deps);
};

/** Separate application entry point. Validate even health/core routes so a demo
 * artifact with missing configuration cannot fall back to the ordinary portal. */
export async function handleRewardDemoApiRequest(req: IncomingMessage, res: ServerResponse<IncomingMessage>, localPilot?: LocalPilotRunnerV3, workflow?: WorkflowEndpointV3, publicReport?: PublicRewardReportReader) {
  try {
    if (!rewardPortalConfig(process.env, loadServerEnv())) throw new Error("demo_not_configured");
    const hostedOperations=hostedCopyOperationsEnabled(process.env,loadServerEnv());
    if (hostedCopyPreviewEnabled(process.env, loadServerEnv()) && !hostedCopyRequestAllowed(req.method, new URL(req.url ?? "/", "https://podium.invalid"), process.env.RACESON_REWARD_HOSTED_COPY_MODE,hostedOperations)) {
      res.statusCode = 403;
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "hosted_preview_only", message: "This demo currently supports sign-in and result previews only." } }));
      return;
    }
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { code: "reward_demo_configuration_required", message: "The isolated demo is not configured." } }));
    return;
  }
  await handleApiRequest(req, res, rewardRoutes(localPilot, workflow, publicReport), "sponsor");
}

// Host composition only; importing the demo API never starts a worker or loads a key.
export { createWorkflowRuntimeV3 } from "./features/rewards/workflow-v3-service.js";
export { createReadOnlyWorkflowHostV3, createWorkflowHostControllerV3 } from "./features/rewards/workflow-v3-host.js";
export { createWorkflowBridgeV3, startWorkflowIpcV3 } from "./features/rewards/workflow-v3-ipc.js";
export { WorkflowScheduleStoreV3, startWorkflowSchedulerV3, runWorkflowSchedulerPassV3 } from "./features/rewards/workflow-v3-scheduler.js";
export type { WorkflowHostV3, WorkflowEndpointV3 };
