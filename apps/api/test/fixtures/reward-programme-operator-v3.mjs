import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createProgrammeOperatorClientV3 } from "../../../../packages/db/dist/rewards/index.js";

/** Synthetic Auth authority, in memory and usable only with this explicit test
 * fetch. SDK signature verification is real; this is NOT a Supabase login or
 * hosted Auth acceptance. SQL tests independently check real auth.sessions rows. */
export function programmeOperatorAuthFixtureV3(identity, rpc, createOperatorClient = createProgrammeOperatorClientV3) {
  const target = { mode: "local", chainId: 31337, origin: "http://127.0.0.1:3101", supabaseUrl: "http://127.0.0.1:55321" };
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }), kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const token = (patch = {}) => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: `${target.supabaseUrl}/auth/v1`, aud: "authenticated", role: "authenticated",
      sub: identity.userId, session_id: identity.sessionId, is_anonymous: false,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...patch })).toString("base64url");
    const body = `${header}.${payload}`;
    return `${body}.${sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const credentials = { accessToken: token(), publishableKey: `sb_publishable_${"synthetic_v3".repeat(3)}`,
    serverKey: `sb_secret_${"synthetic_v3".repeat(3)}` };
  const calls = [];
  const clientFactory = options => createOperatorClient(options, async request => {
    calls.push(request.url);
    let value, status = 200;
    if (request.url === `${target.supabaseUrl}/auth/v1/.well-known/jwks.json`) {
      assert.equal(request.method, "GET"); assert.equal(request.headers.get("apikey"), credentials.publishableKey);
      value = { keys: [jwk] };
    } else {
      assert.equal(request.method, "POST"); assert.equal(request.headers.get("apikey"), credentials.serverKey);
      const prefix = `${target.supabaseUrl}/rest/v1/rpc/`;
      assert.ok(request.url.startsWith(prefix));
      const args = await request.json();
      assert.equal(args.p_actor_user_id, identity.userId); assert.equal(args.p_actor_session_id, identity.sessionId);
      const result = await rpc(request.url.slice(prefix.length), args);
      value = result.error ?? result.data; status = result.error ? 400 : 200;
    }
    const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: request.url }); return response;
  });
  return { target, credentials, token, clientFactory, calls };
}
