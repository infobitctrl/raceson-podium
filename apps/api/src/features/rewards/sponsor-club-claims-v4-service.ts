import {sponsorClubClaimFactsV4,copyRewardLedgerDocument as copy,decodeRewardClubReviewEvidence,
 sponsorAllocationDocumentHashV4 as digest,RewardLedgerStoreError,type RewardAccountIdentity,type RewardLedgerRpc,type SponsorClubClaimScopeV4} from "@raceson/db/rewards";
import {canonicalRewardJson as canonical,verifySponsorClubSafeConsentV4,readVerifiedRewardClubSafeDeployment,type RewardClaim,type RewardPublicAward} from "@raceson/rewards-chain";
import {sponsorLifecycleCommitmentV4, type SponsorLifecycleInputV4,type SponsorPublicationV4} from "@raceson/rewards-chain/sponsor-lifecycle-v4";
import {readSponsorClubClaimV4,type SponsorClubClaimReaderV4} from "@raceson/rewards-chain/sponsor-claim-reader-v4";
import {sponsorClaimMessagesV4,verifySponsorClaimProofV4,encodeSponsorClaimV4,sponsorSafeConsentMessageV4} from "@raceson/rewards-chain/sponsor-claims-v4";
import {observeSponsorProgrammePot} from "@raceson/rewards-chain/sponsor-v4";
import {z} from "zod";
import {parseAbi,type Hex} from "viem";
type Facts=Awaited<ReturnType<typeof sponsorClubClaimFactsV4>>;
type Deps={rpc?:RewardLedgerRpc;reader?:SponsorClubClaimReaderV4};
function check(v:unknown,code="reward_sponsor_claim_not_ready"):asserts v{if(!v)throw new RewardLedgerStoreError(code);}
export type SponsorClubClaimChangeV4={action:"request";approvalId:string;entitlementId:Hex;requestId:string}|{action:"prepare";sourceStamp:string;profileFingerprint:string;attestation:unknown}
 |{action:"recipient"|"operator";signature:Hex}|{action:"receipt";transactionHash:Hex}|{action:"revoke"};
export function sponsorClubClaimBindingV4(f:Facts){
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
 const binding=sponsorClubClaimBindingV4(f),award=binding.allocation.awards.find(a=>a.entitlementId===claim.entitlementId);
 check(award&&award.beneficiaryKind===1&&award.amount===claim.amount&&claim.recipient===f.nomination.candidate.safeAddress&&claim.pot===(f.slot===0?"league":"race")&&claim.allocationDigest===binding.allocation.allocationDigest);
 sponsorClaimMessagesV4(binding.context,claim);return{...binding,body:b,claim};
}
function treasury(f:Facts, raw:unknown) {
 const e=decodeRewardClubReviewEvidence(raw),c=e.candidate;
 check(e.chainId===f.plan.chainId&&canonical(c)===canonical(f.nomination.candidate));
 const b=(v:typeof e.reviewedBlock)=>({number:BigInt(v.number),hash:v.hash,timestamp:BigInt(v.timestamp)});
 return {treasury:{safe:{context:{chainId:e.chainId,environment:e.chainId===31337?"local-simulation" as const:"monad-testnet" as const,verifyingContract:c.safeAddress},
  singletonAddress:c.singletonAddress,fallbackHandlerAddress:c.fallbackHandlerAddress,owners:c.owners},factoryAddress:e.factoryAddress,deploymentTransactionHash:e.deploymentTransactionHash},
  review:{reviewedBlock:b(e.reviewedBlock),deploymentBlock:b(e.deploymentBlock),initializerHash:e.initializerHash}};
}
async function reviewEvidence(f:Facts,raw:unknown,deps:Deps){
 if(raw&&typeof raw==="object"&&"schemaVersion" in raw)return decodeRewardClubReviewEvidence(raw);
 const keys=["factoryAddress","deploymentTransactionHash","authorityEvidenceRef","controlEvidenceRef","recoveryEvidenceRef","executionHistoryEvidenceRef"];
 check(raw&&typeof raw==="object"&&!Array.isArray(raw)&&Object.keys(raw).length===keys.length&&keys.every(k=>k in raw),"invalid_sponsor_claim");
 const v=raw as Record<string,string>,old=(f.events.intent as {attestation?:unknown}|undefined)?.attestation;
 if(old){const evidence=decodeRewardClubReviewEvidence(old);check(keys.every(k=>v[k]===evidence[k as keyof typeof evidence]),"reward_sponsor_claim_conflict");return evidence;}
 check(f.current&&deps.reader);const candidate=f.nomination.candidate;
 // The checkpoint and initialization evidence come from trusted chain reads.
 // Human references remain explicit operator attestations, never invented here.
 const validated=z.object({factoryAddress:z.string().regex(/^0x[0-9a-f]{40}$/),deploymentTransactionHash:z.string().regex(/^0x[0-9a-f]{64}$/),
  authorityEvidenceRef:z.string().uuid(),controlEvidenceRef:z.string().uuid(),recoveryEvidenceRef:z.string().uuid(),executionHistoryEvidenceRef:z.string().uuid()}).strict().parse(v);
 const safe={context:{environment:f.plan.chainId===31337?"local-simulation" as const:"monad-testnet" as const,chainId:f.plan.chainId,verifyingContract:candidate.safeAddress},
  singletonAddress:candidate.singletonAddress,fallbackHandlerAddress:candidate.fallbackHandlerAddress,owners:candidate.owners};
 const observed=await readVerifiedRewardClubSafeDeployment(deps.reader,{safe,factoryAddress:validated.factoryAddress as Hex,deploymentTransactionHash:validated.deploymentTransactionHash as Hex});
 return decodeRewardClubReviewEvidence(copy({schemaVersion:1,policy:"operator-reviewed-original-safe-v1",chainId:f.plan.chainId,candidate,...validated,deploymentBlock:observed.deploymentBlock,reviewedBlock:observed.safe.finalizedBlock,initializerHash:observed.initializerHash}));
}
async function proof(f:Facts,p:NonNullable<ReturnType<typeof intent>>,role:"recipient"|"operator",signature:Hex,at:{number:bigint;hash:Hex;timestamp:bigint},deps:Deps){
 if(role==="operator")return verifySponsorClaimProofV4(p.context,p.claim,role,f.plan.operator as Hex,signature);
 check(deps.reader);const {observation:_,...verified}=await verifySponsorClubSafeConsentV4(deps.reader,{safe:treasury(f,(f.events.intent as {attestation:unknown}).attestation).treasury.safe,
  campaignContext:p.context,claim:p.claim,signature,checkpoint:at});
 return {...verified,signer:verified.signer.toLowerCase(),signature:verified.signature.toLowerCase()};
}
async function proofs(f:Facts,deps:Deps){const p=intent(f);if(!p)return null;
 for(const role of ["recipient","operator"] as const){const v=f.events[role] as {signature:Hex}|undefined;if(v){const at=p.body.witness.finalizedBlock;const verified=await proof(f,p,role,v.signature,{number:BigInt(at.number),hash:at.hash,timestamp:BigInt(at.timestamp)},deps);check(canonical(verified)===canonical(v));}}
 check(!f.events.operator||f.events.recipient);return p;}
async function live(f:Facts,deps:Deps){check(f.current&&!f.events.revoked&&deps.reader);const p=await proofs(f,deps);check(p);
 const w=await readSponsorClubClaimV4(deps.reader,{plan:f.plan,deploymentHash:p.i.deploymentHash,fundingHash:p.i.fundingHash,slot:f.slot,
  allocation:p.allocation,entitlementId:p.claim.entitlementId,recipient:p.claim.recipient,...treasury(f,(f.events.intent as {attestation:unknown}).attestation)});
 check(w.award.nonce===p.claim.nonce&&w.finalizedBlock.timestamp>=p.claim.issuedAt&&w.finalizedBlock.timestamp<p.claim.expiresAt
  &&w.finalizedBlock.number>=BigInt(p.body.witness.finalizedBlock.number)
  &&(w.finalizedBlock.number!==BigInt(p.body.witness.finalizedBlock.number)||w.finalizedBlock.hash===p.body.witness.finalizedBlock.hash));
 const intentTreasury=(f.events.intent as {witness:{treasury:unknown}}).witness.treasury;
 check(canonical(w.treasury)===canonical(intentTreasury));
 if(f.events.recipient)await proof(f,p,"recipient",(f.events.recipient as {signature:Hex}).signature,w.finalizedBlock,deps);
 return{p,w};}
const receiptAbi=parseAbi(["function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)"]);
async function paymentReceipt(f:Facts,deps:Deps,hash:Hex){check(deps.reader);const p=await proofs(f,deps);check(p&&f.events.recipient&&f.events.operator);
 const signed={recipient:(f.events.recipient as {signature:Hex}).signature,operator:(f.events.operator as {signature:Hex}).signature};
 const data=encodeSponsorClaimV4(p.context,p.claim,signed),o=await observeSponsorProgrammePot(deps.reader,f.plan,p.i.deploymentHash,p.i.fundingHash,f.slot);
 const [tx,r]=await Promise.all([deps.reader.getTransaction({hash}),deps.reader.getTransactionReceipt({hash})]);
 check(tx.hash===hash&&r.transactionHash===hash&&tx.chainId===f.plan.chainId&&tx.to?.toLowerCase()===p.i.campaignAddress&&r.to?.toLowerCase()===p.i.campaignAddress&&tx.from.toLowerCase()===f.plan.operator
  &&r.from.toLowerCase()===f.plan.operator&&tx.value===0n&&tx.input===data&&r.status==="success"&&tx.blockHash===r.blockHash&&tx.blockNumber===r.blockNumber&&tx.transactionIndex===r.transactionIndex&&r.blockNumber<=BigInt(o.blockNumber));
 const block=await deps.reader.getBlock({blockNumber:r.blockNumber});check(block.hash===r.blockHash);
 const row=await deps.reader.readContract({address:p.i.campaignAddress,abi:receiptAbi,functionName:"entitlements",args:[p.claim.entitlementId],blockNumber:r.blockNumber});
 check(row[6]&&row[7]===1&&row[1]===p.claim.amount&&row[4].toLowerCase()===p.claim.recipient);
 const after=await deps.reader.getBlock({blockNumber:BigInt(o.blockNumber)});check(after.hash===o.blockHash);
 return{transactionHash:hash,blockNumber:r.blockNumber.toString(),blockHash:r.blockHash,amountWei:p.claim.amount.toString(),recipient:p.claim.recipient};
}
export async function sponsorClubClaimV4(actor:RewardAccountIdentity,scope:SponsorClubClaimScopeV4,change:SponsorClubClaimChangeV4|undefined,deps:Deps){
 let f=await sponsorClubClaimFactsV4(actor,scope,change?.action==="request"?{action:"request",body:{approvalId:change.approvalId,entitlementId:change.entitlementId,requestId:change.requestId}}:undefined,deps.rpc);

 if(change?.action==="prepare"){
  check(scope.role==="operator"&&change.sourceStamp===f.sourceStamp&&change.profileFingerprint===f.profileFingerprint);
  const attestation=await reviewEvidence(f,change.attestation,deps);treasury(f,attestation);
  if(!f.events.intent){check(f.current&&deps.reader);const {i,allocation}=sponsorClubClaimBindingV4(f);
   // The entitlement is bound by SQL to this request, independently of browser input.
   const entitlementId=f.entitlementId;
   const w=await readSponsorClubClaimV4(deps.reader,{plan:f.plan,deploymentHash:i.deploymentHash,fundingHash:i.fundingHash,slot:f.slot,allocation,entitlementId,recipient:f.nomination.candidate.safeAddress,...treasury(f,attestation)});
   const issuedAt=w.finalizedBlock.timestamp,expiresAt=issuedAt+86400n<w.claimDeadline?issuedAt+86400n:w.claimDeadline;
   const claim:RewardClaim={entitlementId,recipient:f.nomination.candidate.safeAddress,amount:w.award.amount,pot:f.slot===0?"league":"race",nonce:w.award.nonce,issuedAt,expiresAt,allocationDigest:w.allocationDigest};
   f=await sponsorClubClaimFactsV4(actor,scope,{action:"intent",body:{sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,attestation,claim,witness:{finalizedBlock:w.finalizedBlock,treasury:w.treasury}}},deps.rpc);
  }else check(canonical((f.events.intent as {attestation:unknown}).attestation)===canonical(attestation),"reward_sponsor_claim_conflict");
 }
 if(change?.action==="recipient"||change?.action==="operator"){
  check(scope.role===change.action);const p=await proofs(f,deps);check(p);const at=p.body.witness.finalizedBlock;
  const verified=await proof(f,p,change.action,change.signature,{number:BigInt(at.number),hash:at.hash,timestamp:BigInt(at.timestamp)},deps);
  if(!f.events[change.action]){await live(f,deps);check(change.action!=="operator"||f.events.recipient,"reward_recipient_consent_required");}
  f=await sponsorClubClaimFactsV4(actor,scope,{action:change.action,body:verified},deps.rpc);
 }
 if(change?.action==="receipt"&&f.events.receipt)check((f.events.receipt as {transactionHash:string}).transactionHash===change.transactionHash,"reward_sponsor_claim_conflict");
 if(change?.action==="receipt")f=await sponsorClubClaimFactsV4(actor,scope,{action:"receipt",body:f.events.receipt??await paymentReceipt(f,deps,change.transactionHash)},deps.rpc);
 if(change?.action==="revoke")f=await sponsorClubClaimFactsV4(actor,scope,{action:"revoked",body:{reason:"operator_hold"}},deps.rpc);
 const p=await proofs(f,deps);let signing=null,transaction=null,availability=f.current?"awaiting_review":"held";
 if(f.events.receipt)availability="paid";
 else if(p&&f.current){try{await live(f,deps);availability=f.events.operator?"ready_to_pay":f.events.recipient?"awaiting_operator":"awaiting_consent";
  if(!f.events[scope.role]&&(scope.role==="recipient"||f.events.recipient))signing=copy(scope.role==="recipient"?sponsorSafeConsentMessageV4(p.context,p.claim):sponsorClaimMessagesV4(p.context,p.claim).authorization);
  if(scope.role==="operator"&&f.events.operator&&f.events.recipient)transaction={chainId:scope.chainId,from:f.plan.operator,to:p.i.campaignAddress,value:"0",data:encodeSponsorClaimV4(p.context,p.claim,{operator:(f.events.operator as {signature:Hex}).signature,recipient:(f.events.recipient as {signature:Hex}).signature})};
 }catch(e){if(e instanceof Error&&["reward_sponsor_claim_not_ready","sponsor_claim_unavailable","sponsor_entitlement_unavailable"].includes(e.message))availability="held";else throw e;}}
 const after=await sponsorClubClaimFactsV4(actor,scope,undefined,deps.rpc);check(canonical(after.events)===canonical(f.events)&&after.current===f.current&&after.sourceStamp===f.sourceStamp&&after.profileFingerprint===f.profileFingerprint,"reward_planning_revision_changed");
 return copy({schema:"raceson-sponsor-club-claim-view-v4",claimId:f.claimId,approvalId:f.approvalId,role:scope.role,chainId:scope.chainId,current:f.current,status:availability,
  sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,operatorAddress:f.plan.operator,address:f.nomination.candidate.safeAddress,owners:f.nomination.candidate.owners,candidate:f.nomination.candidate,claim:p?.claim??null,context:p?.context??null,signing,transaction,receipt:f.events.receipt??null});
}
