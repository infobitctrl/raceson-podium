import {decodeSavedTestProgramme,decodeTestProgrammeConfiguration,testProgrammeId,type TestProgrammeConfiguration} from "@raceson/domain/rewards/test-programme";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
const base="/v1/rewards/test-programmes";
function chain(){if(!publicEnv.rewardDemo||!publicEnv.rewardPortalEnabled)throw new Error("test_demo_required");return publicEnv.rewardDemo.mode==="local"?31337:10143;}
export async function listTestProgrammes(){
 const network=chain(),raw=await apiRequest<unknown>({path:base,cache:"no-store"});
 if(!raw||typeof raw!=="object"||Object.keys(raw).join()!=="items"||!("items" in raw)||!Array.isArray(raw.items)||raw.items.length>100)throw new Error("invalid_test_programme");
 const rows=raw.items.map(r=>decodeSavedTestProgramme(r,network));if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error("invalid_test_programme");return rows;
}
export async function readTestProgramme(id:string){
 const network=chain();if(!testProgrammeId(id))throw new Error("invalid_test_programme");
 return decodeSavedTestProgramme(await apiRequest({path:`${base}/${id}`,cache:"no-store"}),network,id);
}
export async function saveTestProgramme(id:string,change:{requestId:string;expectedRevision:number;configuration:TestProgrammeConfiguration}){
 const network=chain();if(!testProgrammeId(id)||!testProgrammeId(change.requestId)||!Number.isInteger(change.expectedRevision)||change.expectedRevision<0)throw new Error("invalid_test_programme");
 const configuration=decodeTestProgrammeConfiguration(change.configuration);
 return decodeSavedTestProgramme(await apiRequest({path:`${base}/${id}`,method:"PATCH",cache:"no-store",body:{...change,configuration}}),network,id);
}
