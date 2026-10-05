import type {RewardSetupNode} from '@raceson/domain/rewards/distribution-setup';

export type SetupPoint={id:string;owner:RewardSetupNode;parentId:string|null;depth:number;branch:number;rank:number|null;x:number;y:number;angle:number;radius:number;travel:number;shareBps:number};
export type SetupLayout=ReturnType<typeof rewardSetupLayout>;
export const clampBranchOffset=(value:number)=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));

/** Layout space represents hierarchy, never money. Hidden descendants reserve their sector,
 * so collapsing or selecting a branch cannot move unrelated branches or change the rings. */
export function rewardSetupLayout(root:RewardSetupNode,collapsed:ReadonlySet<string>,prizes:boolean,offsets:Readonly<Record<string,number>>={}){
 type Item={point:SetupPoint;children:Item[];weight:number;visible:boolean};
 const items:Item[]=[];
 function build(node:RewardSetupNode,parentId:string|null,depth:number,branch:number,visible:boolean):Item{
  const point:SetupPoint={id:node.id,owner:node,parentId,depth,branch,rank:null,x:0,y:0,angle:0,radius:0,travel:0,shareBps:node.shareBps};
  const item:Item={point,children:[],weight:1,visible};items.push(item);
  const open=visible&&!collapsed.has(node.id);
  item.children=node.children.map((n,i)=>build(n,node.id,depth+1,depth===0?i:branch,open));
  if(prizes&&node.rule)node.rule.sharesBps.forEach((shareBps,i)=>{
   const child:Item={point:{...point,id:`${node.id}:place:${i+1}`,parentId:node.id,depth:depth+1,rank:i+1,shareBps},children:[],weight:1,visible:open};
   items.push(child);item.children.push(child);
  });
  // Reserve room for unfinished categories too, so a round without winners
  // is not squeezed into a sliver beside completed ten-place categories.
  item.weight=Math.max(10,item.children.reduce((sum,c)=>sum+c.weight,0));
  return item;
 }
 const tree=build(root,null,0,0,true),tau=2*Math.PI;
 function position(item:Item,start:number,end:number){
  // Protected margins let a branch and its fan move without crossing another sector.
  const width=end-start,travel=item.point.depth===0?0:width*.1;
  const shift=clampBranchOffset(offsets[item.point.id]??0)*travel;
  item.point.angle=(start+end)/2+shift;item.point.travel=travel;
  const inset=item.point.depth===0?0:width*.12;
  let cursor=start+inset+shift;
  const total=item.children.reduce((sum,c)=>sum+c.weight,0);
  for(const child of item.children){const next=cursor+(width-2*inset)*child.weight/total;position(child,cursor,next);cursor=next;}
 }
 const firstWidth=tree.children.length?tau*tree.children[0].weight/tree.children.reduce((n,c)=>n+c.weight,0):0;
 const start=-Math.PI/2-firstWidth/2;
 position(tree,start,start+tau);
 const maxDepth=Math.max(...items.map(i=>i.point.depth)),requiredRadii=[0];
 for(let depth=1;depth<=maxDepth;depth++){
  const ring=items.filter(i=>i.point.depth===depth).map(i=>i.point).sort((a,b)=>a.angle-b.angle);
  let required=0;
  for(let i=0;i<ring.length&&ring.length>1;i++){
   const a=ring[i],b=ring[(i+1)%ring.length],gap=(b.angle-a.angle+tau)%tau;
   // Prize markers need less space than editable pots. Their count must not
   // stretch the outer ring while leaving all inner branches at the centre.
   const distance=a.rank!==null&&b.rank!==null?28:a.rank===null&&b.rank===null?155:95;
   required=Math.max(required,distance/(2*Math.sin(Math.max(.00001,gap)/2)));
  }
  requiredRadii.push(required);
 }
 const ringGap=Math.max(180,...requiredRadii.map((r,d)=>d?r/d:0));
 const radii=requiredRadii.map((_,depth)=>depth*ringGap);
 for(const {point:p} of items){p.radius=radii[p.depth];p.x=p.depth===0?0:Math.cos(p.angle)*p.radius;p.y=p.depth===0?0:Math.sin(p.angle)*p.radius;}
 const points=items.filter(i=>i.visible).map(i=>i.point),visibleDepth=Math.max(...points.map(p=>p.depth));
 const extent=radii[visibleDepth]+130,size=Math.max(720,extent*2);
 return {points,radii:radii.slice(0,visibleDepth+1),bounds:{x:-size/2,y:-size/2,width:size,height:size}};
}
