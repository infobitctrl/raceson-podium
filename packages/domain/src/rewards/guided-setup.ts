import type { RewardDistributionSetup, RewardSetupContext, RewardSetupNode } from "./distribution-setup.js";

export const GUIDED_REWARD_TYPES = ["athlete_standings", "club_standings", "athlete_finishes", "athlete_metres", "club_metres"] as const;
export type GuidedRewardType = typeof GUIDED_REWARD_TYPES[number];
export type GuidedRewardGroup = {
  nodeId: string; type: GuidedRewardType; method: "ranked" | "proportional";
  minimumFinishes: number; eligibilityApproved: boolean;
};
export type GuidedRewardPot = { nodeId: string; slot: number; roundId: string | null };
export type GuidedRewardSetup = {
  version: 1; pots: GuidedRewardPot[]; groups: GuidedRewardGroup[];
  counting: "one_finish_per_round"; clubAttribution: "represented_at_finish";
};
const check = (condition: unknown): void => { if (!condition) throw Error("invalid_reward_setup"); };
const object = (value: unknown, keys: string[]): Record<string, unknown> => {
  check(value && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  check(Object.keys(row).sort().join() === [...keys].sort().join()); return row;
};
const validId = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
export const isParticipationType = (type: GuidedRewardType) => ["athlete_finishes", "athlete_metres", "club_metres"].includes(type);

/** Semantic roles are stored explicitly. Never infer a reward calculation from
 * a label, its position in the tree, or the number of child nodes. */
export function decodeGuidedRewardSetup(value: unknown, root: RewardSetupNode, context: RewardSetupContext | null): GuidedRewardSetup {
  const g = object(value, ["version", "pots", "groups", "counting", "clubAttribution"]);
  check(g.version === 1 && g.counting === "one_finish_per_round" && g.clubAttribution === "represented_at_finish");
  check(Array.isArray(g.pots) && g.pots.length === 6 && Array.isArray(g.groups) && g.groups.length <= 300);
  check(root.rule === null && root.children.length === 6 && (context === null || context.roundId === null));
  const potNodes = new Map(root.children.map(n => [n.id, n]));
  const potIds = new Set<string>(), slots = new Set<number>(), roundIds = new Set<string>();
  const pots = (g.pots as unknown[]).map(value => {
    const p = object(value, ["nodeId", "slot", "roundId"]);
    check(validId(p.nodeId) && !potIds.has(p.nodeId as string) && potNodes.has(p.nodeId as string));
    check(Number.isInteger(p.slot) && Number(p.slot) >= 0 && Number(p.slot) <= 5 && !slots.has(Number(p.slot)));
    check(p.slot === 0 ? p.roundId === null : p.roundId === null || validId(p.roundId));
    check(p.roundId === null || !roundIds.has(p.roundId as string));
    const n = potNodes.get(p.nodeId as string)!;
    check(n.rule === null && n.children.every(c => c.children.length === 0 && c.rule !== null));
    potIds.add(p.nodeId as string); slots.add(Number(p.slot)); if (p.roundId !== null) roundIds.add(p.roundId as string);
    return { nodeId: p.nodeId as string, slot: Number(p.slot), roundId: p.roundId as string | null };
  });
  const leafNodes = new Map(root.children.flatMap(p => p.children.map(n => [n.id, { node: n, pot: pots.find(g => g.nodeId === p.id)! }] as const)));
  const groupIds = new Set<string>(), targets = new Set<string>();
  const groups = (g.groups as unknown[]).map(value => {
    const r = object(value, ["nodeId", "type", "method", "minimumFinishes", "eligibilityApproved"]);
    check(validId(r.nodeId) && !groupIds.has(r.nodeId as string) && leafNodes.has(r.nodeId as string));
    check(GUIDED_REWARD_TYPES.includes(r.type as GuidedRewardType) && (r.method === "ranked" || r.method === "proportional"));
    check(Number.isInteger(r.minimumFinishes) && Number(r.minimumFinishes) >= 1 && Number(r.minimumFinishes) <= 5 && typeof r.eligibilityApproved === "boolean");
    const { node, pot } = leafNodes.get(r.nodeId as string)!;
    const rule = node.rule!, participation = isParticipationType(r.type as GuidedRewardType);
    check(participation ? pot.slot === 0 && rule.basis === "participation" && rule.source === null :
      r.method === "ranked" && r.minimumFinishes === 1 && rule.basis === (r.type === "club_standings" ? "club_points" : pot.slot === 0 ? "league_position" : "race_position"));
    check(r.method === "proportional" ? rule.sharesBps.length === 0 : rule.sharesBps.length >= 1);
    if (rule.source) check(context && rule.source.draftId === context.draftId && rule.source.catalogueHash === context.catalogueHash && rule.source.roundId === pot.roundId);
    const target = `${pot.nodeId}:${r.type}:${rule.source?.categoryId ?? "unbound"}`;
    // Missing category sources may be resolved independently while drafting.
    if (participation || rule.source) { check(!targets.has(target)); targets.add(target); }
    groupIds.add(r.nodeId as string);
    return { nodeId: r.nodeId as string, type: r.type as GuidedRewardType, method: r.method as GuidedRewardGroup["method"], minimumFinishes: Number(r.minimumFinishes), eligibilityApproved: r.eligibilityApproved as boolean };
  });
  check(groupIds.size === leafNodes.size);
  return { version: 1, pots, groups, counting: "one_finish_per_round", clubAttribution: "represented_at_finish" };
}

export function guidedSetupReadiness(setup: RewardDistributionSetup): Array<"event" | "distribution" | "sources"> {
  const guided = setup.guided!;
  const issues: Array<"event" | "distribution" | "sources"> = [];
  if (!setup.context || guided.pots.some(p => p.slot > 0 && p.roundId === null)) issues.push("event");
  const nodes = [setup.root, ...setup.root.children, ...setup.root.children.flatMap(p => p.children)];
  if (nodes.some(n => {
    const group = guided.groups.find(g => g.nodeId === n.id);
    if (group?.method === "proportional") return false;
    const shares = n.rule ? n.rule.sharesBps : n.children.map(c => c.shareBps);
    return !shares.length || shares.reduce((a, b) => a + b, 0) !== 10000;
  })) issues.push("distribution");
  if (!guided.groups.length || guided.groups.some(g => !g.eligibilityApproved ||
    !isParticipationType(g.type) && !nodes.find(n => n.id === g.nodeId)!.rule!.source)) issues.push("sources");
  return issues;
}
