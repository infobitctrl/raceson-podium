import {useEffect,useRef,useState} from 'react';
import type {SetupLayout,SetupPoint} from './rewardSetupLayout';

/** All points of one depth use the same interpolated radius on every frame. */
export function useRewardSetupMotion(target:SetupLayout,dragging:boolean){
 const [frame,setFrame]=useState(target),current=useRef(target);
 useEffect(()=>{
  const from=current.current;
  if(dragging||typeof window.matchMedia!=='function'||window.matchMedia('(prefers-reduced-motion: reduce)').matches){current.current=target;setFrame(target);return;}
  const previous=new Map(from.points.map(p=>[p.id,p])),next=new Map(target.points.map(p=>[p.id,p]));
  const starts=new Map(target.points.map(p=>{
   let ancestor:SetupPoint|undefined=p;
   while(ancestor&&!previous.has(ancestor.id))ancestor=ancestor.parentId?next.get(ancestor.parentId):undefined;
   return[p.id,previous.get(p.id)?.angle??(ancestor?previous.get(ancestor.id)?.angle:undefined)??p.angle];
  }));
  let handle=0;const start=performance.now();
  const animate=(now:number)=>{
   const progress=Math.min(1,(now-start)/340),t=1-(1-progress)**3;
   const radii=target.radii.map((r,d)=>{const old=from.radii[d]??from.radii.at(-1)??0;return old+(r-old)*t;});
   const points=target.points.map(p=>{const angle=starts.get(p.id)!+(p.angle-starts.get(p.id)!)*t,radius=radii[p.depth];return{...p,angle,radius,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};});
   const value={...target,radii,points};current.current=value;setFrame(value);
   if(progress<1)handle=requestAnimationFrame(animate);
  };
  handle=requestAnimationFrame(animate);return()=>cancelAnimationFrame(handle);
 },[target,dragging]);
 const positions=new Map(frame.points.map(p=>[p.id,p]));
 const radii=target.radii.map((r,d)=>frame.radii[d]??r);
 return {...target,radii,points:target.points.map(p=>{const angle=positions.get(p.id)?.angle??p.angle,radius=radii[p.depth];return {...p,angle,radius,x:p.depth?Math.cos(angle)*radius:0,y:p.depth?Math.sin(angle)*radius:0};})};
}
