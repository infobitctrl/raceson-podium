import {expect,it} from 'vitest';
import {controllerSelection,resultsHandoffLink,rewardsControlLink} from './controllerLinks';
const id='73000000-0000-4000-8000-000000000001';
it('accepts only one UUID and a bounded integer pot as navigation hints',()=>{
 expect(controllerSelection(`?campaign=${id}&pot=4`)).toEqual({campaign:id,slot:4});
 for(const search of [`?campaign=other&pot=-1`,`?campaign=${id}&campaign=${id}&pot=6`,`?pot=1&pot=2`,`?pot=1.5`])expect(controllerSelection(search)).toEqual({campaign:null,slot:null});
});
it('hosted result handoff retains exact campaign/pot while local navigation keeps its original route',()=>{
 expect(resultsHandoffLink(id,4)).toBe(`/rewards/manage/campaigns/${id}?pot=4`);
 expect(resultsHandoffLink(id,4,true)).toBe(`/rewards/review?campaign=${id}&pot=4`);
 expect(controllerSelection(new URL(resultsHandoffLink(id,4,true),'https://podium.raceson.com').search)).toEqual({campaign:id,slot:4});
 expect(rewardsControlLink(id,4)).toBe(`/rewards/control?campaign=${id}&pot=4`);
});
