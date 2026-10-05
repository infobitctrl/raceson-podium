import {useEffect,useMemo,useState} from "react";
import {useAuth} from "@/lib/auth";
import {ApiError} from "@/lib/api";
import {useRewardSessionEpoch} from "./useRewardSessionEpoch";
import {setupId as validId,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {bindGuidedSeason} from "@raceson/domain/rewards/guided-setup-editor";
import type {SponsorSourceRequestV4,SponsorSourceViewV4} from "@raceson/domain/rewards/sponsor-source";
import {resolveSponsorSource} from "../data/sponsorSource";

export function useSponsorSource(configuration:RewardDistributionSetup, search:URLSearchParams, options:{enabled?:boolean;setupId?:string;locked:boolean;onChange:(next:RewardDistributionSetup)=>void}) {
 const {locked,onChange}=options;
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session);
 const league=search.get("sourceLeagueId"),season=search.get("sourceSeasonId"),edition=search.get("eventEditionId"),race=search.get("raceId");
 const explicit=league!==null||season!==null||edition!==null||race!==null;
 const invalid=explicit&&(!validId(league)||!validId(season)||edition!==null&&!validId(edition)||race!==null&&(!validId(race)||edition===null));
 const saved=configuration.sponsorSelection;
 const conflict=Boolean(explicit&&saved&&(league!==saved.sourceLeagueId||season!==saved.sourceSeasonId||edition!==saved.eventEditionId||(race??undefined)!==saved.raceId));
 const selectedLeague=explicit?league:saved?.sourceLeagueId,selectedSeason=explicit?season:saved?.sourceSeasonId,selectedEdition=explicit?edition:saved?.eventEditionId,selectedRace=explicit?race:saved?.raceId;
 const selection=useMemo(()=>!invalid&&selectedLeague&&selectedSeason?{sourceLeagueId:selectedLeague,sourceSeasonId:selectedSeason,eventEditionId:selectedEdition??null,...(selectedRace?{raceId:selectedRace}:{})}:undefined,[invalid,selectedLeague,selectedSeason,selectedEdition,selectedRace]);
 const existingId=!selection&&configuration.context?options.setupId:undefined;
 // Public selection survives an unpublished catalogue. Context remains verified
 // separately, and legacy saved documents still resolve through their owned ID.
 // The resolver accepts an event identity; track membership is checked against
 // that event's authoritative catalogue before binding any source context.
 const request=useMemo<SponsorSourceRequestV4|null>(()=>options.enabled===false||invalid||conflict?null:selection?{sourceLeagueId:selection.sourceLeagueId,sourceSeasonId:selection.sourceSeasonId,eventEditionId:selection.eventEditionId}:(existingId?{setupId:existingId}:null),[selection,existingId,invalid,conflict,options.enabled]);
 const key=`${auth.user?.id??""}:${epoch}:${JSON.stringify(request)}`,signedIn=Boolean(auth.user&&auth.session&&auth.account?.userId===auth.user.id);
 const [state,setState]=useState<{key:string;source:SponsorSourceViewV4|null;failure:"failed"|"unpublished"|"changed"|null}>({key:"",source:null,failure:null});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!request||!signedIn)return;
  let current=true;setState({key,source:null,failure:null});
  void resolveSponsorSource(request).then(source=>{if(current)setState({key,source,failure:null});}).catch(error=>{
   if(current)setState({key,source:null,failure:error instanceof ApiError&&error.code==="reward_sponsor_source_not_found"?"unpublished":error instanceof ApiError&&error.code==="reward_sponsor_source_stale"?"changed":"failed"});
  });
  return()=>{current=false;};
 },[request,key,signedIn,epoch,attempt]);
 const source=signedIn&&state.key===key?state.source:null;
 const invalidRace=Boolean(source&&selection?.raceId&&!source.catalogue.rounds.find(round=>round.id===source.selectedRoundId)?.races.some(track=>track.id===selection.raceId));
 const mismatch=Boolean(source&&configuration.context&&(source.context.draftId!==configuration.context.draftId||source.context.catalogueHash!==configuration.context.catalogueHash));
 const binding=useMemo(()=>{
  if(locked||invalid||invalidRace||conflict||mismatch)return null;
  let next=configuration;
  // Derive only an unsaved automatic title from the verified source. Never
  // rename an existing campaign or a sponsor's explicit custom title.
  if(source&&!options.setupId&&["My sponsor campaign","Moja sponzorska kampanja"].includes(next.name))
   next={...next,name:(source.catalogue.rounds.find(r=>r.id===source.selectedRoundId)?.races.find(r=>r.id===selection?.raceId)?.name??source.catalogue.rounds.find(r=>r.id===source.selectedRoundId)?.name??source.context.eventName??source.context.programmeName).slice(0,100)};
  // Never infer an event for an old bound campaign; attach URL intent only
  // after its resolved context agrees with that campaign.
  if(selection&&!saved&&(!configuration.context||source))next={...next,sponsorSelection:selection};
  if(source&&!configuration.context){try{
   // Source binding is independent of an as-yet empty budget. The temporary
   // valid amount is used only by the source decoder; never retained or saved.
   const budgetMon=next.budgetMon;
   next={...bindGuidedSeason(budgetMon===""?{...next,budgetMon:"1"}:next,source.context,source.catalogue),budgetMon};
   // A new event/track campaign starts with its entire budget in the selected
   // round. Existing drafts and any chosen reward economics are never changed.
   if(!options.setupId&&configuration.guided?.groups.length===0&&source.selectedSlot!==null){
    const potId=next.guided!.pots.find(pot=>pot.slot===source.selectedSlot)?.nodeId;
    if(!potId)return {next:null};
    next={...next,root:{...next.root,children:next.root.children.map(pot=>({...pot,shareBps:pot.id===potId?10000:0}))}};
   }
  }catch{return {next:null};}}
  return next===configuration?null:{next};
 },[source,configuration,locked,invalid,invalidRace,conflict,mismatch,selection,saved,options.setupId]);
 useEffect(()=>{if(binding?.next)onChange(binding.next);},[binding,onChange]);
 const status=invalid||invalidRace?"invalid":conflict?"changed":!request?"unselected":!signedIn?"signin":mismatch?"changed":state.key===key&&state.failure?state.failure:binding&&!binding.next?"settings":!source?"loading":!configuration.context?locked?"locked":"loading":"ready";
 return {source:status==="ready"?source:null,status,selectedRaceId:selection?.raceId??null,selected:explicit||Boolean(selection)||Boolean(existingId),retry:()=>setAttempt(n=>n+1)};
}
