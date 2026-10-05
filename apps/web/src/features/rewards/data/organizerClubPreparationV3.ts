import { apiRequest } from "@/lib/api";
import { decodeClubConsentSelectionV3, decodeClubConsentRecordV3,
  type ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";

/** Supplied by authorized organizer discovery, never by the claim response. */
export type OrganizerClubSelectionV3 = { award: ClubConsentSelectionV3; clubId: string; slot: number };
const states = ["request_withdrawn", "identity_hold", "source_hold", "unreviewed", "revoked", "identity_changed", "reviewed"] as const;
export type OrganizerClubReadinessV3 = {
  schema: "raceson-club-readiness-v3"; chainId: 31337 | 10143; uploadId: string; requestId: string;
  clubId: string; slot: number; address: string; state: typeof states[number]; sourceCurrent: boolean;
  sourceGuardHash: string; identityFingerprint: string; reviewId: string | null;
  reviewedAt: string | null; revokedAt: string | null;
};
function object(raw: unknown, keys: readonly string[]) {
  requirePortal(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const fields = Object.getOwnPropertyDescriptors(raw);
  requirePortal(Object.getOwnPropertySymbols(raw).length === 0 && Object.keys(fields).length === keys.length
    && keys.every(k => fields[k] && "value" in fields[k]));
  return Object.fromEntries(keys.map(k => [k, fields[k].value])) as Record<string, unknown>;
}
function selection(raw: OrganizerClubSelectionV3): OrganizerClubSelectionV3 {
  const s = object(raw, ["award", "clubId", "slot"]), award = decodeClubConsentSelectionV3(s.award);
  requirePortal(rewardUuid(s.clubId) && Number.isInteger(s.slot) && Number(s.slot) >= 1 && Number(s.slot) <= 6
    && award.pot === (s.slot === 6 ? "league" : "race"));
  return { award, clubId: s.clubId, slot: Number(s.slot) };
}
const stamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const keys = ["schema", "chainId", "uploadId", "requestId", "clubId", "slot", "address", "state", "sourceCurrent",
  "sourceGuardHash", "identityFingerprint", "reviewId", "reviewedAt", "revokedAt"] as const;
export function decodeOrganizerClubReadinessV3(raw: unknown, input: OrganizerClubSelectionV3): OrganizerClubReadinessV3 {
  const s = selection(input), r = object(raw, keys);
  requirePortal(r.schema === "raceson-club-readiness-v3" && r.chainId === s.award.chainId && r.uploadId === s.award.uploadId
    && r.requestId === s.award.requestId && r.clubId === s.clubId && r.slot === s.slot && r.address === s.award.recipientAddress
    && states.includes(r.state as typeof states[number]) && typeof r.sourceCurrent === "boolean"
    && hash(r.sourceGuardHash) && hash(r.identityFingerprint));
  requirePortal(r.reviewId === null ? r.reviewedAt === null && r.revokedAt === null
    : rewardUuid(r.reviewId) && stamp(r.reviewedAt) && (r.revokedAt === null || stamp(r.revokedAt)
      && Date.parse(r.revokedAt) >= Date.parse(r.reviewedAt)));
  if (r.state === "reviewed") requirePortal(r.reviewId !== null && r.revokedAt === null && r.sourceCurrent);
  if (r.state === "unreviewed") requirePortal(r.reviewId === null && r.sourceCurrent);
  if (r.state === "revoked") requirePortal(r.revokedAt !== null);
  if (r.state === "identity_changed") requirePortal(r.reviewId !== null);
  return r as OrganizerClubReadinessV3;
}
function base(s: OrganizerClubSelectionV3) {
  return `/v1/organizer/rewards/uploads/${s.award.uploadId}/club-treasuries/${s.award.requestId}`;
}
export async function getOrganizerClubReadinessV3(input: OrganizerClubSelectionV3) {
  const s = selection(input); requireClaimNetwork(s.award.chainId);
  const raw = await apiRequest<unknown>({ path: `${base(s)}/readiness-v3`, cache: "no-store" });
  requireClaimNetwork(s.award.chainId); return decodeOrganizerClubReadinessV3(raw, s);
}
export type OrganizerClubPreparationCommandV3 = {
  selection: OrganizerClubSelectionV3;
  body: { reviewId: string; sourceGuardHash: string; identityFingerprint: string };
};
/** Capture once after an explicit review. Reuse unchanged for uncertain retries.
 * Amount, recipient, nonce and expiry are derived/checked on the server. */
export function makeOrganizerClubPreparationV3(input: OrganizerClubSelectionV3, raw: unknown): OrganizerClubPreparationCommandV3 {
  const s = selection(input), r = decodeOrganizerClubReadinessV3(raw, s);
  requireClaimNetwork(s.award.chainId); requirePortal(r.state === "reviewed" && r.reviewId);
  return Object.freeze({ selection: Object.freeze({ ...s, award: Object.freeze(s.award) }),
    body: Object.freeze({ reviewId: r.reviewId, sourceGuardHash: r.sourceGuardHash, identityFingerprint: r.identityFingerprint }) });
}
/** Preparation only: never invokes a wallet, collects consent or starts payment. */
export async function prepareOrganizerClubClaimV3(command: OrganizerClubPreparationCommandV3) {
  const c = object(command, ["selection", "body"]), s = selection(c.selection as OrganizerClubSelectionV3);
  const b = object(c.body, ["reviewId", "sourceGuardHash", "identityFingerprint"]);
  requirePortal(rewardUuid(b.reviewId) && hash(b.sourceGuardHash) && hash(b.identityFingerprint));
  requireClaimNetwork(s.award.chainId);
  const raw = await apiRequest<unknown>({ path: `${base(s)}/awards/${s.award.entitlementId}/claims/${s.award.claimId}/prepare`,
    method: "POST", cache: "no-store", body: { ...b } });
  requireClaimNetwork(s.award.chainId);
  // An exact retry may return consent already collected elsewhere. This is
  // historical claim metadata, not fresh eligibility or a paid receipt.
  return decodeClubConsentRecordV3(raw, s.award);
}
