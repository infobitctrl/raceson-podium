export type OrganizerClubAwardScopeV3 = { chainId: 31337 | 10143; uploadId: string; draftId: string;
  approvalId: string; slot: number; campaignAddress: string };
export type OrganizerClubAwardV3 = { entitlementId: string; clubId: string; clubName: string | null; amountWei: string;
  nomination: null | { requestId: string; address: string; status: "pending_review" | "withdrawn" | "identity_hold" };
  claim: null | { claimId: string; requestId: string; recipientAddress: string; recipientConsented: boolean; operatorApproved: boolean } };
export type OrganizerClubAwardsV3 = OrganizerClubAwardScopeV3 & { schema: "raceson-organizer-club-awards-v3";
  allocationRevision: "latest" | "superseded"; items: OrganizerClubAwardV3[]; nextCursor: string | null };
const check = (v: unknown): void => { if (!v) throw Error("invalid_reward_organizer_club_query"); };
function object(v: unknown, keys: string[]) {
  check(v !== null && typeof v === "object" && !Array.isArray(v));
  const d = Object.getOwnPropertyDescriptors(v);
  check(Object.getOwnPropertySymbols(v).length === 0 && Object.keys(d).length === keys.length && keys.every(k => d[k] && "value" in d[k]));
  return Object.fromEntries(keys.map(k => [k, d[k].value])) as Record<string, unknown>;
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex = (v: unknown, n: number) => typeof v === "string" && new RegExp(`^0x[0-9a-f]{${n}}$`).test(v) && BigInt(v) > 0n;
export const organizerClubCursorV3 = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
export function decodeOrganizerClubAwardsV3(raw: unknown, chainId: number, uploadId: string, after: string | null = null): OrganizerClubAwardsV3 {
  const p = object(raw, ["schema", "chainId", "uploadId", "draftId", "approvalId", "slot", "campaignAddress", "allocationRevision", "items", "nextCursor"]);
  check([31337,10143].includes(chainId) && uuid(uploadId) && p.schema === "raceson-organizer-club-awards-v3"
    && p.chainId === chainId && p.uploadId === uploadId && uuid(p.draftId) && uuid(p.approvalId)
    && Number.isInteger(p.slot) && Number(p.slot) >= 1 && Number(p.slot) <= 6 && hex(p.campaignAddress,40)
    && ["latest","superseded"].includes(String(p.allocationRevision)) && (after === null || organizerClubCursorV3(after))
    && Array.isArray(p.items) && p.items.length <= 50);
  const rows = p.items as unknown[], descriptors = Object.getOwnPropertyDescriptors(rows); let previous = after;
  check(Object.getOwnPropertyNames(rows).length === rows.length + 1 && Object.getOwnPropertySymbols(rows).length === 0);
  const items = Array.from({length: rows.length}, (_, index) => {
    check(descriptors[index] && "value" in descriptors[index]);
    const r = object(descriptors[index].value, ["entitlementId", "clubId", "clubName", "amountWei", "nomination", "claim"]);
    check(hex(r.entitlementId,64) && (previous === null || String(r.entitlementId) > previous) && uuid(r.clubId)
      && (r.clubName === null || typeof r.clubName === "string" && r.clubName.trim().length > 0 && r.clubName.length <= 256)
      && typeof r.amountWei === "string" && /^[1-9][0-9]{0,77}$/.test(r.amountWei) && BigInt(r.amountWei) < (1n << 256n));
    previous = r.entitlementId as string;
    if (r.nomination !== null) { const n = object(r.nomination, ["requestId", "address", "status"]);
      check(uuid(n.requestId) && hex(n.address,40) && ["pending_review","withdrawn","identity_hold"].includes(String(n.status))); r.nomination = n; }
    if (r.claim !== null) { const c = object(r.claim, ["claimId","requestId","recipientAddress","recipientConsented","operatorApproved"]);
      check(uuid(c.claimId) && uuid(c.requestId) && hex(c.recipientAddress,40) && typeof c.recipientConsented === "boolean"
        && typeof c.operatorApproved === "boolean" && (!c.operatorApproved || c.recipientConsented)); r.claim = c; }
    return r as OrganizerClubAwardV3;
  });
  check(p.nextCursor === null || items.length === 50 && p.nextCursor === previous);
  return { ...p, items } as OrganizerClubAwardsV3;
}
