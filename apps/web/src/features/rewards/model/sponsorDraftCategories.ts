import {addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {updateSetupNode,type RewardDistributionSetup,type RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";

/** Public demo labels only: no organizer draft IDs, result IDs or eligibility approval. */
export const sponsorDraftCategories = [
 {key:"short-girls",course:"Short course",name:"Girls U16",localCourse:"Kratka staza",localName:"Djevojke U16"},
 {key:"short-boys",course:"Short course",name:"Boys U16",localCourse:"Kratka staza",localName:"Dječaci U16"},
 {key:"short-women",course:"Short course",name:"Women",localCourse:"Kratka staza",localName:"Žene"},
 {key:"short-men",course:"Short course",name:"Men",localCourse:"Kratka staza",localName:"Muškarci"},
 {key:"short-seniors",course:"Short course",name:"Seniors 65+",localCourse:"Kratka staza",localName:"Seniori 65+"},
 {key:"long-women",course:"Long course",name:"Women",localCourse:"Duga staza",localName:"Žene"},
 {key:"long-men",course:"Long course",name:"Men",localCourse:"Duga staza",localName:"Muškarci"},
] as const;
export type SponsorDraftCategory=typeof sponsorDraftCategories[number];
export const sponsorDraftCategoryName=(category:SponsorDraftCategory,hr=false)=>`${hr?category.localCourse:category.course} · ${hr?category.localName:category.name}`;
export const matchesSponsorDraftCategory=(node:RewardSetupNode,category:SponsorDraftCategory)=>!node.rule?.source&&[sponsorDraftCategoryName(category),sponsorDraftCategoryName(category,true)].includes(node.name);
export function addSponsorDraftCategory(setup:RewardDistributionSetup,potId:string,category:SponsorDraftCategory,newId:()=>string,hr=false){
 const next=addGuidedGroup(setup,potId,"athlete_standings",newId,null,hr);
 const node=next.root.children.find(p=>p.id===potId)!.children.at(-1)!;
 return {...next,root:updateSetupNode(next.root,node.id,n=>({...n,name:sponsorDraftCategoryName(category,hr)}))};
}
