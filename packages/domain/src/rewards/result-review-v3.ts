/** Sporting finality only. This DTO never authorizes an allocation or payment. */
export interface RewardResultReviewV3 {
  schema: "raceson-result-review-v3";
  categoryId: string; organizationId: string; observedAt: string;
  state: "unconfigured" | "awaiting_provisional" | "in_review" | "awaiting_final" | "final" | "held";
  revision: number; reviewSeconds: number | null; policyId: string | null;
  configuredAt: string | null; locked: boolean; held: boolean;
  startedAt: string | null; startedByPublicationId: string | null; endsAt: string | null;
  latestPublicationId: string | null; finalPublicationId: string | null; officialPublishedAt: string | null;
  allocationApproved: false;
}
const fail = (): never => { throw new Error("invalid_reward_result_review_response"); };
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
  && v !== "00000000-0000-0000-0000-000000000000";
const time = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
export function decodeRewardResultReviewV3(value: unknown): RewardResultReviewV3 {
  const keys = ["schema", "categoryId", "organizationId", "observedAt", "state", "revision", "reviewSeconds", "policyId",
    "configuredAt", "locked", "held", "startedAt", "startedByPublicationId", "endsAt", "latestPublicationId", "finalPublicationId", "officialPublishedAt", "allocationApproved"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every(key => fields[key]?.enumerable && "value" in fields[key]!)) return fail();
  const v = Object.fromEntries(keys.map(key => [key, fields[key]!.value])) as unknown as RewardResultReviewV3;
  if (v.schema !== "raceson-result-review-v3" || !uuid(v.categoryId) || !uuid(v.organizationId) || !time(v.observedAt)
    || !Number.isInteger(v.revision) || v.revision < 0 || v.revision > 2147483646 || typeof v.locked !== "boolean"
    || typeof v.held !== "boolean" || v.allocationApproved !== false) return fail();
  for (const key of ["policyId", "startedByPublicationId", "latestPublicationId", "finalPublicationId"] as const)
    if (v[key] !== null && !uuid(v[key])) return fail();
  for (const key of ["configuredAt", "startedAt", "endsAt", "officialPublishedAt"] as const)
    if (v[key] !== null && !time(v[key])) return fail();
  if (v.locked !== (v.latestPublicationId !== null)) return fail();
  if (v.policyId === null) {
    if (v.revision !== 0 || v.reviewSeconds !== null || v.configuredAt !== null || v.startedAt !== null || v.endsAt !== null
      || v.startedByPublicationId !== null || v.state !== "unconfigured") return fail();
  } else {
    if (v.revision < 1 || !Number.isInteger(v.reviewSeconds) || v.reviewSeconds! < 0 || v.reviewSeconds! > 2592000
      || v.configuredAt === null || Date.parse(v.configuredAt) > Date.parse(v.observedAt)) return fail();
    if (v.startedAt === null ? v.endsAt !== null || v.startedByPublicationId !== null : v.endsAt === null || v.startedByPublicationId === null
      || !v.locked || Date.parse(v.startedAt) < Date.parse(v.configuredAt)
      || Date.parse(v.endsAt) - Date.parse(v.startedAt) !== v.reviewSeconds! * 1000) return fail();
    const expected = v.held ? "held" : v.startedAt === null ? "awaiting_provisional"
      : Date.parse(v.observedAt) < Date.parse(v.endsAt!) ? "in_review" : v.finalPublicationId ? "final" : "awaiting_final";
    if (v.state !== expected) return fail();
  }
  if (v.state === "final") {
    if (!v.finalPublicationId || v.finalPublicationId !== v.latestPublicationId || v.officialPublishedAt === null || v.endsAt === null
      || Date.parse(v.officialPublishedAt) < Date.parse(v.endsAt) || Date.parse(v.officialPublishedAt) > Date.parse(v.observedAt)) return fail();
  } else if (v.finalPublicationId !== null || v.officialPublishedAt !== null) return fail();
  return v;
}
