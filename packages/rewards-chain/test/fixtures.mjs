import { aggregateRewardEntitlements, calculateLeagueRewards, calculateRoundRewards, splitRewardProgramme } from "@raceson/domain/rewards";
import { keccak256, stringToHex } from "viem";
import { commitPrivateRewardDocument, hashPublicRewardRules, prepareRewardCampaignUpload } from "../dist/index.js";

// Deterministic synthetic fixtures only. These predictable hashes are NOT a production
// random-ID/salt generator, and none of these rows represent actual historical results.
export const h = (value) => keccak256(stringToHex(`synthetic test only:${value}`));
export const roundIds = ["r1", "r2", "r3", "r4", "r5"];
export const totalBudget = 100n * 10n ** 18n;
export const budgets = splitRewardProgramme(totalBudget, roundIds);
export const latestPublicationAt = 1_800_000_000n;
export const rulesHash = hashPublicRewardRules({ version: 1, racePercent: 60, leaguePercent: 40, testTokensOnly: true });
const classifications = ["short-u16-female", "short-u16-male", "short-adult-female", "short-adult-male", "short-senior", "long-female", "long-male"];

export function finishesFor(roundId) {
  return [
    ["private-athlete-a", "private-club-one", "M", "short", "short-adult-male", 6000n, 10000n, 100n],
    ["private-athlete-b", "private-club-two", "F", "long", "long-female", 9000n, 15000n, 90n],
    ["private-athlete-c", "private-club-one", "M", "short", "short-adult-male", 6000n, 12000n, 80n],
  ].map(([athleteId, representedClubId, gender, raceId, classificationId, distanceMetres, finishTimeMs, clubPoints]) => ({
    sourceId: `${roundId}-${athleteId}`, publicationId: `${roundId}-publication`, roundId, raceId, athleteId, representedClubId,
    gender, classificationIds: [classificationId], courseComparisonKey: `${raceId}-course`, distanceMetres, finishTimeMs,
    clubPoints, participationStatus: "finished", resultStatus: "official",
  }));
}
export function roundResult(roundId = "r1") {
  const finishes = finishesFor(roundId);
  return calculateRoundRewards({ programmeId: "private-programme", roundId, raceStartsAtMs: 1_799_000_000_000n,
    budgetWei: budgets.rounds.find((row) => row.key === roundId).amount, finishes,
    podiums: classifications.map((classificationId) => ({ classificationId, approvalId: `${roundId}-${classificationId}-review`,
      entries: finishes.filter((row) => row.classificationIds.includes(classificationId)).map((row, index) => ({ sourceId: row.sourceId, rank: index + 1 })) })),
    records: ["short", "long"].flatMap((raceId) => ["M", "F"].map((gender) => ({ id: `${raceId}-${gender}`, raceId, gender, baseline: null }))),
  });
}
export function leagueResult() {
  return calculateLeagueRewards({ programmeId: "private-programme", scopeId: "rounds-1-5", roundIds,
    budgetWei: budgets.leagueBudget, finishes: roundIds.flatMap(finishesFor) });
}
export function bindingsFor(result) {
  return aggregateRewardEntitlements(result).map((row) => ({ beneficiaryKind: row.beneficiaryKind, beneficiaryId: row.beneficiaryId,
    opaqueBeneficiaryId: h(`beneficiary:${row.beneficiaryKind}:${row.beneficiaryId}`),
    entitlementId: h(`entitlement:${row.campaignScopeId}:${row.beneficiaryKind}:${row.beneficiaryId}`),
    explanationSalt: h(`salt:${row.campaignScopeId}:${row.beneficiaryKind}:${row.beneficiaryId}`),
  }));
}
export function commitmentInput(result) {
  return { programmeId: h("programme"), campaignId: h(result.campaignScopeId), programmeManifestHash: rulesHash,
    snapshotDigest: commitPrivateRewardDocument("snapshot", result, h(`snapshot salt:${result.campaignScopeId}`)), latestPublicationAt };
}
export function proposalFor(result = roundResult()) {
  return prepareRewardCampaignUpload(result, commitmentInput(result), bindingsFor(result));
}
