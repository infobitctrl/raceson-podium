import type {composeHostedCopyAwardDocument} from '@raceson/db/rewards';
type Document=ReturnType<typeof composeHostedCopyAwardDocument>;
/** Original official clocks only. A copied source has no invented platform review start. */
export function hostedCopyPublicationEvidence(document:Document,approvalId:string,packageHash:string,documentHash:string){
 if(document.plan.reviewPeriods[document.slot]!==0)throw Error('reward_sponsor_historical_review_unavailable');
 const publications=document.source.races.filter(r=>document.slot===0||r.slot===document.slot).map(r=>({slot:r.slot,raceId:r.id,
  publicationId:r.publicationId,runId:r.runId,state:r.publicationState,publishedAt:r.publishedAt}));
 const seconds=publications.map(p=>Math.floor(Date.parse(p.publishedAt)/1000));
 if(!seconds.length||seconds.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('reward_sponsor_source_not_ready');
 const published=String(Math.max(...seconds));
 return {evidence:{schema:'podium-copy-publication-evidence-v1',approvalId,packageHash,documentHash,binding:document.binding,
  sportingSha256:document.source.sportingSha256,publications},timing:{reviewPeriod:'0',reviewStartedAt:published,officialPublishedAt:published}};
}
