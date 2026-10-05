import {beforeEach,expect,it,vi} from "vitest";
import {createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import {archiveRewardSetup} from "./distributionSetups";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiRequest:request}));
vi.mock("@/lib/public-env",()=>({publicEnv:{rewardDemo:{mode:"testnet"},rewardPortalEnabled:true}}));
let sequence=1;const id=()=>`78000000-0000-4000-8000-${String(sequence++).padStart(12,"0")}`;
function record(archived:boolean){return {id:id(),chainId:10143,revision:2,updatedAt:"2026-09-28T10:00:00.000Z",configuration:createGuidedSetup(id),lifecycle:{state:"deposit",canDelete:false,archived}};}
beforeEach(()=>request.mockReset());
it.each([true,false])("validates the exact archive response (archived=%s)",async archived=>{
 const value=record(archived);request.mockResolvedValue(value);
 await expect(archiveRewardSetup(value.id,2,archived)).resolves.toMatchObject(value);
 expect(request).toHaveBeenCalledWith({path:`/v1/rewards/distribution-setups/${value.id}/archive`,method:"POST",cache:"no-store",body:{expectedRevision:2,archived}});
});
it("rejects mismatched identity, chain, revision and archive acknowledgement",async()=>{
 const value=record(true);
 for(const wrong of [{...value,id:id()},{...value,chainId:31337},{...value,revision:3},{...value,lifecycle:{...value.lifecycle,archived:false}},{...value,lifecycle:{state:"deposit",canDelete:false}}]){
  request.mockResolvedValue(wrong);await expect(archiveRewardSetup(value.id,2,true)).rejects.toThrow("invalid_reward_setup");
 }
});
it("refuses invalid inputs before making a request",async()=>{
 for(const revision of [0,-1,1.5,2147483646])await expect(archiveRewardSetup(id(),revision,true)).rejects.toThrow("invalid_reward_setup");
 await expect(archiveRewardSetup("invalid",2,true)).rejects.toThrow("invalid_reward_setup");
 await expect(archiveRewardSetup(id(),2,"true" as unknown as boolean)).rejects.toThrow("invalid_reward_setup");expect(request).not.toHaveBeenCalled();
});
