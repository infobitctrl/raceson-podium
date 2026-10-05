import {createHash} from "node:crypto";
import {z} from "zod";
import {leaguePublicationFactsV3,leaguePublicationHashV3,copyRewardLedgerDocument as copy,rewardDocumentObject as object,
  rewardDocumentUuid as uuid,RewardLedgerStoreError,type RewardAccountIdentity,type RewardLedgerRpc,type LeaguePublicationScopeV3} from "@raceson/db/rewards";
import {decodeLeaguePolicyDecisionV3,proposeLeagueStandingsV3} from "@raceson/domain/rewards/league-standings-v3";
import {decodeRewardAllocationSourceV3,previewRewardAllocationV3,type RewardAllocationSourceV3} from "@raceson/domain/rewards/allocation-preview-v3";
import {decodeRewardProgrammeDraftV2} from "@raceson/domain/rewards/programme-draft-v2";
import {decodeRewardSourceMappingV2} from "@raceson/domain/rewards/source-mapping-v2";
import {canonicalRewardJson} from "@raceson/rewards-chain";
import {leaguePolicyCalculationV3,projectLeaguePolicyV3} from "./league-policy-v3-service.js";
type Facts=Awaited<ReturnType<typeof leaguePublicationFactsV3>>;
type Publication=NonNullable<Facts["publication"]>;
const check=(v:unknown,code="invalid_reward_league_publication")=>{if(!v)throw new RewardLedgerStoreError(code);};
const digest=z.string().regex(/^[0-9a-f]{64}$/);
export const leaguePublicationRequestV3=z.object({requestId:z.string().uuid(),expectedPublicationId:z.string().uuid().nullable(),
  documentHash:digest,decision:z.enum(["published","held"])}).strict();
type Change=z.infer<typeof leaguePublicationRequestV3>;

/** Exact five-source sporting document. Replay recomputes the complete shared
 * league proposal, including ties, best-N, clubs and distance holds. Names,
 * wallets and observation timestamps do not enter this commitment. */
export function buildLeaguePublicationDocumentV3(contextInput:unknown,reviewInput:unknown,sourceInput:unknown){
  const context=object(copy(contextInput),["schema","draftId","organizationId","chainId","rulesRevision","rules","mapping","sourceLeagueId","sourceSeasonId","categories","rounds"]);
  check(context.schema==="raceson-league-policy-context-v3"&&[31337,10143].includes(Number(context.chainId)));
  const draftId=uuid(context.draftId),chainId=context.chainId as 31337|10143,review=decodeLeaguePolicyDecisionV3(reviewInput);
  check(review?.decision==="selected"&&review.contextHash===leaguePublicationHashV3(context),"reward_league_publication_not_ready");
  const source=decodeRewardAllocationSourceV3(sourceInput);
  check(source.sourceLeagueId===context.sourceLeagueId&&source.sourceSeasonId===context.sourceSeasonId&&source.league===null
    &&source.standings.every(t=>t.slot!==null));
  decodeRewardProgrammeDraftV2(context.rules);const mapping=decodeRewardSourceMappingV2(context.mapping);
  check(mapping.rounds.every((r,i)=>r.roundId===source.rounds[i]!.roundId));
  const proposal=proposeLeagueStandingsV3(source,review!.policy);
  check(proposal.state==="unapproved_proposal","reward_league_publication_not_ready");
  source.capturedAt=new Date(Math.max(Date.parse(review!.reviewedAt),...source.rounds.map(r=>Date.parse(r.evidence!.publishedAt)),
    ...source.standings.map(t=>Date.parse(t.evidence.publishedAt)))).toISOString();
  return{schema:"raceson-league-publication-document-v3" as const,draftId,chainId,policyContext:context,policyReview:review!,source,proposal};
}
export function decodeLeaguePublicationDocumentV3(value:unknown){
  const d=object(copy(value),["schema","draftId","chainId","policyContext","policyReview","source","proposal"]);
  const built=buildLeaguePublicationDocumentV3(d.policyContext,d.policyReview,d.source);
  check(canonicalRewardJson(built)===canonicalRewardJson(d));return built;
}
function prepared(f:Facts){
  const c=leaguePolicyCalculationV3(f.policy);
  const document=c.currentSource&&c.proposal?.state==="unapproved_proposal"
    ?buildLeaguePublicationDocumentV3(c.context,f.policy.review,c.currentSource):null;
  return{document,documentHash:document?leaguePublicationHashV3(document):null};
}
function verify(p:Publication){
  const document=decodeLeaguePublicationDocumentV3(p.document);
  check(document.draftId===p.draftId&&document.source.capturedAt<=p.publishedAt
    &&leaguePublicationHashV3(document)===p.documentHash);return document;
}
function meta(p:Publication|null,f:Facts,currentHash:string|null){
  if(!p)return null;verify(p);
  return{id:p.id,previousPublicationId:p.previousPublicationId,documentHash:p.documentHash,decision:p.decision,
    publishedAt:p.publishedAt,publishedByUserId:p.publishedByUserId,evidenceHash:p.evidenceHash,
    current:p.decision==="published"&&p.sourceGuardHash===f.guardHash&&p.documentHash===currentHash};
}
// Deterministic table-row identity, not a fabricated race result. Original
// contributing result IDs remain in the immutable proposal and distance rows.
function standingId(publicationId:string,categoryId:string,beneficiaryId:string){
  const h=createHash("sha256").update(JSON.stringify(["raceson-league-standing-v3",publicationId,categoryId,beneficiaryId])).digest("hex").slice(0,32);
  return`${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`;
}
export function publishedLeagueSourceV3(p:Publication):RewardAllocationSourceV3{
  check(p.decision==="published","reward_league_publication_not_ready");const d=verify(p),source=decodeRewardAllocationSourceV3(d.source);
  const evidence={kind:source.kind==="synthetic_rehearsal"?"synthetic" as const:"native_final" as const,
    digest:p.evidenceHash,publishedAt:p.publishedAt,held:false};
  const roundDigests=source.rounds.map(r=>r.evidence!.digest);
  source.capturedAt=p.publishedAt;source.league={evidence,roundDigests};
  source.standings.push(...d.proposal.athleteTables.map(t=>({slot:null,categoryId:t.categoryId,complete:true,evidence,roundDigests,
    rows:t.rows.filter(r=>r.eligible).map(r=>({sourceRowId:standingId(p.id,t.categoryId,r.beneficiaryId),beneficiaryId:r.beneficiaryId,rank:r.rank!}))})));
  const clubs=d.proposal.clubTables.find(t=>t.slot===null)!;
  source.standings.push({slot:null,categoryId:clubs.categoryId,complete:true,evidence,roundDigests,
    rows:clubs.rows.map(r=>({sourceRowId:standingId(p.id,clubs.categoryId,r.beneficiaryId),beneficiaryId:r.beneficiaryId,rank:r.rank}))});
  return decodeRewardAllocationSourceV3(source);
}
function project(f:Facts){
  const current=prepared(f),publication=meta(f.publication,f,current.documentHash),recorded=meta(f.recorded,f,current.documentHash);
  const source=publication?.current?publishedLeagueSourceV3(f.publication!):null;
  return copy({schema:"raceson-league-publication-view-v3",draftId:f.policy.facts.record.draftId,chainId:f.policy.facts.record.chainId,
    policy:projectLeaguePolicyV3(f.policy),documentHash:current.documentHash,sourceReady:current.document!==null,
    publication,recorded,finalPublished:publication?.current===true,allocationApproved:false,payableWei:"0",
    leagueAllocation:source?previewRewardAllocationV3(f.policy.facts.record.rules,f.policy.facts.workspace.mapping,source).league:null});
}
/** Used by the next allocation approval adapter. Only a fresh, current saved
 * publication yields final league source. A historical row is never authority. */
export async function readPublishedLeagueSourceV3(identity:RewardAccountIdentity,scope:LeaguePublicationScopeV3,rpc?:RewardLedgerRpc){
  const f=await leaguePublicationFactsV3({...identity},{...scope},undefined,rpc);
  return publishedLeagueSourceFromFactsV3(f);
}
/** Source-locked enclosing transactions may reuse these already decoded facts. */
export function publishedLeagueSourceFromFactsV3(f:Facts){
  const current=prepared(f);
  check(meta(f.publication,f,current.documentHash)?.current,"reward_league_publication_not_ready");
  return{facts:f,publication:f.publication!,source:publishedLeagueSourceV3(f.publication!)};
}
export async function leaguePublicationV3(identity:RewardAccountIdentity,input:LeaguePublicationScopeV3,change?:Change,rpc?:RewardLedgerRpc){
  const actor={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},c=change?leaguePublicationRequestV3.parse(change):null;
  const scope={chainId:input.chainId,draftId:uuid(input.draftId),requestId:c?.requestId};
  const f=await leaguePublicationFactsV3(actor,scope,undefined,rpc);
  if(!c)return project(f);
  if(f.recorded){check(f.recorded.previousPublicationId===c.expectedPublicationId&&f.recorded.documentHash===c.documentHash&&f.recorded.decision===c.decision,
    "reward_league_publication_conflict");return project(f);}
  check((f.publication?.id??null)===c.expectedPublicationId,"reward_league_publication_conflict");
  const document=c.decision==="held"?(f.publication?verify(f.publication):null):prepared(f).document;
  check(document,"reward_league_publication_not_ready");check(leaguePublicationHashV3(document)===c.documentHash,"reward_planning_revision_changed");
  const saved=await leaguePublicationFactsV3(actor,scope,{previousPublicationId:c.expectedPublicationId,sourceGuardHash:f.guardHash,document,decision:c.decision},rpc);
  check(saved.recorded?.id===c.requestId&&saved.recorded.documentHash===c.documentHash&&saved.recorded.decision===c.decision);
  return project(saved);
}
