import {afterEach,expect,it,vi} from "vitest";
import {readPublicRewardReport} from "./publicReport";
const state=vi.hoisted(()=>({demo:{chainId:10143,apiBaseUrl:"http://demo.invalid/api"},guard:vi.fn()}));
vi.mock("@/lib/public-env",()=>({assertPublicEnvironmentOrigin:state.guard,publicEnv:{get rewardDemo(){return state.demo;}}}));
afterEach(()=>{vi.unstubAllGlobals();state.demo.chainId=10143;});
it("fetches the public report without cookies, login token or redirects",async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{schema:"raceson-public-reward-report-v1",observedAt:"2026-09-16T12:00:00.000Z",programmes:[]}})});
 vi.stubGlobal("fetch",fetcher);const signal=new AbortController().signal;
 expect((await readPublicRewardReport(signal)).programmes).toEqual([]);
 expect(fetcher).toHaveBeenCalledWith("http://demo.invalid/api/v1/rewards/public-report",{method:"GET",credentials:"omit",cache:"no-store",redirect:"error",signal,headers:{Accept:"application/json"}});
});
it("does not turn failed or malformed data into empty or paid records",async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:false});vi.stubGlobal("fetch",fetcher);
 await expect(readPublicRewardReport(new AbortController().signal)).rejects.toThrow("public_report_unavailable");
 fetcher.mockResolvedValue({ok:true,json:async()=>({data:{private:true}})});
 await expect(readPublicRewardReport(new AbortController().signal)).rejects.toThrow("invalid_public_reward_report");
 state.demo.chainId=31337;fetcher.mockClear();
 await expect(readPublicRewardReport(new AbortController().signal)).rejects.toThrow("public_report_demo_required");expect(fetcher).not.toHaveBeenCalled();
});
