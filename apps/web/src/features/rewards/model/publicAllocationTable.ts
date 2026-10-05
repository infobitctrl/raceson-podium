import type { PublicRewardProgramme, PublicRewardRow } from "@raceson/domain/rewards/public-report";

export type AllocationTableRow = PublicRewardRow & { id:string; potId:string; potName:string; potSlot:number; poolKey:string; category:string; position:number|null; slotWei:bigint|null; share:number|null };
export type AllocationSort = "position"|"name"|"potName"|"poolKey"|"category"|"share"|"slotWei"|"amountWei"|"allocation"|"claim"|"payment"|"transactionHash";
export function publicAllocationRows(programme:PublicRewardProgramme,poolKey?:string):AllocationTableRow[] {
  return programme.pots.flatMap(pot=>pot.pools.filter(p=>!poolKey||p.key===poolKey).flatMap(pool=>(pool.awards??[]).map(award=>{
    const recipient=pot.rows.find(r=>r.recipientId===award.recipientId)!;
    const category=pool.categories?.find(c=>c.id===award.categoryId),slot=category?.slots.find(s=>s.position===award.position);
    const totalWeight=category?.slots.reduce((n,s)=>n+BigInt(s.weight),0n)??0n;
    return {...recipient,amountWei:award.amountWei,id:`${pot.id}:${pool.key}:${award.recipientId}`,potId:pot.id,potName:pot.name,potSlot:pot.slot,poolKey:pool.key,
      category:category?.name??"",position:award.position??null,slotWei:slot?BigInt(slot.amountWei):null,
      share:slot&&totalWeight?Number(BigInt(slot.weight)*10000n/totalWeight)/100:null};
  })));
}
export function sortAllocationRows(rows:AllocationTableRow[],key:AllocationSort,descending:boolean) {
  const value=(r:AllocationTableRow)=>key==="amountWei"?BigInt(r.amountWei):key==="allocation"?"awarded":r[key];
  return [...rows].sort((a,b)=>{
    const x=value(a),y=value(b);
    if(x===null||y===null)return x===y?0:x===null?1:-1;
    const compared=typeof x==="string"&&typeof y==="string"?x.localeCompare(y,undefined,{numeric:true}):x<y?-1:x>y?1:0;
    return compared*(descending?-1:1)||a.potSlot-b.potSlot||a.poolKey.localeCompare(b.poolKey)||a.category.localeCompare(b.category)||a.name.localeCompare(b.name,undefined,{numeric:true});
  });
}
