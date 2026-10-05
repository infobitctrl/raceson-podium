import { createHash } from "node:crypto";
import { inspectNativeFinaleSourceV3, type NativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { historicalFixture } from "./historicalSourceV3.fixture";
// Test-only synthetic source; never imported by a route.
export function nativeFinaleFixture() {
  const source: NativeFinaleSourceV3 = {
  "observedAt": "2026-09-10T05:00:00.000Z",
  "document": {
    "schema": "raceson-native-finale-source-v3",
    "draftId": "8e000000-0000-4000-8000-000000000001",
    "chainId": 31337,
    "organizationId": "8e000000-0000-4000-8000-000000000002",
    "recordRevision": 1,
    "binding": {
      "id": "8e000000-0000-4000-8000-000000000003",
      "editionId": "8e000000-0000-4000-8000-000000000004",
      "races": [
        {
          "competitionId": "8e000000-0000-4000-8000-000000000005",
          "raceId": "8e000000-0000-4000-8000-000000000006"
        }
      ]
    },
    "edition": {
      "id": "8e000000-0000-4000-8000-000000000004",
      "status": "completed",
      "isPractice": true,
      "removed": false
    },
    "races": [
      {
        "raceId": "8e000000-0000-4000-8000-000000000006",
        "competitionId": "8e000000-0000-4000-8000-000000000005",
        "status": "completed",
        "removed": false,
        "resultsMode": "standard",
        "distanceMetres": "5000",
        "review": {
          "schema": "raceson-result-review-v3",
          "categoryId": "8e000000-0000-4000-8000-000000000006",
          "organizationId": "8e000000-0000-4000-8000-000000000002",
          "state": "final",
          "revision": 1,
          "reviewSeconds": 0,
          "policyId": "8e000000-0000-4000-8000-000000000007",
          "configuredAt": "2026-09-10T03:00:00.000Z",
          "locked": true,
          "held": false,
          "startedAt": "2026-09-10T04:00:00.000Z",
          "startedByPublicationId": "8e000000-0000-4000-8000-000000000008",
          "endsAt": "2026-09-10T04:00:00.000Z",
          "latestPublicationId": "8e000000-0000-4000-8000-000000000008",
          "finalPublicationId": "8e000000-0000-4000-8000-000000000008",
          "officialPublishedAt": "2026-09-10T04:00:00.000Z",
          "allocationApproved": false
        },
        "publication": {
          "id": "8e000000-0000-4000-8000-000000000008",
          "raceId": "8e000000-0000-4000-8000-000000000006",
          "runId": "8e000000-0000-4000-8000-000000000009",
          "state": "official",
          "publishedAt": "2026-09-10T04:00:00.000Z"
        },
        "run": {
          "id": "8e000000-0000-4000-8000-000000000009",
          "raceId": "8e000000-0000-4000-8000-000000000006",
          "status": "succeeded",
          "completedAt": "2026-09-10T03:59:00.000Z"
        },
        "expectedResultCount": 1,
        "rows": [
          {
            "id": "8e000000-0000-4000-8000-000000000010",
            "raceId": "8e000000-0000-4000-8000-000000000006",
            "runId": "8e000000-0000-4000-8000-000000000009",
            "athleteId": "8e000000-0000-4000-8000-000000000011",
            "clubId": "8e000000-0000-4000-8000-000000000012",
            "registrationMatches": true,
            "participationStatus": "finished",
            "resultStatus": "official",
            "finishTimeMs": "1800000",
            "rankOverall": 1,
            "clubPoints": "25.00"
          }
        ]
      }
    ]
  }
};
  const record = { ...historicalFixture().context.record, draftId: source.document.draftId, organizationId: source.document.organizationId };
  const data = { ...source, sourceHash: createHash("sha256").update(canonical(source.document)).digest("hex"), inspection: inspectNativeFinaleSourceV3(source) };
  return { record, bindingId: source.document.binding!.id, data };
}
