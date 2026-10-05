import { clubReviewFixture, clubReviewId as id } from './reward-club-review.mjs';
export function clubReadinessV3Fixture() {
  const old=clubReviewFixture(),{identity,chain}=old;
  const source={draftId:id(20),chainId:31337,uploadId:id(21),approvalId:id(22),slot:1,operatorUserId:identity.userId,
    operatorAddress:`0x${'a'.repeat(40)}`,current:true,sourceGuardHash:'d'.repeat(64)};
  const scope={chainId:31337,uploadId:source.uploadId,requestId:old.context.nomination.requestId,role:'operator'};
  const context={schema:'raceson-club-readiness-private-v3',actorUserId:identity.userId,role:'operator',source,
    nomination:old.context.nomination,identityFingerprint:'a'.repeat(64),state:'unreviewed',review:null,retryReview:null};
  const review={id:id(23),uploadId:scope.uploadId,requestId:scope.requestId,previousReviewId:null,sourceGuardHash:source.sourceGuardHash,
    identityFingerprint:context.identityFingerprint,evidence:structuredClone(old.input.evidence),reviewedByUserId:identity.userId,
    reviewedSessionId:identity.sessionId,reviewedAt:'2026-09-11T04:00:00Z',revocation:null};
  const input={...scope,reviewId:review.id,previousReviewId:null,sourceGuardHash:source.sourceGuardHash,
    identityFingerprint:context.identityFingerprint,evidence:structuredClone(review.evidence)};
  const calls=[],rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});
    if(name==='service_revoke_reward_club_readiness_v3')return{data:{...structuredClone(review),revocation:{
      reason:args.p_reason,revokedAt:'2026-09-11T04:01:00Z',revokedByUserId:identity.userId}},error:null};
    return {data:structuredClone(name==='service_read_reward_club_readiness_v3'?context:review),error:null};};
  return {identity,chain,source,scope,context,review,input,calls,rpc,deps:{chainId:31337,reader:chain.reader,rpc}};
}
