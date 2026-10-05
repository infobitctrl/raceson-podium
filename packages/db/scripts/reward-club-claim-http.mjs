import assert from "node:assert/strict";
import { dispatchClubRewardRoutes } from "../../../apps/api/dist/routes/rewards/clubs.js";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { applyPrivateSessionHeaders } from "../../../apps/api/dist/browser-session.js";

// Actual router -> services -> caller-owned scratch SQL/chain. Auth identity is
// synthetic/injected here; this is not a hosted HTTP/Auth or browser signer test.
export function clubClaimHttp({ rpc, reader, programmeId }) {
  const root = `/api/v1/organizer/rewards/programmes/${programmeId}/club-claims`;
  async function call(identity, method, path, body, overrides = {}) {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
    const dispatch = path.startsWith("/api/v1/organizer/") ? dispatchOrganizerRewardRoutes : dispatchClubRewardRoutes;
    assert.equal(await dispatch({ method, headers: {} }, res, new URL(path, "http://127.0.0.1:3101"), {
      config: () => ({ chainId: 31337, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => identity,
      rpc, clubClaimReader: reader, applyPrivateSessionHeaders, readJsonBody: async () => { assert.equal(method, "POST"); return body; },
      sendSuccess: (r, data) => r.end(JSON.stringify({ data })),
      sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); }, ...overrides,
    }), true);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
    if (res.statusCode !== 200) { const e = new Error(res.body.error.code); e.code = res.body.error.code; e.status = res.statusCode; throw e; }
    assert.doesNotMatch(JSON.stringify(res.body), /"(?:signature|signatures|sessionId|userId|actorUserId|operatorUserId|chainWitness|idempotencyKey|relayerAddress|signedTransaction|leaseToken)"/);
    return res.body.data;
  }
  const path = r => r.role === "operator" ? `${root}/${r.intentId}/approval` : `/api/v1/athlete/rewards/club-claims/${r.intentId}/consent`;
  return { call, root,
    prepare: (who, request, overrides) => call(who, "POST", root, { ...request, confirmPrepare: true }, overrides),
    review: (who, request, overrides) => call(who, "GET", path(request), undefined, overrides),
    submit: (who, r, overrides) => call(who, "POST", path(r), { signature: r.signature, idempotencyKey: r.idempotencyKey,
      [r.role === "operator" ? "confirmApproval" : "confirmConsent"]: true }, overrides) };
}
