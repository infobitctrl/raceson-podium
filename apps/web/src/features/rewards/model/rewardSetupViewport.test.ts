import {expect,it} from 'vitest';
import {setupCanvasPoint,zoomSetupView} from './rewardSetupViewport';
it('keeps the zoom anchor under the same screen point including SVG letterboxing',()=>{
 const view={x:-500,y:-500,width:1000,height:1000},rect={left:10,top:20,width:800,height:600},pointer={x:530,y:230};
 const anchor=setupCanvasPoint(pointer,view,rect),zoomed=zoomSetupView(view,.5,2000,anchor);
 expect(setupCanvasPoint(pointer,zoomed,rect)).toEqual(anchor);
 expect(zoomed.width).toBe(500);expect(zoomed.height).toBe(500);
 expect(zoomSetupView(view,.0001,2000).width).toBe(180);
 expect(zoomSetupView(view,1e10,2000).width).toBe(2000);
});
