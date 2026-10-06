import {sponsorClaimFromFactsV4,type SponsorClaimChangeV4} from '../../features/rewards/sponsor-claims-v4-service.js';
import type {hostedCopyNativeClaimFacts,hostedCopyNativeClaimQueue} from '@raceson/db/rewards';
import {hostedCopyResultDisplay} from '../../features/rewards/hosted-copy-result-display.js';
import {rewardResultDisplay} from "../../features/rewards/result-review-display.js";
import {advanceControllerTransaction,controllerTransactionStatus} from "../../features/rewards/controller-transactions.js";
import {controllerDeploymentFromEnv} from "../../features/rewards/sponsor-creation-privy.js";
import type {SponsorCreationDeps} from "../../features/rewards/sponsor-creation-service.js";
import type {IncomingMessage,ServerResponse} from "node:http";
import {z} from "zod";
import {rewardControllerResultDisplay,rewardControllerFacts,decodeSponsorLifecycleFactsV4,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from "@raceson/db/rewards";
import {decodeSponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";
import {observeSponsorProgramme} from "@raceson/rewards-chain/sponsor-v4";
import {observeSponsorLifecycleV4,verifySponsorActionReceiptV4,sponsorLifecycleDataV4,sponsorLifecycleCommitmentV4} from "@raceson/rewards-chain/sponsor-lifecycle-v4";
import {canonicalRewardJson as canonical} from "@raceson/rewards-chain";
import {sponsorLifecycleInputV4} from "../../features/rewards/sponsor-lifecycle-v4-service.js";
import {authenticateController,type ControllerPolicy} from "../../features/rewards/controller-auth.js";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";
import type {Hex} from "viem";
import type {SponsorCreationSigner} from "../../features/rewards/sponsor-creation-service.js";

const uuid=z.string().uuid(), hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const receipt=z.object({requestId:uuid,transactionHash:hash,operation:z.enum(["deployment","upload","stage","activate"]),start:z.number().int().min(0).max(10000),end:z.number().int().min(0).max(10000)}).strict();
type Deps=Omit<OrganizerRewardRouteDependencies,"requireIdentity"> & {controllerPolicy:(token?:string)=>ControllerPolicy|null|Promise<ControllerPolicy|null>; requireToken:(r:IncomingMessage)=>Promise<string>; reader?:SponsorCreationDeps["reader"];creationSigner?:SponsorCreationSigner|null;
 resolveRpc?:(actor:{subject:string;wallet:string})=>RewardLedgerRpc;
 resolveNativeClaimQueue?:(actor:{subject:string;wallet:string},id:string,after:string|null)=>ReturnType<typeof hostedCopyNativeClaimQueue>;
 resolveNativeClaimFacts?:(actor:{subject:string;wallet:string},id:string)=>ReturnType<typeof hostedCopyNativeClaimFacts>};
export async function dispatchRewardController(req:IncomingMessage,res:ServerResponse,url:URL,deps:Deps) {
  const m=/^\/api\/v1\/rewards\/control(?:\/(access|session|campaigns|transactions|claims)(?:\/([0-9a-f-]+)(?:\/allocations\/([0-9a-f-]+))?)?)?$/.exec(url.pathname);
  if(!m)return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");deps.sendError(res,405,"method_not_allowed","Unsupported method.");return true;}
    if([...url.searchParams].length&&!(m[1]==="claims"&&!m[2]))throw Error("controller_invalid_request");
    if(req.headers.origin && req.headers.origin!==deps.config()?.origin)throw Error("Untrusted browser origin");
    if(deps.config()?.chainId!==10143)throw Error("controller_not_configured");
    const token=await deps.requireToken(req);
    const config=await deps.controllerPolicy(token);if(!config)throw Error("controller_not_configured");
    const actor=await authenticateController(token,config);
    const rpc=deps.resolveRpc?deps.resolveRpc(actor):deps.rpc;
    const assertActive=async()=>{
      const current=await deps.controllerPolicy(token);
      if(!current||canonical(current)!==canonical(config))throw Error("controller_auth_required");
      await authenticateController(token,current);
    };
    if(m[1]==="claims"){
      if(!m[2]){
        if(req.method!=='GET'||!deps.resolveNativeClaimQueue)throw Error('controller_invalid_request');
        const q=z.object({approvalId:uuid,after:uuid.optional()}).strict().parse(Object.fromEntries(url.searchParams));
        if([...url.searchParams.keys()].length!==Object.keys(q).length)throw Error('controller_invalid_request');
        const page=await deps.resolveNativeClaimQueue(actor,q.approvalId,q.after??null);
        await assertActive();deps.sendSuccess(res,page);return true;
      }
      if(!m[2]||m[3]||!deps.resolveNativeClaimFacts)throw Error('controller_invalid_request');
      const id=uuid.parse(m[2]);
      const change=req.method==='POST'?z.discriminatedUnion('action',[
        z.object({action:z.literal('operator'),signature:z.string().regex(/^0x[0-9a-f]{130}$/)}).strict(),
        z.object({action:z.literal('receipt'),transactionHash:hash}).strict(),
      ]).parse(await deps.readJsonBody(req)):undefined;
      const facts=deps.resolveNativeClaimFacts(actor,id);
      const view=await sponsorClaimFromFactsV4({chainId:10143,claimId:id,role:'operator'},change as SponsorClaimChangeV4|undefined,{
        origin:deps.config()!.origin,reader:deps.reader,readFacts:async write=>{await assertActive();return facts(write);},
      });
      await assertActive();deps.sendSuccess(res,view);return true;
    }
    if(m[1]==="transactions"&&!m[2]){
      if(!deps.reader)throw Error("controller_chain_unavailable");
      const d={actor,reader:deps.reader,rpc,assertActive};
      deps.sendSuccess(res,req.method==="GET"?await controllerTransactionStatus(d):await advanceControllerTransaction(d,await deps.readJsonBody(req)));return true;
    }
    if(m[1]==="access"&&!m[2]&&req.method==="GET") {
      // Distribution access does not depend on the separate deployment service.
      // The existing /session endpoint still verifies its settings on demand.
      await assertActive();deps.sendSuccess(res,{subject:actor.subject,wallet:actor.wallet,chainId:10143});return true;
    }
    if(m[1]==="session"&&!m[2]&&req.method==="GET") {
      const gasAddress=deps.creationSigner?.address??null;
      let configured=false;try{if(deps.creationSigner){await deps.creationSigner.verifyReady?.();configured=true;}}catch{/* Unverified delegation stays unavailable. */}
      const setup=controllerDeploymentFromEnv(process.env);
      let balanceWei:string|null=null;
      if(gasAddress&&deps.reader){try{if(await deps.reader.getChainId()===10143){const value=await deps.reader.getBalance({address:gasAddress as Hex});if(await deps.reader.getChainId()===10143)balanceWei=String(value);}}catch{/* Service availability is independent of a balance read. */}}
      await assertActive();
      deps.sendSuccess(res,{subject:actor.subject,wallet:actor.wallet,chainId:10143,
        ...(deps.creationSigner!==undefined?{creation:{configured,address:gasAddress,balanceWei,...(setup&&setup.address===actor.wallet&&gasAddress===actor.wallet?{setup:{factory:setup.factory,signerId:setup.signerId,policyId:setup.policyId}}:{})}}:{})});return true;
    }
    if(m[1]!=="campaigns")throw Error("controller_invalid_request");
    const scope:{setupId?:string;approvalId?:string}=m[2]?{setupId:uuid.parse(m[2]),...(m[3]?{approvalId:uuid.parse(m[3])}:{})}:{};
    if(req.method==="POST"&&!scope.setupId)throw Error("controller_invalid_request");
    const change=req.method==="POST"?receipt.parse(await deps.readJsonBody(req)):undefined;
    let raw=await rewardControllerFacts(actor,scope,undefined,rpc);
    if(!scope.setupId){await assertActive();deps.sendSuccess(res,raw);return true;}
    if(!scope.approvalId){
      let record=decodeSponsorExecutionRecord(raw);if(!record||record.plan.operator!==actor.wallet)throw Error("controller_scope_required");
      if(change&&change.operation!=="deployment")throw Error("controller_invalid_request");
      const deployment=(change?.transactionHash??record.deploymentHash) as Hex|null;
      const observation=deployment&&deps.reader?await observeSponsorProgramme(deps.reader,record.plan,deployment,record.fundingHash as Hex|undefined):null;
      if(change){
        if(!observation)throw Error("controller_chain_unavailable");
        await assertActive();
        raw=await rewardControllerFacts(actor,scope,{requestId:change.requestId,receipt:{action:"deployment",transactionHash:change.transactionHash}},rpc);
        record=decodeSponsorExecutionRecord(raw);
      }
      await assertActive();await rewardControllerFacts(actor,scope,undefined,rpc);
      deps.sendSuccess(res,{enabled:true,record,observation});return true;
    }
    if(change?.operation==="deployment")throw Error("controller_invalid_request");
    // Slot is read from the immutable handoff, never supplied by the browser.
    const slot=z.object({upload:z.object({document:z.object({slot:z.number().int().min(0).max(5)})})}).parse(raw).upload.document.slot;
    const selected={chainId:10143 as const,setupId:scope.setupId,approvalId:scope.approvalId,slot};
    let facts=decodeSponsorLifecycleFactsV4(raw,selected);
    if(!facts.publication?.current||!facts.upload.current||facts.upload.execution.plan.operator!==actor.wallet)throw Error("controller_source_not_ready");
    if(!deps.reader)throw Error("controller_chain_unavailable");
    const binding=sponsorLifecycleInputV4(facts);
    if(change){
      const body=await verifySponsorActionReceiptV4(deps.reader,binding,{action:change.operation as "upload"|"stage"|"activate",start:change.start,end:change.end},change.transactionHash as Hex);
      await assertActive();
      raw=await rewardControllerFacts(actor,scope,{requestId:change.requestId,receipt:copy(body)},rpc);
      facts=decodeSponsorLifecycleFactsV4(raw,selected);
    }
    const observed=await observeSponsorLifecycleV4(deps.reader,binding);
    const fresh=decodeSponsorLifecycleFactsV4(await rewardControllerFacts(actor,scope,undefined,rpc),selected);
    if(canonical(fresh.upload)!==canonical(facts.upload)||canonical(fresh.publication)!==canonical(facts.publication))throw Error("controller_source_not_ready");
    await assertActive();
    const transaction=observed.next?{binding,chainId:10143,from:actor.wallet,to:binding.campaignAddress,value:"0",action:observed.next,
      start:observed.start,end:observed.end,data:sponsorLifecycleDataV4(binding,observed.next,observed.start,observed.end),allocationDigest:sponsorLifecycleCommitmentV4(binding).allocationDigest}:null;
    let results;
    if(fresh.upload.document.schema==='podium-copy-allocation-document-v1')results=hostedCopyResultDisplay(fresh.upload.document);
    else{
      const display=await rewardControllerResultDisplay(actor,{setupId:scope.setupId,approvalId:scope.approvalId},rpc);
      if(display.documentHash!==fresh.upload.documentHash)throw Error('controller_source_not_ready');
      results=rewardResultDisplay(fresh.upload.document,display.snapshot);
    }
    await assertActive();
    const labels=new Map<string,string>();
    const labelNodes=(node:typeof fresh.upload.document.launch.setup.configuration.root)=>{labels.set(node.id,node.name);node.children.forEach(labelNodes);};
    labelNodes(fresh.upload.document.launch.setup.configuration.root);
    deps.sendSuccess(res,copy({schema:"raceson-sponsor-lifecycle-view-v4",approvalId:scope.approvalId,slot,current:true,
      publicationHash:fresh.publication!.bodyHash,publication:{id:fresh.publication!.id,timing:fresh.publication!.body.timing},pot:observed.pot,transaction,receipts:fresh.receipts,
      observedBlock:{number:observed.observation.blockNumber,hash:observed.observation.blockHash,timestamp:observed.observation.blockTimestamp},
      review:{results,budgetWei:fresh.upload.document.calculation.budgetWei,allocatedWei:fresh.upload.document.calculation.proposedWei,
        retainedWei:fresh.upload.document.calculation.retainedWei,recipientCount:fresh.upload.recipients.length,documentHash:fresh.upload.documentHash,
        groups:fresh.upload.document.calculation.groups.map(g=>{const id='nodeId' in g?g.nodeId:g.groupId;return {id,name:labels.get(id)??g.type,amountWei:g.proposedWei,recipientCount:g.awards.length};})}}));
  } catch(error){
    const code=error instanceof Error?error.message:"";
    if(["controller_auth_required","Missing bearer token","Unauthorized"].includes(code))deps.sendError(res,401,"controller_auth_required","Sign in with the designated controller Privy account.");
    else if(code==='reward_claim_scope_required')deps.sendError(res,404,code,'Claim not found for this controller.');
    else if(['reward_sponsor_claim_conflict','reward_sponsor_claim_not_ready','reward_planning_revision_changed','reward_recipient_consent_required'].includes(code))deps.sendError(res,409,code,'Refresh the exact claim before continuing.');
    else if(code==='invalid_sponsor_claim')deps.sendError(res,400,code,'Check the claim request.');
    else if(code==="controller_not_configured")deps.sendError(res,503,code,"Controller access has not been configured yet.");
    else if(code==="Untrusted browser origin"||code==="controller_scope_required")deps.sendError(res,403,"controller_scope_required","This controller cannot access this campaign.");
    else if(code==="controller_source_not_ready"||code==="controller_receipt_conflict")deps.sendError(res,409,code,"Official results or allocation changed. Refresh before continuing.");
    else if(code==="controller_gas_limit")deps.sendError(res,409,code,"Estimated gas exceeds the controller transaction safety limit.");
    else if(["controller_transaction_pending","controller_confirmation_required","controller_balance_required","controller_transaction_reverted"].includes(code))deps.sendError(res,409,code,"Review the pending controller transaction before continuing.");
    else if(error instanceof z.ZodError||code==="controller_invalid_request")deps.sendError(res,400,"controller_invalid_request","Invalid controller request.");
    else deps.sendError(res,503,"controller_unavailable","Status could not be verified. Keep any transaction hash and retry verification.");
  }
  return true;
}
