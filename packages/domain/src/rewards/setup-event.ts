import { setupId, presetSetupShares, type RewardSetupNode } from './distribution-setup.js';
import { previewPublishedPrizeSlots } from './published-preview-v2.js';
export type EventRewardGroup = {key:string;label:string;kind:'overall'|'sex'|'age'|'category'|'club';gender:'F'|'M'|null;minimumAge:number|null;maximumAge:number|null};
export type RewardEventRace = {id:string;name:string;distanceKm:number|null;minimumAge:number|null;maximumAge:number|null;genders:string[];groups:EventRewardGroup[];missing:string[]};
export type RewardEventSummary = {id:string;name:string;date:string;organizationName:string};
export type RewardEventCatalogue = RewardEventSummary & {catalogueHash:string;races:RewardEventRace[]};
export type RewardEventChoice = {nodeId:string;raceId:string;groupKey:string;approved:boolean};
export type RewardSetupEventContext = {editionId:string;name:string;date:string;catalogueHash:string;choices:RewardEventChoice[]};
function assert(v:unknown):asserts v {if(!v)throw new Error('invalid_reward_setup');}
export function decodeSetupEvent(value:unknown):RewardSetupEventContext|null {
 if(value===null)return null;
 assert(value&&typeof value==='object'&&!Array.isArray(value));const e=value as RewardSetupEventContext;
 assert(Object.keys(e).sort().join()==='catalogueHash,choices,date,editionId,name');
 assert(setupId(e.editionId)&&typeof e.name==='string'&&e.name.trim().length>0&&e.name.length<=100&&!/[\x00-\x1f\x7f]/.test(e.name));
 assert(typeof e.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&Number.isFinite(Date.parse(e.date))&&new Date(e.date).toISOString().slice(0,10)===e.date&&typeof e.catalogueHash==='string'&&/^[0-9a-f]{64}$/.test(e.catalogueHash));
 assert(Array.isArray(e.choices)&&e.choices.length<=1000);const ids=new Set<string>();
 for(const c of e.choices){assert(c&&Object.keys(c).sort().join()==='approved,groupKey,nodeId,raceId');assert(setupId(c.nodeId)&&!ids.has(c.nodeId)&&setupId(c.raceId)&&typeof c.groupKey==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(c.groupKey)&&typeof c.approved==='boolean');ids.add(c.nodeId);}
 return e;
}
/** Explicit generation only. Never replaces an edited tree during catalogue refresh. */
export function generateEventTree(root:RewardSetupNode,event:RewardEventCatalogue,choices:Array<{raceId:string;groupKey:string;winners:number;approved:boolean}>,id:()=>string){
 const races=event.races.filter(r=>choices.some(c=>c.raceId===r.id));assert(races.length>0&&races.length<=50&&choices.length<=1000);
 const saved:RewardEventChoice[]=[];const seen=new Set<string>();const shares=presetSetupShares(races.length);
 const children=races.map((r,i)=>{const selected=choices.filter(c=>c.raceId===r.id);assert(selected.length<=50);const parts=presetSetupShares(selected.length);
  return {id:id(),name:r.name.slice(0,100),shareBps:shares[i],locked:false,rule:null,children:selected.map((c,j)=>{const group=r.groups.find(g=>g.key===c.groupKey),key=`${r.id}/${c.groupKey}`;assert(group&&!seen.has(key));seen.add(key);const nodeId=id();saved.push({nodeId,raceId:r.id,groupKey:c.groupKey,approved:c.approved});return {id:nodeId,name:group.label.slice(0,100),shareBps:parts[j],locked:false,children:[],rule:{basis:group.kind==='club'?'club_points' as const:'race_position' as const,sharesBps:presetSetupShares(c.winners,'descending'),source:null}};})};});
 assert(seen.size===choices.length);
 return {root:{...root,children,rule:null},event:{editionId:event.id,name:event.name.slice(0,100),date:event.date,catalogueHash:event.catalogueHash,choices:saved}};
}
export type EventRewardResults = {catalogueHash:string;publicationId:string|null;publicationState:string|null;publishedAt:string|null;groups:Array<{raceId:string;groupKey:string;issue:string|null;candidates:Array<{beneficiaryId:string;name:string;order:number;evidenceIds:string[];evidenceValue:number}>}>};
export function previewEventGroup(event:RewardSetupEventContext,node:RewardSetupNode,slots:bigint[],results:EventRewardResults):{issue:string|null;awards:import("./published-preview-v2.js").PublishedRewardAllocation[];unusedWei:bigint}{
 const choice=event.choices.find(c=>c.nodeId===node.id),group=results.groups.find(g=>g.raceId===choice?.raceId&&g.groupKey===choice?.groupKey);
 const issue=!node.rule||slots.length!==node.rule.sharesBps.length||slots.some(amount=>amount<0n)?'distribution_incomplete':results.catalogueHash!==event.catalogueHash?'source_changed':!choice?.approved?'eligibility_review':node.rule?.basis!==(choice.groupKey==='club'?'club_points':'race_position')?'source_changed':!results.publicationId||!['official','corrected'].includes(results.publicationState??'')?'awaiting_publication':!group||group.issue?group?.issue??'source_changed':null;
 if(issue)return {issue,awards:[],unusedWei:slots.reduce((a,b)=>a+b,0n)};
 return {issue:null,...previewPublishedPrizeSlots(slots.map((amountWei,i)=>({rank:i+1,amountWei})),group!.candidates)};
}
