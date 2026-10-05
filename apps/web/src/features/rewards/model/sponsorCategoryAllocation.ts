import {balanceSetupChildren,updateSetupNode,type RewardDistributionSetup,type RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";

export function balanceSponsorCategories(children:RewardSetupNode[],equal=false):RewardSetupNode[]{
 if(!children.length)return children;
 if(!equal&&children.reduce((total,n)=>total+n.shareBps,0)===10000)return children;
 return balanceSetupChildren(children,equal?"equal":"proportional");
}

/** Repairs older incomplete drafts locally; persisting still requires Save. */
export function normalizeSponsorCategories(configuration:RewardDistributionSetup):RewardDistributionSetup{
 let changed=false;
 const children=configuration.root.children.map(pot=>{
  const children=balanceSponsorCategories(pot.children);
  if(children===pot.children)return pot;
  changed=true;return {...pot,children};
 });
 return changed?{...configuration,root:{...configuration.root,children}}:configuration;
}

export function categoryAllocationLimit(children:RewardSetupNode[],id:string):number{
 return Math.max(0,10000-children.filter(n=>n.id!==id&&n.locked).reduce((total,n)=>total+n.shareBps,0));
}

/** Fix the requested share, then proportionally distribute the remainder in integer basis points. */
export function setSponsorCategoryShare(children:RewardSetupNode[],id:string,requested:number):RewardSetupNode[]{
 if(!Number.isFinite(requested))return children;
 const balanced=balanceSponsorCategories(children),target=balanced.find(n=>n.id===id);
 if(!target||target.locked)return balanced;
 const available=categoryAllocationLimit(balanced,id),others=balanced.filter(n=>n.id!==id&&!n.locked);
 const shareBps=others.length?Math.max(0,Math.min(available,Math.round(requested))):available;
 return balanceSetupChildren(balanced.map(n=>n.id===id?{...n,shareBps,locked:true}:n),"proportional")
  .map(n=>n.id===id?{...n,locked:false}:n);
}

/** New groups receive an equal portion of the unlocked budget, preserving other proportions. */
export function allocateAddedSponsorCategory(configuration:RewardDistributionSetup,potId:string):RewardDistributionSetup{
 return {...configuration,root:updateSetupNode(configuration.root,potId,pot=>{
  const added=pot.children.at(-1)!;
  const remaining=categoryAllocationLimit(pot.children,added.id);
  const count=pot.children.filter(n=>!n.locked).length;
  const initial=pot.children.map(n=>n.id===added.id?{...n,shareBps:Math.round(remaining/count)}:n);
  // Balance existing groups around the requested new share, without first normalizing it away.
  const fixed=initial.map(n=>n.id===added.id?{...n,locked:true}:n);
  const children=balanceSetupChildren(fixed,"proportional").map(n=>n.id===added.id?{...n,locked:false}:n);
  return {...pot,children};
 })};
}
