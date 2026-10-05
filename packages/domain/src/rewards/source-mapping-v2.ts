import { allocateRewardWeights, requireReward } from "./arithmetic.js";
import { previewRewardProgrammeDraftV2, previewRewardRankSlotsV2, type RewardProgrammeDraftV2 } from "./programme-draft-v2.js";

// This is a private planning catalogue, not frozen result evidence or eligibility.
export type RewardSourceCatalogueV2 = {
  rounds: Array<{ id: string; editionId: string; slot: number; name: string; date: string; status: string;
    races: Array<{ id: string; competitionId: string; name: string; distanceMetres: string | null;
      publicationId: string | null; publicationState: string | null; resultCount: number }> }>;
  categories: Array<{ id: string; competitionId: string; competitionName: string; name: string;
    target: "individual" | "club"; eligibility: Record<string, unknown> }>;
};
export type RewardCategoryShareV2 = { categoryId: string; shareBps: number };
export type RewardSourceMappingV2 = {
  version: 2;
  rounds: Array<{ slot: number; roundId: string | null; categories: RewardCategoryShareV2[] }>;
  leagueCategories: RewardCategoryShareV2[];
};
export type RewardMappingWorkspaceV2 = {
  draftId: string; revision: number; rulesRevision: number; catalogueHash: string; boundCatalogueHash: string | null;
  mapping: RewardSourceMappingV2; catalogue: RewardSourceCatalogueV2;
};
const code = "invalid_v2_source_mapping";
function obj(v: unknown, keys: string[]) {
  requireReward(v && typeof v === "object" && !Array.isArray(v), code);
  const r = v as Record<string, unknown>;
  requireReward(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k)), code);
  return r;
}
function integer(v: unknown, max: number, min = 0): number {
  requireReward(typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max, code); return v;
}
function label(v: unknown): string {
  requireReward(typeof v === "string" && v.trim().length > 0 && v.length <= 512, code); return v;
}
function uuid(v: unknown): string {
  requireReward(typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
    && v !== "00000000-0000-0000-0000-000000000000", code); return v;
}
function rows(v: unknown, max: number): unknown[] { requireReward(Array.isArray(v) && v.length <= max, code); return v; }
function unique(values: string[]) { requireReward(new Set(values).size === values.length, code); }
function hash(v: unknown): string { requireReward(typeof v === "string" && /^[0-9a-f]{64}$/.test(v), code); return v; }
function shares(v: unknown): RewardCategoryShareV2[] {
  const result = rows(v, 64).map(value => { const r = obj(value, ["categoryId", "shareBps"]);
    return { categoryId: uuid(r.categoryId), shareBps: integer(r.shareBps, 10000) }; });
  unique(result.map(r => r.categoryId));
  return result.sort((a, b) => a.categoryId < b.categoryId ? -1 : 1);
}
export function emptyRewardSourceMappingV2(): RewardSourceMappingV2 {
  return { version: 2, rounds: Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, roundId: null, categories: [] })), leagueCategories: [] };
}
export function decodeRewardSourceMappingV2(value: unknown): RewardSourceMappingV2 {
  const r = obj(value, ["version", "rounds", "leagueCategories"]);
  requireReward(r.version === 2, code);
  const rounds = rows(r.rounds, 5).map((value, i) => {
    const row = obj(value, ["slot", "roundId", "categories"]);
    requireReward(row.slot === i + 1, code);
    return { slot: i + 1, roundId: row.roundId === null ? null : uuid(row.roundId), categories: shares(row.categories) };
  });
  requireReward(rounds.length === 5, code);
  unique(rounds.flatMap(r => r.roundId ? [r.roundId] : []));
  return { version: 2, rounds, leagueCategories: shares(r.leagueCategories) };
}
export function decodeRewardSourceCatalogueV2(value: unknown): RewardSourceCatalogueV2 {
  const r = obj(value, ["rounds", "categories"]);
  const rounds = rows(r.rounds, 64).map(value => {
    const row = obj(value, ["id", "editionId", "slot", "name", "date", "status", "races"]);
    const date = label(row.date); requireReward(/^\d{4}-\d{2}-\d{2}$/.test(date), code);
    const races = rows(row.races, 64).map(value => {
      const race = obj(value, ["id", "competitionId", "name", "distanceMetres", "publicationId", "publicationState", "resultCount"]);
      requireReward(race.distanceMetres === null || (typeof race.distanceMetres === "string" && /^[1-9]\d{0,8}$/.test(race.distanceMetres)), code);
      return { id: uuid(race.id), competitionId: uuid(race.competitionId), name: label(race.name), distanceMetres: race.distanceMetres as string | null,
        publicationId: race.publicationId === null ? null : uuid(race.publicationId),
        publicationState: race.publicationState === null ? null : label(race.publicationState), resultCount: integer(race.resultCount, 1000000) };
    });
    unique(races.map(r => r.competitionId));
    return { id: uuid(row.id), editionId: uuid(row.editionId), slot: integer(row.slot, 1000, 1), name: label(row.name), date, status: label(row.status), races };
  });
  const categories = rows(r.categories, 64).map((value): RewardSourceCatalogueV2["categories"][number] => {
    const row = obj(value, ["id", "competitionId", "competitionName", "name", "target", "eligibility"]);
    requireReward(row.target === "individual" || row.target === "club", code);
    requireReward(row.eligibility && typeof row.eligibility === "object" && !Array.isArray(row.eligibility)
      && JSON.stringify(row.eligibility).length <= 8192, code);
    const eligibility = { ...row.eligibility as Record<string, unknown> };
    // Published age limits such as 15.99 are descriptive metadata, not money.
    // Preserve their decimal value as text at the integer-only reward transport
    // boundary; do not weaken the ledger serializer or infer a runner's age.
    for (const key of ["minimumAge", "maximumAge"]) if (typeof eligibility[key] === "number") {
      const value = eligibility[key]; requireReward(Number.isFinite(value) && value >= 0 && value <= 150, code);
      if (!Number.isInteger(value)) eligibility[key] = String(value);
    }
    return { id: uuid(row.id), competitionId: uuid(row.competitionId), competitionName: label(row.competitionName),
      name: label(row.name), target: row.target, eligibility };
  });
  unique(rounds.map(r => r.id)); unique(rounds.map(r => r.editionId)); unique(categories.map(r => r.id));
  return { rounds, categories };
}
/** Partial drafts are allowed; unknown IDs and spending beyond a family are not. */
export function validateRewardSourceMappingV2(value: unknown, catalogue: RewardSourceCatalogueV2) {
  const mapping = decodeRewardSourceMappingV2(value);
  for (const round of mapping.rounds) {
    if (round.roundId) requireReward(catalogue.rounds.some(r => r.id === round.roundId && r.slot === round.slot && r.status !== "cancelled"), code);
  }
  for (const shares of [...mapping.rounds.map(r => r.categories), mapping.leagueCategories]) {
    let individual = 0, club = 0;
    for (const share of shares) {
      const category = catalogue.categories.find(c => c.id === share.categoryId); requireReward(category, code);
      if (category.target === "club") club += share.shareBps; else individual += share.shareBps;
    }
    requireReward(individual <= 10000 && club <= 10000, code);
  }
  return mapping;
}
export function decodeRewardMappingWorkspaceV2(value: unknown): RewardMappingWorkspaceV2 {
  const r = obj(value, ["draftId", "revision", "rulesRevision", "catalogueHash", "boundCatalogueHash", "mapping", "catalogue"]);
  // A previously saved mapping can reference removed catalogue entries. Keep it
  // visible for correction, but never validate/activate it silently on reads.
  return { draftId: uuid(r.draftId), revision: integer(r.revision, 2147483645), rulesRevision: integer(r.rulesRevision, 2147483645, 1),
    catalogueHash: hash(r.catalogueHash), boundCatalogueHash: r.boundCatalogueHash === null ? null : hash(r.boundCatalogueHash),
    mapping: decodeRewardSourceMappingV2(r.mapping), catalogue: decodeRewardSourceCatalogueV2(r.catalogue) };
}
/** Category → prize-slot explanation. No beneficiary, wallet, award or receipt. */
export function previewRewardSourceMappingV2(rules: RewardProgrammeDraftV2, value: unknown, catalogue: RewardSourceCatalogueV2) {
  const mapping = validateRewardSourceMappingV2(value, catalogue), budget = previewRewardProgrammeDraftV2(rules);
  return [...mapping.rounds.map((r, i) => ({ key: `round-${r.slot}`, categories: r.categories, families: budget.rounds[i]!.families, weights: rules.raceRankWeights })),
    { key: "league", categories: mapping.leagueCategories, families: budget.leagueFamilies, weights: rules.leagueRankWeights }].map(pot => ({
      key: pot.key, families: pot.families.map(family => {
        const target = family.key === "athlete_standings" ? "individual" : family.key === "club_standings" ? "club" : null;
        const selected = target ? pot.categories.filter(s => catalogue.categories.find(c => c.id === s.categoryId)!.target === target) : [];
        const unusedBps = 10000 - selected.reduce((n, s) => n + s.shareBps, 0);
        const split = allocateRewardWeights(family.amount, [...selected.map(s => ({ key: s.categoryId, weight: BigInt(s.shareBps) })), { key: "unassigned", weight: BigInt(unusedBps) }]).allocations;
        return { key: family.key, amountWei: family.amount, unassignedWei: split.find(s => s.key === "unassigned")!.amount,
          categories: selected.map(s => { const amountWei = split.find(a => a.key === s.categoryId)!.amount;
            return { categoryId: s.categoryId, amountWei, slots: previewRewardRankSlotsV2(amountWei, pot.weights) }; }) };
      }),
    }));
}
