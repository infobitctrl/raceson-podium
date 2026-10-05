import type { TranslationKey } from "@/shared/i18n/messages";
import { requirePortal, rewardRecord, walletAddress } from "./athleteRewards";
import { claimInteger, claimTimestamp } from "./athleteClaims";

export type RewardNetwork = 10143 | 31337;
export type OrganizerProgramme = { programmeId: string; organizationId: string; seasonId: string; year: number;
  leagueName: string | null; seasonName: string | null; budgetWei: string; createdAt: string };
export type OrganizerDestination = { requestId: string; athleteProfileId: string; athleteName: string | null;
  address: string; requestedAt: string; destinationStatus: "pending_review" | "identity_hold" | "withdrawn" };
export type OrganizerPage<T> = { chainId: RewardNetwork; items: T[]; nextCursor: string | null };
export type OrganizerSelection = Pick<OrganizerDestination, "requestId" | "athleteProfileId" | "address" | "requestedAt"> & {
  programmeId: string; chainId: RewardNetwork;
};
export const reviewStates = ["unreviewed", "reviewed", "revoked", "profile_changed", "identity_hold", "age_hold", "request_withdrawn"] as const;
export const revocationReasons = ["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"] as const;
export type RevocationReason = typeof revocationReasons[number];
export type OrganizerReview = { reviewId: string; revision: number; reviewedAt: string; profileFingerprintSha256: string;
  revokedAt: string | null; revocationReason: RevocationReason | null };
export type OrganizerReadiness = OrganizerSelection & { destinationStatus: OrganizerDestination["destinationStatus"];
  dateOfBirth: string | null; birthYear: number | null; profileFingerprintSha256: string;
  reviewState: typeof reviewStates[number]; latestReview: OrganizerReview | null };
export const evidenceFields = ["identityEvidenceRef", "adultEvidenceRef", "walletMfaEvidenceRef", "walletRecoveryEvidenceRef"] as const;
export type ReviewAttestation = Record<typeof evidenceFields[number], string> & {
  schemaVersion: 1; policy: "operator-observed-external-wallet-v1"; verifiedDateOfBirth: string;
};
export type OrganizerReviewInput = { expectedProfileFingerprintSha256: string; expectedRevision: number;
  attestation: ReviewAttestation; idempotencyKey: string };

export const organizerUuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  && value !== "00000000-0000-0000-0000-000000000000";
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const reviewDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function record(value: unknown, keys: string[]) {
  const d = rewardRecord(value, keys), fields = Object.getOwnPropertyDescriptors(d);
  requirePortal((Object.getPrototypeOf(d) === Object.prototype || Object.getPrototypeOf(d) === null)
    && Object.getOwnPropertySymbols(d).length === 0 && Object.keys(fields).length === keys.length
    && keys.every(k => fields[k].enumerable && "value" in fields[k])); return d;
}
const label = (value: unknown): value is string | null => value === null || (typeof value === "string"
  && value.length > 0 && value.trim() === value && [...value].length <= 256);
const address = (value: unknown): value is string => walletAddress(value) && value === value.toLowerCase();
const destinationStatus = (value: unknown) => value === "pending_review" || value === "identity_hold" || value === "withdrawn";

export function decodeOrganizerProgramme(value: unknown): OrganizerProgramme {
  const d = record(value, ["programmeId", "organizationId", "seasonId", "year", "leagueName", "seasonName", "budgetWei", "createdAt"]);
  requirePortal(organizerUuid(d.programmeId) && organizerUuid(d.organizationId) && organizerUuid(d.seasonId)
    && typeof d.year === "number" && Number.isInteger(d.year) && d.year >= 2000 && d.year <= 2200
    && label(d.leagueName) && label(d.seasonName) && claimInteger(d.budgetWei) && BigInt(d.budgetWei) >= 9n && claimTimestamp(d.createdAt));
  return { ...d } as OrganizerProgramme;
}
export function decodeOrganizerDestination(value: unknown): OrganizerDestination {
  const d = record(value, ["requestId", "athleteProfileId", "athleteName", "address", "requestedAt", "destinationStatus"]);
  requirePortal(organizerUuid(d.requestId) && organizerUuid(d.athleteProfileId) && label(d.athleteName) && address(d.address)
    && claimTimestamp(d.requestedAt) && destinationStatus(d.destinationStatus)); return { ...d } as OrganizerDestination;
}
export function decodeOrganizerPage<T>(value: unknown, chainId: RewardNetwork, after: string | null,
  decode: (raw: unknown) => T, id: (item: T) => string, programmeId?: string): OrganizerPage<T> {
  requirePortal((chainId === 31337 || chainId === 10143) && (after === null || organizerUuid(after))
    && (programmeId === undefined || organizerUuid(programmeId)));
  const d = record(value, ["chainId", "items", "nextCursor", ...(programmeId ? ["programmeId"] : [])]);
  requirePortal(d.chainId === chainId && (!programmeId || d.programmeId === programmeId) && Array.isArray(d.items) && d.items.length <= 25);
  let previous = after;
  const items = Array.from(d.items, raw => { const item = decode(raw), key = id(item);
    requirePortal(previous === null || key > previous); previous = key; return item; });
  requirePortal(d.nextCursor === null || (items.length === 25 && organizerUuid(d.nextCursor) && d.nextCursor === previous));
  return { chainId, items, nextCursor: d.nextCursor as string | null };
}
export function decodeOrganizerSelection(value: unknown): OrganizerSelection {
  const d = record(value, ["programmeId", "requestId", "athleteProfileId", "address", "requestedAt", "chainId"]);
  requirePortal(organizerUuid(d.programmeId) && organizerUuid(d.requestId) && organizerUuid(d.athleteProfileId)
    && address(d.address) && claimTimestamp(d.requestedAt) && (d.chainId === 10143 || d.chainId === 31337));
  return { ...d } as OrganizerSelection;
}
export function decodeOrganizerReview(value: unknown): OrganizerReview {
  const d = record(value, ["reviewId", "revision", "reviewedAt", "profileFingerprintSha256", "revokedAt", "revocationReason"]);
  requirePortal(organizerUuid(d.reviewId) && Number.isInteger(d.revision) && (d.revision as number) > 0 && (d.revision as number) < 2147483647
    && claimTimestamp(d.reviewedAt) && fingerprint(d.profileFingerprintSha256)
    && (d.revokedAt === null ? d.revocationReason === null : claimTimestamp(d.revokedAt) && Date.parse(d.revokedAt) >= Date.parse(d.reviewedAt)
      && revocationReasons.some(reason => reason === d.revocationReason))); return { ...d } as OrganizerReview;
}
export function decodeOrganizerReadiness(value: unknown, selected: OrganizerSelection): OrganizerReadiness {
  const scope = decodeOrganizerSelection(selected), d = record(value, [...Object.keys(scope), "destinationStatus", "dateOfBirth",
    "birthYear", "profileFingerprintSha256", "reviewState", "latestReview"]);
  requirePortal(Object.entries(scope).every(([k, v]) => d[k] === v) && destinationStatus(d.destinationStatus)
    && (d.dateOfBirth === null || reviewDate(d.dateOfBirth)) && (d.birthYear === null || Number.isInteger(d.birthYear))
    && fingerprint(d.profileFingerprintSha256) && reviewStates.some(state => state === d.reviewState));
  const latestReview = d.latestReview === null ? null : decodeOrganizerReview(d.latestReview);
  requirePortal(latestReview === null || Date.parse(latestReview.reviewedAt) >= Date.parse(scope.requestedAt));
  // The backend owns age/identity decisions. Only reject contradictions in an
  // explicitly reviewed/revoked state; do not manufacture adulthood in JS.
  if (d.reviewState === "reviewed") requirePortal(latestReview !== null && latestReview.revokedAt === null
    && latestReview.profileFingerprintSha256 === d.profileFingerprintSha256 && d.dateOfBirth !== null && d.destinationStatus === "pending_review");
  if (d.reviewState === "revoked") requirePortal(latestReview?.revokedAt != null);
  if (d.reviewState === "unreviewed") requirePortal(latestReview === null);
  return { ...scope, destinationStatus: d.destinationStatus as OrganizerDestination["destinationStatus"], dateOfBirth: d.dateOfBirth as string | null,
    birthYear: d.birthYear as number | null, profileFingerprintSha256: d.profileFingerprintSha256,
    reviewState: d.reviewState as OrganizerReadiness["reviewState"], latestReview };
}
export function decodeOrganizerReviewInput(value: unknown): OrganizerReviewInput {
  const d = record(value, ["expectedProfileFingerprintSha256", "expectedRevision", "attestation", "idempotencyKey"]);
  const a = record(d.attestation, ["schemaVersion", "policy", "verifiedDateOfBirth", ...evidenceFields]);
  requirePortal(fingerprint(d.expectedProfileFingerprintSha256) && Number.isInteger(d.expectedRevision)
    && (d.expectedRevision as number) >= 0 && (d.expectedRevision as number) <= 2147483645
    && typeof d.idempotencyKey === "string" && d.idempotencyKey.length >= 8 && d.idempotencyKey.length <= 128
    && a.schemaVersion === 1 && a.policy === "operator-observed-external-wallet-v1" && reviewDate(a.verifiedDateOfBirth)
    && evidenceFields.every(k => organizerUuid(a[k])));
  return { expectedProfileFingerprintSha256: d.expectedProfileFingerprintSha256, expectedRevision: d.expectedRevision as number,
    idempotencyKey: d.idempotencyKey, attestation: { ...a } as ReviewAttestation };
}
export function decodeOrganizerReviewReply(value: unknown, selected: OrganizerSelection): OrganizerReview {
  const d = record(value, ["programmeId", "requestId", "chainId", "review"]);
  requirePortal(d.programmeId === selected.programmeId && d.requestId === selected.requestId && d.chainId === selected.chainId);
  const review = decodeOrganizerReview(d.review); requirePortal(Date.parse(review.reviewedAt) >= Date.parse(selected.requestedAt)); return review;
}
export function organizerAccessLost(error: unknown) {
  return !!error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403);
}
export function organizerErrorKey(error: unknown): TranslationKey {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (status === 401) return "rewards.error.signIn";
  if (status === 403) return "rewards.organizer.error.permission";
  if (status === 404) return "rewards.organizer.error.missing";
  if (status === 409) return "rewards.organizer.error.changed";
  if (status === 400) return "rewards.organizer.error.input";
  return "rewards.organizer.error.generic";
}
