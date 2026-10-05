import {setupId, type RewardSetupContext} from "./distribution-setup.js";
import {decodeRewardSourceCatalogueV2, type RewardSourceCatalogueV2} from "./source-mapping-v2.js";

export type SponsorSourceRequestV4 = {setupId:string} | {sourceLeagueId:string;sourceSeasonId:string;eventEditionId:string|null};
export const SPONSOR_CATEGORY_PRESETS = ["short_female_u16","short_male_u16","short_female","short_male","short_senior","long_female","long_male","clubs"] as const;
export type SponsorCategoryPresetsV4 = Record<typeof SPONSOR_CATEGORY_PRESETS[number],string>;
export type SponsorSourceViewV4 = {schema:"raceson-sponsor-source-v4";sourceLeagueId:string;sourceSeasonId:string;eventEditionId:string|null;
 context:RewardSetupContext;catalogue:RewardSourceCatalogueV2;selectedRoundId:string|null;selectedSlot:number|null;categoryPresets:SponsorCategoryPresetsV4};
const fail=()=>{throw Error("invalid_reward_sponsor_source");};
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())fail();
 return value as Record<string,unknown>;
}
function uuid(v:unknown):string{if(!setupId(v))fail();return v as string;}
function label(v:unknown):string{if(typeof v!=="string"||!v.trim()||v.length>100||/[\u0000-\u001f]/.test(v))fail();return v as string;}
export function decodeSponsorSourceRequestV4(value:unknown):SponsorSourceRequestV4{
 if(value&&typeof value==="object"&&"setupId" in value){const r=object(value,["setupId"]);return {setupId:uuid(r.setupId)};}
 const r=object(value,["sourceLeagueId","sourceSeasonId","eventEditionId"]);
 return {sourceLeagueId:uuid(r.sourceLeagueId),sourceSeasonId:uuid(r.sourceSeasonId),eventEditionId:r.eventEditionId===null?null:uuid(r.eventEditionId)};
}
export function decodeSponsorSourceViewV4(value:unknown):SponsorSourceViewV4{
 const r=object(value,["schema","sourceLeagueId","sourceSeasonId","eventEditionId","context","catalogue","selectedRoundId","selectedSlot","categoryPresets"]);
 if(r.schema!=="raceson-sponsor-source-v4")fail();
 const c=object(r.context,["draftId","catalogueHash","roundId","editionId","programmeName","eventName"]);
 if(c.roundId!==null||c.editionId!==null||typeof c.catalogueHash!=="string"||!/^[0-9a-f]{64}$/.test(c.catalogueHash))fail();
 const context:RewardSetupContext={draftId:uuid(c.draftId),catalogueHash:c.catalogueHash as string,roundId:null,editionId:null,programmeName:label(c.programmeName),eventName:label(c.eventName)};
 const catalogue=decodeRewardSourceCatalogueV2(r.catalogue);
 if(catalogue.rounds.length!==5||new Set(catalogue.rounds.map(v=>v.slot)).size!==5||catalogue.rounds.some(v=>v.slot<1||v.slot>5||v.status==="cancelled"))fail();
 const preset=object(r.categoryPresets,[...SPONSOR_CATEGORY_PRESETS]),categoryPresets={} as SponsorCategoryPresetsV4;
 for(const key of SPONSOR_CATEGORY_PRESETS){
   const id=uuid(preset[key]);if(!catalogue.categories.some(v=>v.id===id&&v.target===(key==="clubs"?"club":"individual")))fail();categoryPresets[key]=id;
 }
 if(new Set(Object.values(categoryPresets)).size!==SPONSOR_CATEGORY_PRESETS.length)fail();
 const eventEditionId=r.eventEditionId===null?null:uuid(r.eventEditionId),selectedRoundId=r.selectedRoundId===null?null:uuid(r.selectedRoundId);
 if(eventEditionId===null){if(selectedRoundId!==null||r.selectedSlot!==null)fail();}
 else if(!Number.isInteger(r.selectedSlot)||!catalogue.rounds.some(v=>v.id===selectedRoundId&&v.slot===r.selectedSlot))fail();
 return {schema:"raceson-sponsor-source-v4",sourceLeagueId:uuid(r.sourceLeagueId),sourceSeasonId:uuid(r.sourceSeasonId),eventEditionId,
   context,catalogue,selectedRoundId,selectedSlot:r.selectedSlot as number|null,categoryPresets};
}
