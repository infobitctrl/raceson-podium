import {allocateRewardWeights, compareRewardKeys} from "./arithmetic.js";
import {decodeSavedRewardSetup, previewRewardSetup, setupId} from "./distribution-setup.js";
import {decodeRewardAllocationSourceV3, type RewardAllocationSourceV3} from "./allocation-preview-v3.js";
import {createSponsorExecutionPlan, decodeSponsorExecutionPlan, type SponsorExecutionPlan} from "./sponsor-execution.js";
import {sponsorLaunchPlan, type SponsorLaunch} from "./sponsor-launch.js";

/** Private source-adapter references. These must come from authenticated current
 * source reads, never a sponsor's assertions. The minimized sporting facts keep
 * their existing schema; this is NOT a V3 allocation/ledger record. */
export type SponsorSourceBinding = {
  draftId: string; catalogueHash: string; sourceLeagueId: string; sourceSeasonId: string;
};
export type SponsorAllocationHold = "not_connected" | "source_changed" | "source_missing" |
  "source_held" | "incomplete_results" | "ambiguous_results" | "league_not_final" |
  "standings_missing" | "incomplete_standings" | "invalid_standings" |
  "missing_distance" | "club_attribution_unresolved";
export type SponsorCalculatedAward = {
  beneficiaryId: string; amountWei: bigint; rank: number | null; weight: bigint | null; sourceRowIds: string[];
};
const check = (v: unknown): void => {if (!v) throw Error("invalid_sponsor_allocation");};
const equal = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Exact sponsor economics applied to official sporting ranks. Never accepts a
 * wallet filter; unclaimed people keep their awards. Output is a private,
 * unapproved calculation, not executable publication/payment authority. */
export function previewSponsorAllocation(launch: SponsorLaunch, planInput: SponsorExecutionPlan,
  binding: SponsorSourceBinding | null, sourceInput: RewardAllocationSourceV3 | null) {
  const setup = decodeSavedRewardSetup(launch.setup), plan = decodeSponsorExecutionPlan(planInput);
  const c = setup.configuration, budget = previewRewardSetup(c), launchPlan = sponsorLaunchPlan(setup);
  check(launch.state === "prepared" && launch.id === plan.launchId && setup.chainId === plan.chainId && setup.revision === plan.setupRevision
    && launch.configurationHash === plan.configurationHash && launchPlan.complete && c.version === 5 && c.guided);
  check(JSON.stringify(plan) === JSON.stringify(createSponsorExecutionPlan(launch, plan.funder,
    {operator: plan.operator, treasury: plan.unallocatedTreasury, reviewPeriods: plan.reviewPeriods,
      ...(plan.version === 5 ? {walletRegistry:plan.walletRegistry!,identityIssuer:plan.identityIssuer!} : {})})));
  const guided = c.guided!;
  const source = sourceInput === null ? null : decodeRewardAllocationSourceV3(sourceInput);
  if (binding) check(Object.keys(binding).sort().join() === ["catalogueHash", "draftId", "sourceLeagueId", "sourceSeasonId"].join()
    && [binding.draftId, binding.sourceLeagueId, binding.sourceSeasonId].every(setupId) && /^[0-9a-f]{64}$/.test(binding.catalogueHash));
  const connected = binding && c.context && binding.draftId === c.context.draftId && binding.catalogueHash === c.context.catalogueHash;
  const sourceMatches = connected && source && binding.sourceLeagueId === source.sourceLeagueId && binding.sourceSeasonId === source.sourceSeasonId;
  const roundHolds: Array<SponsorAllocationHold | null> = Array.from({length: 5}, (_, i) => {
    if (!connected) return "not_connected";
    if (!source) return "source_missing";
    if (!sourceMatches) return "source_changed";
    const r = source.rounds[i]!, expected = guided.pots.find(p => p.slot === i + 1)!.roundId;
    if (!expected || !r.roundId || !r.evidence) return "source_missing";
    if (expected !== r.roundId) return "source_changed";
    if (r.evidence.held) return "source_held";
    if (!r.resultsComplete || r.results.length !== r.expectedResultCount) return "incomplete_results";
    // A start in another race (including DNS/DNF/DSQ) is not a second
    // qualifying finish. Duplicate finishes are checked against each award's
    // scope below, rather than blocking every category in the round.
    if (r.results.some(r => r.status === "unknown")) return "ambiguous_results";
    return null;
  });
  const digests = source?.rounds.flatMap(r => r.evidence ? [r.evidence.digest] : []) ?? [];
  const leagueHold: SponsorAllocationHold | null = !connected ? "not_connected" : !source ? "source_missing" : !sourceMatches ? "source_changed"
    : roundHolds.some(Boolean) || !source.league ? "league_not_final" : source.league.evidence.held ? "source_held"
    : !equal(source.league.roundDigests, digests) || source.rounds.some(r => r.evidence!.publishedAt > source.league!.evidence.publishedAt) ? "source_changed" : null;
  const pots = [...guided.pots].sort((a, b) => a.slot - b.slot).map(pot => {
    const node = c.root.children.find(n => n.id === pot.nodeId)!;
    const cap = budget.rows.find(r => r.id === node.id)!.amountWei!;
    check(cap !== null && cap.toString() === plan.caps[pot.slot]);
    const groups = node.children.map(node => {
      const group = guided.groups.find(g => g.nodeId === node.id)!, preview = budget.rows.find(r => r.id === node.id)!;
      const amount = preview.amountWei!, slots = preview.slots, rule = node.rule!;
      check(amount !== null);
      const beneficiaryKind = group.type === "club_standings" || group.type === "club_metres" ? "club" as const : "athlete" as const;
      let hold: SponsorAllocationHold | null = pot.slot === 0 ? leagueHold : roundHolds[pot.slot - 1]!;
      let awards: SponsorCalculatedAward[] = [];
      const finishedByRound = source ? (pot.slot === 0 ? source.rounds : [source.rounds[pot.slot - 1]!]).map(r => r.results.filter(r => r.status === "finished")) : [];
      const finished = finishedByRound.flat();
      if (group.type === "athlete_standings" || group.type === "club_standings") {
        const ref = rule.source, category = source?.categories.find(c => c.id === ref?.categoryId);
        if (!ref) hold ??= "not_connected";
        else if (ref.draftId !== binding?.draftId || ref.catalogueHash !== binding?.catalogueHash || ref.roundId !== pot.roundId
          || category?.target !== (beneficiaryKind === "athlete" ? "individual" : "club")) hold ??= "source_changed";
        const table = source?.standings.find(t => t.slot === (pot.slot || null) && t.categoryId === ref?.categoryId);
        if (!table) hold ??= "standings_missing";
        if (!hold && table && source) {
          const evidence = pot.slot === 0 ? source.league!.evidence : source.rounds[pot.slot - 1]!.evidence!;
          const expectedDigests = pot.slot === 0 ? digests : [evidence.digest];
          if (table.evidence.held) hold = "source_held";
          else if (!table.complete) hold = "incomplete_standings";
          else if (!equal(table.roundDigests, expectedDigests) || table.evidence.publishedAt < evidence.publishedAt) hold = "source_changed";
          // The source adapter attests category completeness. Unclassified
          // finishes elsewhere cannot invalidate an attested complete table;
          // neither can they be inserted into this category by inference.
          else if (beneficiaryKind === "athlete" && finishedByRound.some(rows => duplicateAthlete(rows.filter(r => r.categoryId === category!.id)))) hold = "ambiguous_results";
          else {
            const eligible = new Set(finished.filter(r => beneficiaryKind === "club" ? r.clubId !== null : r.categoryId === category!.id)
              .map(r => beneficiaryKind === "club" ? r.clubId! : r.athleteId));
            if (table.rows.some(r => !eligible.has(r.beneficiaryId)) || pot.slot > 0 && beneficiaryKind === "athlete" && table.rows.length !== eligible.size) hold = "invalid_standings";
            if (pot.slot > 0 && beneficiaryKind === "athlete" && table.rows.some(r => !finished.some(result => result.id === r.sourceRowId
              && result.athleteId === r.beneficiaryId && result.categoryId === category!.id))) hold = "invalid_standings";
            for (let i = 0; !hold && i < table.rows.length;) {
              if (table.rows[i]!.rank !== i + 1) {hold = "invalid_standings"; break;}
              const rank = table.rows[i]!.rank;
              do {i++;} while (i < table.rows.length && table.rows[i]!.rank === rank);
            }
          }
          if (!hold) awards = ranked(slots, table.rows.map(r => ({beneficiaryId: r.beneficiaryId, rank: r.rank, weight: null, sourceRowIds: [r.sourceRowId]})));
        }
      } else if (!hold) {
        // Participation explicitly allows one finish per round. When there
        // are two official finishes, do not pick a distance or double-count
        // the athlete; this ambiguity holds participation only.
        if (finishedByRound.some(duplicateAthlete)) hold = "ambiguous_results";
        const byAthlete = new Map<string, typeof finished>();
        for (const row of finished) {const rows = byAthlete.get(row.athleteId) ?? []; rows.push(row); byAthlete.set(row.athleteId, rows);}
        const eligible = finished.filter(r => byAthlete.get(r.athleteId)!.length >= group.minimumFinishes);
        if (group.type !== "athlete_finishes" && eligible.some(r => r.distanceMetres === null)) hold ??= "missing_distance";
        // A null historical club is not proof of a reviewed unaffiliated finish.
        if (group.type === "club_metres" && eligible.some(r => r.clubId === null)) hold ??= "club_attribution_unresolved";
        if (!hold) {
          const contributions = new Map<string, {weight: bigint; sourceRowIds: string[]}>();
          for (const row of eligible) {
            const id = beneficiaryKind === "club" ? row.clubId! : row.athleteId;
            const v = contributions.get(id) ?? {weight: 0n, sourceRowIds: []};
            v.weight += group.type === "athlete_finishes" ? 1n : BigInt(row.distanceMetres!);
            v.sourceRowIds.push(row.id); contributions.set(id, v);
          }
          const candidates = [...contributions].map(([beneficiaryId, v]) => ({beneficiaryId, ...v, sourceRowIds: v.sourceRowIds.sort(compareRewardKeys)}))
            .sort((a, b) => a.weight === b.weight ? compareRewardKeys(a.beneficiaryId, b.beneficiaryId) : a.weight > b.weight ? -1 : 1);
          if (group.method === "proportional") {
            const amounts = new Map(allocateRewardWeights(amount, candidates.map(r => ({key: r.beneficiaryId, weight: r.weight}))).allocations.map(r => [r.key, r.amount]));
            awards = candidates.map(r => ({...r, rank: null, amountWei: amounts.get(r.beneficiaryId)!}));
          } else {
            let rank = 0;
            awards = ranked(slots, candidates.map((r, i) => {if (!i || r.weight !== candidates[i - 1]!.weight) rank = i + 1; return {...r, rank};}));
          }
        }
      }
      if (amount === 0n) {hold = null; awards = [];}
      awards = awards.filter(r => r.amountWei > 0n).sort((a, b) => compareRewardKeys(a.beneficiaryId, b.beneficiaryId));
      const proposedWei = awards.reduce((sum, r) => sum + r.amountWei, 0n);
      check(proposedWei <= amount && (!hold || proposedWei === 0n));
      return {groupId: node.id, type: group.type, beneficiaryKind, budgetWei: amount, proposedWei, retainedWei: amount - proposedWei, hold, awards};
    });
    const recipients = new Map<string, {beneficiaryId: string; beneficiaryKind: "athlete" | "club"; amountWei: bigint; groupIds: string[]}>();
    for (const g of groups) for (const r of g.awards) {
      const key = `${g.beneficiaryKind}:${r.beneficiaryId}`, prior = recipients.get(key) ?? {...r, beneficiaryKind: g.beneficiaryKind, amountWei: 0n, groupIds: []};
      prior.amountWei += r.amountWei; prior.groupIds.push(g.groupId); recipients.set(key, prior);
    }
    const proposedWei = groups.reduce((sum, g) => sum + g.proposedWei, 0n);
    check(groups.reduce((sum, g) => sum + g.budgetWei, 0n) === cap);
    return {slot: pot.slot, budgetWei: cap, proposedWei, retainedWei: cap - proposedWei, groups,
      recipients: [...recipients].sort(([a], [b]) => compareRewardKeys(a, b)).map(([, r]) => ({beneficiaryId: r.beneficiaryId,
        beneficiaryKind: r.beneficiaryKind, amountWei: r.amountWei, groupIds: r.groupIds.sort(compareRewardKeys)}))};
  });
  const proposedWei = pots.reduce((sum, p) => sum + p.proposedWei, 0n);
  check(budget.budgetWei.toString() === plan.budgetWei);
  return {schema: "raceson-sponsor-allocation-preview-v4" as const, state: "unapproved" as const, payableWei: 0n,
    launchId: launch.id, setupRevision: setup.revision, configurationHash: launch.configurationHash,
    sourceKind: source?.kind ?? null, budgetWei: budget.budgetWei, proposedWei, retainedWei: budget.budgetWei - proposedWei, pots};
}

function duplicateAthlete(rows: Array<{athleteId: string}>): boolean {
  return new Set(rows.map(row => row.athleteId)).size !== rows.length;
}

function ranked(slots: bigint[], rows: Array<Omit<SponsorCalculatedAward, "amountWei"> & {rank: number}>): SponsorCalculatedAward[] {
  const awards: SponsorCalculatedAward[] = [];
  for (let i = 0; i < rows.length;) {
    let end = i + 1; while (end < rows.length && rows[end]!.rank === rows[i]!.rank) end++;
    const group = rows.slice(i, end), occupied = slots.slice(i, end).reduce((n, s) => n + s, 0n);
    const amounts = new Map(allocateRewardWeights(occupied, group.map(r => ({key: r.beneficiaryId, weight: 1n}))).allocations.map(r => [r.key, r.amount]));
    for (const r of group) awards.push({...r, amountWei: amounts.get(r.beneficiaryId)!});
    i = end;
  }
  return awards;
}
