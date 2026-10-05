import type {SetupPoint} from './rewardSetupLayout';

/** Screen-aware circles; a dense overview stays complete without overlapping markers.
 * Labels return at a readable size when there is enough room, rather than becoming tiny text. */
export function rewardSetupNodeSizes(points:SetupPoint[],unitsPerPixel:number){
 const scale=Math.max(.001,unitsPerPixel),sizes=new Map<string,{radius:number;scale:number;labels:boolean;detail:boolean}>();
 const rings=new Map<number,SetupPoint[]>(),clearances=new Map<string,number>();
 for(const point of points){const ring=rings.get(point.depth)??[];ring.push(point);rings.set(point.depth,ring);}
 const depths=[...rings.keys()].sort((a,b)=>a-b);
 for(let d=0;d<depths.length;d++){
  const ring=rings.get(depths[d])!.sort((a,b)=>a.angle-b.angle),radius=ring[0].radius;
  const radialGap=Math.min(d?radius-rings.get(depths[d-1])![0].radius:Infinity,d<depths.length-1?rings.get(depths[d+1])![0].radius-radius:Infinity);
  ring.forEach((point,i)=>{let clearance=radialGap;if(ring.length>1)for(const other of [ring[(i+1)%ring.length],ring[(i+ring.length-1)%ring.length]])clearance=Math.min(clearance,Math.hypot(point.x-other.x,point.y-other.y));clearances.set(point.id,clearance);});
 }
 for(const p of points){
  const clearance=clearances.get(p.id)!;
  const root=p.parentId===null,prize=p.rank!==null,base=root?53:prize?19:32;
  const desired=root?36:prize?11:25;
  const radius=Math.min(desired*scale,clearance*.34);
  const pixels=radius/scale;
  sizes.set(p.id,{radius,scale:radius/base,labels:root||clearance/scale>(prize?88:145),detail:root||pixels>=(prize?8:13)});
 }
 return sizes;
}
