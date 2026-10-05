import {createRewardSetup,defaultRewardSetupPolicy,presetSetupShares} from "../../../../packages/domain/dist/rewards/distribution-setup.js";
import {id} from "./published-reward-v2.mjs";
export function legacyConversionFixture(){
  let seq=3000;
  const node=(name,shareBps,children=[],rule=null)=>({id:id(seq++),name,shareBps,children,rule,locked:false});
  const rule=(basis,count)=>({basis,sharesBps:presetSetupShares(count),source:null});
  const league=node("League",5000,[node("Athlete Participation",2000,[],rule("race_position",25)),node("Athlete Kms",4000,[],rule("race_position",25)),node("Club Kms",2000,[],rule("manual",25))]);
  const rounds=Array.from({length:5},(_,i)=>node(`Round ${i+1}`,2000,[node(`Category ${i+1}`,10000,[],rule("race_position",10))]));
  const source={...createRewardSetup(id(seq++)),version:4,programmeKind:"league",event:null,context:null,policy:defaultRewardSetupPolicy(),stage:"draft"};
  source.root.children=[league,node("Races",5000,rounds)];
  const potIds=[league.id,...rounds.map(n=>n.id)];
  const choices=[...league.children.map((n,i)=>({nodeId:n.id,type:["athlete_finishes","athlete_metres","club_metres"][i]})),...rounds.map(n=>({nodeId:n.children[0].id,type:"athlete_standings"}))];
  return {source,potIds,choices};
}
