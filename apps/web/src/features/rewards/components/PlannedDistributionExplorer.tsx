import {useMemo,useState} from "react";
import {createDefaultRewardProgrammeDraftV2} from "@raceson/domain/rewards/programme-draft-v2";
import {useI18n} from "@/shared/i18n/I18nContext";
import {draftDistributionGraph} from "../model/distributionExplorer";
import {rewardProgrammeRounds} from "../model/programmeOverview";
import DistributionExplorer from "./DistributionExplorer";
export default function PlannedDistributionExplorer(){
 const {locale}=useI18n(),hr=locale==="hr",[selected,setSelected]=useState("programme");
 const graph=useMemo(()=>{
  const value=draftDistributionGraph(createDefaultRewardProgrammeDraftV2(),hr);
  rewardProgrammeRounds.forEach(r=>{value.byId.get(`pot:round-${r.number}`)!.label=r.name;});return value;
 },[hr]);
 return <DistributionExplorer graph={graph} selected={selected} onSelect={setSelected} status={hr?"Prijedlog · čeka odobrenje organizatora":"Proposed split · awaiting organizer approval"}>
  <p className="my-4 text-sm text-muted-foreground">{hr?"Prikazan je planirani proračun. Odobrene nagrade i isplate još nisu objavljene.":"This is the planned budget. Approved awards and payments have not been published."}</p>
 </DistributionExplorer>;
}
