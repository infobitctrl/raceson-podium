import {sponsorClaimFactsV4,copyRewardLedgerDocument as copy,decodeRewardReadinessAttestationV3,requireReadinessPolicyChainV3,
 sponsorAllocationDocumentHashV4 as digest,RewardLedgerStoreError,type RewardAccountIdentity,type RewardLedgerRpc,type SponsorClaimScopeV4} from "@raceson/db/rewards";
import {canonicalRewardJson as canonical,verifyRewardWalletControl,type RewardClaim,type RewardPublicAward} from "@raceson/rewards-chain";
import {sponsorLifecycleCommitmentV4, type SponsorLifecycleInputV4,type SponsorPublicationV4} from "@raceson/rewards-chain/sponsor-lifecycle-v4";
import {readSponsorAthleteClaimV4} from "@raceson/rewards-chain/sponsor-claim-reader-v4";
import {sponsorClaimMessagesV4,verifySponsorClaimProofV4,encodeSponsorClaimV4} from "@raceson/rewards-chain/sponsor-claims-v4";
import {observeSponsorProgrammePot,type SponsorChainReader} from "@raceson/rewards-chain/sponsor-v4";
import {parseAbi,type Hex} from "viem";
type Facts=Awaited<ReturnType<typeof sponsorClaimFactsV4>>&{rehearsalPolicy?:"podium-demo-alias-rehearsal-v1"|null};
type Deps={rpc?:RewardLedgerRpc;reader?:SponsorChainReader;origin:string};
function check(v:unknown,code="reward_sponsor_claim_not_ready"):asserts v{if(!v)throw new RewardLedgerStoreError(code);}
export type SponsorClaimChangeV4={action:"request";approvalId:string;entitlementId:Hex;destinationId:string}|{action:"prepare";sourceStamp:string;profileFingerprint:string;attestation:unknown}
 |{action:"recipient"|"operator";signature:Hex}|{action:"receipt";transactionHash:Hex}|{action:"revoke"};
export function sponsorClaimBindingV4(f:Facts){
 const p=f.package,b=f.publication,t=b.timing as SponsorPublicationV4;
 check(p.approvalId===f.approvalId&&p.slot===f.slot&&p.chainId===f.plan.chainId&&b.approvalId===f.approvalId&&b.packageHash===f.packageHash
  &&t.publicationEvidenceHash===`0x${digest(b.evidence)}`);
 const i:SponsorLifecycleInputV4={plan:f.plan,slot:f.slot,deploymentHash:p.deploymentHash as Hex,fundingHash:p.fundingHash as Hex,campaignAddress:p.campaignAddress as Hex,
  snapshotDigest:p.snapshotDigest as Hex,publication:t,awards:(p.awards as {amount:string}[]).map(a=>({...a,amount:BigInt(a.amount)} as RewardPublicAward))};
 const allocation=sponsorLifecycleCommitmentV4(i);check(allocation.uploadDigest===p.uploadDigest&&allocation.entitlementCount.toString()===p.entitlementCount);
 const context={environment:f.plan.chainId===31337?"local-simulation" as const:"monad-testnet" as const,chainId:f.plan.chainId,verifyingContract:i.campaignAddress};
 return{i,allocation,context};
}
function intent(f:Facts){
 const b=f.events.intent as {claim:Record<string,string>;sourceStamp:string;profileFingerprint:string;witness:{finalizedBlock:{number:string;hash:Hex;timestamp:string}}}|undefined;
 if(!b)return null;const c=b.claim;
 const claim:RewardClaim={entitlementId:c.entitlementId as Hex,recipient:c.recipient as Hex,amount:BigInt(c.amount!),pot:c.pot as "race"|"league",nonce:BigInt(c.nonce!),issuedAt:BigInt(c.issuedAt!),expiresAt:BigInt(c.expiresAt!),allocationDigest:c.allocationDigest as Hex};
 const binding=sponsorClaimBindingV4(f),award=binding.allocation.awards.find(a=>a.entitlementId===claim.entitlementId);
 check(award&&award.beneficiaryKind===0&&award.amount===claim.amount&&claim.recipient===f.destination.address&&claim.pot===(f.slot===0?"league":"race")&&claim.allocationDigest===binding.allocation.allocationDigest);
 sponsorClaimMessagesV4(binding.context,claim);return{...binding,body:b,claim};
}
async function wallet(f:Facts,origin:string){const c=f.challenge;check(c.proof&&c.origin===origin&&c.address===f.destination.address&&c.chainId===f.plan.chainId);
 const p=await verifyRewardWalletControl(c,c.proof.signature);check(p.messageHash===c.proof.messageHash);}
async function proofs(f:Facts){const p=intent(f);if(!p)return null;
 for(const role of ["recipient","operator"] as const){const v=f.events[role] as {signature:Hex}|undefined;if(v){const verified=await verifySponsorClaimProofV4(p.context,p.claim,role,f.plan.operator as Hex,v.signature);check(canonical(verified)===canonical(v));}}
 check(!f.events.operator||f.events.recipient);return p;}
async function live(f:Facts,deps:Deps){check(f.current&&!f.events.revoked&&deps.reader);const p=await proofs(f);check(p);
 const w=await readSponsorAthleteClaimV4(deps.reader,{plan:f.plan,deploymentHash:p.i.deploymentHash,fundingHash:p.i.fundingHash,slot:f.slot,
  allocation:p.allocation,entitlementId:p.claim.entitlementId,recipient:p.claim.recipient});
 check(w.award.nonce===p.claim.nonce&&w.finalizedBlock.timestamp>=p.claim.issuedAt&&w.finalizedBlock.timestamp<p.claim.expiresAt
  &&w.finalizedBlock.number>=BigInt(p.body.witness.finalizedBlock.number)
  &&(w.finalizedBlock.number!==BigInt(p.body.witness.finalizedBlock.number)||w.finalizedBlock.hash===p.body.witness.finalizedBlock.hash));return{p,w};}
const receiptAbi=parseAbi(["function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)"]);
async function paymentReceipt(f:Facts,deps:Deps,hash:Hex){check(deps.reader);const p=await proofs(f);check(p&&f.events.recipient&&f.events.operator);
 const signed={recipient:(f.events.recipient as {signature:Hex}).signature,operator:(f.events.operator as {signature:Hex}).signature};
 const data=encodeSponsorClaimV4(p.context,p.claim,signed),o=await observeSponsorProgrammePot(deps.reader,f.plan,p.i.deploymentHash,p.i.fundingHash,f.slot);
 const [tx,r]=await Promise.all([deps.reader.getTransaction({hash}),deps.reader.getTransactionReceipt({hash})]);
 check(tx.hash===hash&&r.transactionHash===hash&&tx.chainId===f.plan.chainId&&tx.to?.toLowerCase()===p.i.campaignAddress&&r.to?.toLowerCase()===p.i.campaignAddress&&tx.from.toLowerCase()===f.plan.operator
  &&r.from.toLowerCase()===f.plan.operator&&tx.value===0n&&tx.input===data&&r.status==="success"&&tx.blockHash===r.blockHash&&tx.blockNumber===r.blockNumber&&tx.transactionIndex===r.transactionIndex&&r.blockNumber<=BigInt(o.blockNumber));
 const block=await deps.reader.getBlock({blockNumber:r.blockNumber});check(block.hash===r.blockHash);
 const row=await deps.reader.readContract({address:p.i.campaignAddress,abi:receiptAbi,functionName:"entitlements",args:[p.claim.entitlementId],blockNumber:r.blockNumber});
 check(row[6]&&row[7]===0&&row[1]===p.claim.amount&&row[4].toLowerCase()===p.claim.recipient);
 const after=await deps.reader.getBlock({blockNumber:BigInt(o.blockNumber)});check(after.hash===o.blockHash);
 return{transactionHash:hash,blockNumber:r.blockNumber.toString(),blockHash:r.blockHash,amountWei:p.claim.amount.toString(),recipient:p.claim.recipient};
}
export async function sponsorClaimV4(actor:RewardAccountIdentity,scope:SponsorClaimScopeV4,change:SponsorClaimChangeV4|undefined,deps:Deps){
 return sponsorClaimFromFactsV4(scope,change,{...deps,readFacts:write=>sponsorClaimFactsV4(actor,scope,write,deps.rpc)});
}
type FactWrite={action:string;body:unknown};
/** Share cryptographic/chain verification while keeping account and native
 * authentication in separate facts resolvers. A reviewer cannot authorize/pay. */
export async function sponsorClaimFromFactsV4(scope:SponsorClaimScopeV4,change:SponsorClaimChangeV4|undefined,deps:Deps&{
 readFacts:(write?:FactWrite)=>Promise<Facts>; signer?:boolean;
}){
 let f=await deps.readFacts(change?.action==="request"?{action:"request",body:{approvalId:change.approvalId,entitlementId:change.entitlementId,destinationId:change.destinationId}}:undefined);
 await wallet(f,deps.origin);
 if(change?.action==="prepare"){
  check(scope.role==="operator"&&change.sourceStamp===f.sourceStamp&&change.profileFingerprint===f.profileFingerprint);
  const raw=change.attestation as Record<string,unknown>|null;
  let attestation:ReturnType<typeof decodeRewardReadinessAttestationV3>|{schemaVersion:4;policy:'podium-demo-alias-rehearsal-v1';chainId:10143;claimId:string};
  if(raw?.policy==='podium-demo-alias-rehearsal-v1'){
   check(f.rehearsalPolicy===raw.policy&&scope.chainId===10143&&f.plan.chainId===10143&&raw.chainId===10143&&raw.schemaVersion===4&&raw.claimId===f.claimId
    &&Object.keys(raw).sort().join(',')==='chainId,claimId,policy,schemaVersion','invalid_sponsor_claim');
   attestation={schemaVersion:4,policy:raw.policy,chainId:10143,claimId:f.claimId};
  }else{attestation=decodeRewardReadinessAttestationV3(change.attestation);requireReadinessPolicyChainV3(attestation,scope.chainId);check(attestation.schemaVersion!==3,"invalid_sponsor_claim");}
  if(!f.events.intent){check(f.current&&deps.reader);const {i,allocation}=sponsorClaimBindingV4(f);
   // The entitlement is bound by SQL to this request, independently of browser input.
   const entitlementId=f.entitlementId;
   const w=await readSponsorAthleteClaimV4(deps.reader,{plan:f.plan,deploymentHash:i.deploymentHash,fundingHash:i.fundingHash,slot:f.slot,allocation,entitlementId,recipient:f.destination.address});
   const issuedAt=w.finalizedBlock.timestamp,expiresAt=issuedAt+86400n<w.claimDeadline?issuedAt+86400n:w.claimDeadline;
   const claim:RewardClaim={entitlementId,recipient:f.destination.address,amount:w.award.amount,pot:f.slot===0?"league":"race",nonce:w.award.nonce,issuedAt,expiresAt,allocationDigest:w.allocationDigest};
   f=await deps.readFacts({action:"intent",body:{sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,attestation,claim,witness:{finalizedBlock:w.finalizedBlock}}});
  }else check(canonical((f.events.intent as {attestation:unknown}).attestation)===canonical(attestation),"reward_sponsor_claim_conflict");
 }
 if(change?.action==="recipient"||change?.action==="operator"){
  check(scope.role===change.action&&deps.signer!==false);const p=await proofs(f);check(p);const proof=await verifySponsorClaimProofV4(p.context,p.claim,change.action,f.plan.operator as Hex,change.signature);
  if(!f.events[change.action]){await live(f,deps);check(change.action!=="operator"||f.events.recipient,"reward_recipient_consent_required");}
  f=await deps.readFacts({action:change.action,body:proof});
 }
 if(change?.action==="receipt"&&f.events.receipt)check((f.events.receipt as {transactionHash:string}).transactionHash===change.transactionHash,"reward_sponsor_claim_conflict");
 if(change?.action==="receipt"){check(deps.signer!==false);f=await deps.readFacts({action:"receipt",body:f.events.receipt??await paymentReceipt(f,deps,change.transactionHash)});}
 if(change?.action==="revoke")f=await deps.readFacts({action:"revoked",body:{reason:"operator_hold"}});
 const p=await proofs(f);let signing=null,transaction=null,availability=f.current?"awaiting_review":"held";
 if(f.events.receipt)availability="paid";
 else if(p&&f.current){try{await live(f,deps);availability=f.events.operator?"ready_to_pay":f.events.recipient?"awaiting_operator":"awaiting_consent";
  if(deps.signer!==false&&!f.events[scope.role]&&(scope.role==="recipient"||f.events.recipient))signing=copy(sponsorClaimMessagesV4(p.context,p.claim)[scope.role==="recipient"?"consent":"authorization"]);
  if(deps.signer!==false&&scope.role==="operator"&&f.events.operator&&f.events.recipient)transaction={chainId:scope.chainId,from:f.plan.operator,to:p.i.campaignAddress,value:"0",data:encodeSponsorClaimV4(p.context,p.claim,{operator:(f.events.operator as {signature:Hex}).signature,recipient:(f.events.recipient as {signature:Hex}).signature})};
 }catch(e){if(e instanceof Error&&["reward_sponsor_claim_not_ready","sponsor_claim_unavailable","sponsor_entitlement_unavailable"].includes(e.message))availability="held";else throw e;}}
 const after=await deps.readFacts();check(canonical(after.events)===canonical(f.events)&&after.current===f.current&&after.sourceStamp===f.sourceStamp&&after.profileFingerprint===f.profileFingerprint,"reward_planning_revision_changed");
 return copy({schema:"raceson-sponsor-claim-view-v4",claimId:f.claimId,approvalId:f.approvalId,role:scope.role,chainId:scope.chainId,current:f.current,status:availability,
  rehearsalPolicy:f.rehearsalPolicy??null,sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,operatorAddress:f.plan.operator,address:f.destination.address,claim:p?.claim??null,context:p?.context??null,signing,transaction,receipt:f.events.receipt??null});
}

/** Exact payment bytes and immutable, non-secret source binding for the native
 * nonce journal. Readiness/consent checks happen before gas is reserved. */
export async function verifiedSponsorClaimExecutionV4(claimId:string,deps:Deps&{readFacts:(write?:FactWrite)=>Promise<Facts>},requireUnpaid=true){
 const f=await deps.readFacts();check(f.claimId===claimId&&f.plan.chainId===10143&&f.current&&!f.events.revoked);
 await wallet(f,deps.origin);const p=await proofs(f);check(p&&f.events.recipient&&f.events.operator);
 if(requireUnpaid){check(!f.events.receipt);await live(f,deps);}
 const proofBinding=(role:'recipient'|'operator')=>{const v=f.events[role] as {digest:string;signer:string};return{digest:v.digest,signer:v.signer};};
 const source=canonical({claimId:f.claimId,setupId:f.setupId,approvalId:f.approvalId,sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,
  packageHash:f.packageHash,claim:p.claim,recipient:proofBinding('recipient'),operator:proofBinding('operator')});
 const transaction={chainId:10143 as const,from:f.plan.operator,to:p.i.campaignAddress,value:'0' as const,
  data:encodeSponsorClaimV4(p.context,p.claim,{operator:(f.events.operator as {signature:Hex}).signature,recipient:(f.events.recipient as {signature:Hex}).signature})};
 const after=await deps.readFacts();check(after.current===f.current&&after.sourceStamp===f.sourceStamp&&after.profileFingerprint===f.profileFingerprint&&after.packageHash===f.packageHash
  &&canonical(after.events)===canonical(f.events),'reward_planning_revision_changed');
 return{setupId:f.setupId,approvalId:f.approvalId,sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,source,transaction};
}
