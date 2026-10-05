export type SetupView = {x:number;y:number;width:number;height:number};
export type ScreenPoint = {x:number;y:number};
export type CanvasRect = {left:number;top:number;width:number;height:number};

// SVG preserves its aspect ratio, so account for the empty space beside the viewBox.
export function setupCanvasPoint(point:ScreenPoint,view:SetupView,rect:CanvasRect):ScreenPoint{
 const scale=Math.max(view.width/Math.max(rect.width,1),view.height/Math.max(rect.height,1));
 return {x:view.x+view.width/2+(point.x-rect.left-rect.width/2)*scale,y:view.y+view.height/2+(point.y-rect.top-rect.height/2)*scale};
}
export function zoomSetupView(view:SetupView,factor:number,maxWidth:number,anchor:ScreenPoint={x:view.x+view.width/2,y:view.y+view.height/2}):SetupView{
 const width=Math.max(180,Math.min(maxWidth,view.width*factor)),ratio=width/view.width;
 return {x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio,width,height:view.height*ratio};
}
