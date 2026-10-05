import {expect,it} from 'vitest';
import {controllerSelection} from './controllerLinks';
const id='73000000-0000-4000-8000-000000000001';
it('accepts only one UUID and a bounded integer pot as navigation hints',()=>{
 expect(controllerSelection(`?campaign=${id}&pot=4`)).toEqual({campaign:id,slot:4});
 for(const search of [`?campaign=other&pot=-1`,`?campaign=${id}&campaign=${id}&pot=6`,`?pot=1&pot=2`,`?pot=1.5`])expect(controllerSelection(search)).toEqual({campaign:null,slot:null});
});
