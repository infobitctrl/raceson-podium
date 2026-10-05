import type { previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";

export type DistributionNode = { id: string; label: string; wei: bigint; children?: DistributionNode[] };
type Preview = ReturnType<typeof previewRewardAllocationV3>;
export function allocationPotNode(pot: Preview["rounds"][number] | Preview["league"], id: string, label: string,
  names: { family: (key: string) => string; category: (id: string) => string; beneficiary: (id: string, club: boolean) => string; remaining: string }): DistributionNode {
  const children = pot.families.map(f => ({ id: `${id}:${f.key}`, label: names.family(f.key), wei: f.budgetWei,
    children: [...f.categories.map(c => ({ id: `${id}:${c.categoryId}`, label: names.category(c.categoryId), wei: c.budgetWei,
      children: [...c.awards.filter(a => a.amountWei > 0n).map(a => ({ id: `${id}:${c.categoryId}:${a.beneficiaryId}`, label: `${a.rank}. ${names.beneficiary(a.beneficiaryId, c.target === "club")}`, wei: a.amountWei })),
        { id: `${id}:${c.categoryId}:remaining`, label: names.remaining, wei: c.retainedWei }] })),
      { id: `${id}:${f.key}:unassigned`, label: names.remaining, wei: f.unassignedWei }] }));
  const nodes: DistributionNode[] = children;
  if ("participation" in pot) nodes.push({ id: `${id}:participation`, label: names.family("participation_metres"), wei: pot.participation.budgetWei,
    children: [...pot.participation.awards.map(a => ({ id: `${id}:metres:${a.beneficiaryId}`, label: names.beneficiary(a.beneficiaryId, false), wei: a.amountWei })),
      { id: `${id}:metres:remaining`, label: names.remaining, wei: pot.participation.retainedWei }] });
  return { id, label, wei: pot.budgetWei, children: nodes };
}
