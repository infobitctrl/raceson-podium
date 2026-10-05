import {decodeSavedRewardSetup,decodeRewardSetup,setupId,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
const base=publicEnv.hostedCopy?"/v1/rewards/demo-copy/sponsor-setups":"/v1/rewards/distribution-setups";
function unpack(value:unknown){return publicEnv.hostedCopy?(value as {record:unknown})?.record:value;}
function chain(){if(!publicEnv.rewardDemo||!publicEnv.rewardPortalEnabled)throw new Error("reward_demo_required");return publicEnv.rewardDemo.mode==="local"?31337:10143;}
export async function listRewardSetups(){
 const network=chain(),raw=await apiRequest<unknown>({path:base,cache:"no-store"});
 if(!raw||typeof raw!=="object"||Object.keys(raw).join()!=="items"||!("items" in raw)||!Array.isArray(raw.items)||raw.items.length>100)throw new Error("invalid_reward_setup");
 const rows=raw.items.map(r=>decodeSavedRewardSetup(r,network));if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error("invalid_reward_setup");return rows;
}
export async function readRewardSetup(id:string){
 const network=chain();if(!setupId(id))throw new Error("invalid_reward_setup");
 return decodeSavedRewardSetup(unpack(await apiRequest({path:`${base}/${id}`,cache:"no-store"})),network,id);
}
export async function deleteRewardDraft(id:string,expectedRevision:number){
 chain();if(!setupId(id)||!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483645)throw new Error("invalid_reward_setup");
 const result=await apiRequest<{id:string;deleted:boolean}>({path:`${base}/${id}`,method:"DELETE",cache:"no-store",body:{expectedRevision}});
 if(!result||Object.keys(result).length!==2||result.id!==id||result.deleted!==true)throw new Error("invalid_reward_setup");
 return result;
}
export async function saveRewardSetup(id:string,change:{requestId:string;expectedRevision:number;configuration:RewardDistributionSetup}){
 const network=chain();if(!setupId(id)||!setupId(change.requestId)||!Number.isInteger(change.expectedRevision)||change.expectedRevision<0)throw new Error("invalid_reward_setup");
 const configuration=decodeRewardSetup(change.configuration);
 return decodeSavedRewardSetup(unpack(await apiRequest({path:`${base}/${id}`,method:"PATCH",cache:"no-store",body:{...change,configuration}})),network,id);
}

export async function archiveRewardSetup(id:string,expectedRevision:number,archived:boolean){
 const network=chain();if(!setupId(id)||!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483645||typeof archived!=="boolean")throw new Error("invalid_reward_setup");
 const record=decodeSavedRewardSetup(unpack(await apiRequest({path:`${base}/${id}/archive`,method:"POST",cache:"no-store",body:{expectedRevision,archived}})),network,id);
 if(record.revision!==expectedRevision||record.lifecycle?.archived!==archived)throw new Error("invalid_reward_setup");
 return record;
}
