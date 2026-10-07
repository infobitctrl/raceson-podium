import {previewFiveRoundCopyV1,type FiveRoundCopyV1,type FiveRoundCombinedSelection} from '@raceson/domain/rewards/five-round-copy-v1';

/** Read-only sporting evidence, separate from the immutable allocation document.
 * Use the same category ordering/tie policy as the calculator, never award order.
 * Copy exact decimal milliseconds without conversion to a JS number. */
export function hostedCopyCategoryEvidence(source:FiveRoundCopyV1,slot:number,classificationId:string,selections:readonly FiveRoundCombinedSelection[]=[]){
 const table=previewFiveRoundCopyV1(source,selections).tables.find(t=>t.slot===(slot||null)&&t.classificationId===classificationId);
 if(!table)throw Error('invalid_copy_setup_binding');
 if(!slot)return table.candidates.map(c=>({key:c.beneficiaryId,beneficiaryId:c.beneficiaryId,name:c.name!,club:null,
  rankOverall:null,rankCategory:c.order,finishTimeMs:null,status:'standing',points:c.evidenceValue}));
 return source.results.filter(r=>source.races.some(race=>race.id===r.raceId&&race.slot===slot)&&r.classificationIds.includes(classificationId))
  .sort((a,b)=>(a.rankOverall??Infinity)-(b.rankOverall??Infinity)||a.id.localeCompare(b.id))
  .map(r=>({key:r.id,beneficiaryId:r.athleteId,name:source.athletes.find(a=>a.id===r.athleteId)!.name,
   club:source.clubs.find(c=>c.id===r.clubId)?.name??null,rankOverall:r.rankOverall,
   rankCategory:table.candidates.find(c=>c.evidenceIds.includes(r.id))?.order??null,
   finishTimeMs:r.finishTimeMs,status:r.status,points:null}));
}
