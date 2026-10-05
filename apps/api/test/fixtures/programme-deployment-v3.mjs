import {createDefaultRewardProgrammeDraftV2} from "../../../../packages/domain/dist/rewards/programme-draft-v2.js";
export const programmeTestId=n=>`7b000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function programmeDeploymentFixtureV3(operator=`0x${"b".repeat(40)}`,funder=`0x${"a".repeat(40)}`) {
  const id=programmeTestId,rules=createDefaultRewardProgrammeDraftV2(),contextHash="c".repeat(64);
  const terms={funderAddress:funder.toLowerCase(),operatorAddress:operator.toLowerCase(),reviewPeriods:Array(6).fill(86400)};
  const record={draftId:id(1),organizationId:id(2),seasonId:id(3),chainId:31337,organizationName:"Synthetic deployment fixture",seasonName:"Synthetic season",
    revision:1,updatedAt:"2026-09-10T00:00:00Z",rules};
  const rounds=Array.from({length:5},(_,i)=>({id:id(10+i),editionId:id(20+i),slot:i+1,name:`Synthetic round ${i+1}`,date:"2026-10-03",status:"draft",
    races:[{id:id(30+i),competitionId:id(40),name:"Synthetic race",distanceMetres:"15000",publicationId:null,publicationState:null,resultCount:0}]}));
  const approvalView={schema:"raceson-programme-approval-v3",record,workspace:{draftId:id(1),revision:1,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:"a".repeat(64),
    mapping:{version:2,leagueCategories:[],rounds:rounds.map(r=>({slot:r.slot,roundId:r.id,categories:[]}))},catalogue:{rounds,categories:[]}},contextHash,
    approval:{id:id(80),rulesRevision:1,mappingRevision:1,contextHash,terms,approvedAt:"2026-09-10T00:01:00Z",current:true},operationsEnabled:false};
  const intent={id:id(81),approvalId:id(80),contextHash,rules,terms,chainId:31337,operatorAddress:terms.operatorAddress,nonce:"4",maximumGasCostWei:"3000000000000000000",
    creationCodeHash:"0x224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4",createdByUserId:id(4),createdAt:"2026-09-10T00:02:00Z",current:true};
  return{schema:"raceson-programme-deployment-v3",approvalView,intent};
}
