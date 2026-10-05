import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { fileURLToPath } from "node:url";

// Test-only parent bridge. The validator owns the real scratch SQL connection
// and unforked chain. No database URL, real credential or signer key crosses IPC.
export function createRewardOperatorProcess({ identity, programmeId, reader, rpc, creationCode, gasPolicy, broadcast }) {
  const endpoint = new URL(reader.transport.url);
  assert.equal(endpoint.protocol, "http:"); assert.equal(endpoint.hostname, "127.0.0.1");
  assert.ok(endpoint.port); assert.equal(endpoint.pathname, "/"); assert.equal(endpoint.search, "");
  assert.equal(endpoint.username, ""); assert.equal(endpoint.password, ""); assert.equal(endpoint.hash, "");
  const target = { mode: "local", chainId: 31337, origin: "http://127.0.0.1:5173", supabaseUrl: "http://127.0.0.1:59999" };
  // Synthetic Auth signature only. The public JWK/token are supplied to the
  // actual SDK's verifier through a test fetch, not a mocked authenticate result.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID(); const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const credentials = () => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: `${target.supabaseUrl}/auth/v1`, aud: "authenticated", role: "authenticated",
      sub: identity.userId, session_id: identity.sessionId, is_anonymous: false,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    const body = `${header}.${payload}`;
    return { accessToken: `${body}.${sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`,
      publishableKey: `sb_publishable_${"a".repeat(32)}`, serverKey: `sb_secret_${"b".repeat(32)}` };
  };
  return async function run({ crashAt = null, jobId = null, workerId = randomUUID() } = {}) {
    assert.ok([null, "after_arm", "after_broadcast", "after_confirm"].includes(crashAt));
    assert.ok(!crashAt || jobId);
    const child = fork(fileURLToPath(new URL("./reward-operator-process-child.mjs", import.meta.url)), [], {
      env: { PATH: process.env.PATH, RACESON_REWARD_OWNED_PROCESS_TEST: "1" }, execArgv: [],
      serialization: "advanced", stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let result; let failure; let crashObserved = null; let stderrBytes = 0; let requests = 0;
    const pending = new Set(); const ids = new Set();
    const kill = reason => { failure ??= reason; child.kill("SIGKILL"); };
    const crash = point => { crashObserved = point; assert.equal(child.kill("SIGKILL"), true); };
    const send = message => { if (child.connected) child.send(message, error => { if (error && !crashObserved) kill("IPC response failed"); }); };
    const finished = new Promise(accept => {
      child.once("error", () => { failure = "child startup failed"; });
      child.once("close", (exitCode, signal) => accept({ exitCode, signal }));
      const timer = setTimeout(() => kill("child exceeded its bounded test session"), 45000);
      child.once("close", () => clearTimeout(timer));
      child.stderr.on("data", bytes => { stderrBytes += bytes.length; if (stderrBytes > 8192) kill("unexpected child diagnostic volume"); });
    });
    const handle = async message => {
      assert.ok(message && typeof message === "object");
      if (message.kind === "complete") { assert.equal(result, undefined); result = message.result; return; }
      if (message.kind === "failed") return kill("authenticated child command failed");
      assert.ok(Number.isSafeInteger(message.id) && message.id > 0 && !ids.has(message.id));
      ids.add(message.id); requests++; assert.ok(requests <= 5000);
      if (message.kind === "rpc") {
        assert.ok(["service_next_reward_operator_job", "service_reward_operator_session_call"].includes(message.method));
        assert.equal(message.args.p_actor_user_id, identity.userId); assert.equal(message.args.p_actor_session_id, identity.sessionId);
        if (message.method === "service_next_reward_operator_job") {
          assert.equal(message.args.p_programme_id, programmeId); assert.equal(message.args.p_chain_id, 31337);
        }
        const response = await rpc(message.method, message.args);
        const inner = message.args.p_arguments;
        if (!response.error && inner?.p_job_id === jobId) {
          if (crashAt === "after_arm" && inner.p_action === "arm") return crash(crashAt);
          if (crashAt === "after_confirm" && (inner.p_action === "confirm" || message.args.p_method.startsWith("service_confirm_reward_"))) return crash(crashAt);
        }
        send({ kind: "response", id: message.id, value: response }); return;
      }
      assert.equal(message.kind, "broadcast"); assert.match(message.bytes, /^0x(?:[a-f0-9]{2})+$/i);
      const hash = await broadcast(message.bytes);
      if (crashAt === "after_broadcast") return crash(crashAt);
      send({ kind: "response", id: message.id, value: hash });
    };
    child.on("message", message => {
      const work = handle(message).catch(() => kill("invalid bridge request or local operation failed"));
      pending.add(work); void work.finally(() => pending.delete(work));
    });
    try {
      send({ kind: "start", input: { target, ...credentials(), programmeId, operatorUserId: identity.userId, workerId, maxJobs: 1, durationMs: 30000 },
        jwk, endpoint: endpoint.href, creationCode, gasPolicy });
      const exit = await finished; await Promise.all([...pending]);
      assert.equal(failure, undefined, failure); assert.equal(stderrBytes, 0, "child diagnostics are not accepted as successful execution");
      if (crashAt) { assert.equal(crashObserved, crashAt); assert.equal(exit.exitCode, null); assert.equal(exit.signal, "SIGKILL"); assert.equal(result, undefined); }
      else { assert.equal(exit.exitCode, 0); assert.equal(exit.signal, null); assert.equal(result?.kind, "raceson-reward-operator-session"); }
      return { pid: child.pid, workerId, ...exit, crashAt: crashObserved, result, requests };
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await finished; }
      await Promise.all([...pending]);
    }
  };
}
