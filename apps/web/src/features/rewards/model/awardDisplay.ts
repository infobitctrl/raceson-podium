import type {SponsorAward} from '../data/sponsorProgramme';

/** Storage slots are not event names. Display only saved campaign labels. */
export function awardDisplay(award:SponsorAward,hr:boolean){
 const title=award.display?.eventName||award.display?.campaignName||(hr?'Sponzorirana nagrada':'Sponsored reward');
 const subtitle=[award.display?.campaignName,award.display?.scopeName].filter((name,index,all)=>name&&name!==title&&all.indexOf(name)===index).join(' · ');
 return {title,subtitle};
}
