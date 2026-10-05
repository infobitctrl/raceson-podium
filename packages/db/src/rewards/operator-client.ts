import { createClient } from "@supabase/supabase-js";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { verifiedRequestIdentityFromClaims } from "../account.js";
import { loadServerEnv } from "../env.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardLedgerRpc } from "./programme-ledger.js";

const unavailable = () => new Error("reward_operator_transport_unavailable");
const denied = () => new Error("reward_operator_auth_required");
type Fetch = typeof globalThis.fetch;
const legacyMethods = ["service_next_reward_operator_job", "service_reward_operator_session_call"] as const;
// V3 has its own authenticated private SQL boundary; never use the V1 session
// dispatcher or grant this delivery client reservation/signing/queue authority.
const programmeMethodsV3 = ["service_read_reward_programme_lifecycle_v3", "service_read_reward_programme_lifecycle_job_v3",
  "service_step_reward_programme_lifecycle_job_v3"] as const;
const programmeSigningMethodsV3 = ["service_read_reward_programme_lifecycle_v3", "service_record_reward_programme_lifecycle_attempt_v3"] as const;
const paymentMethodsV3 = ["service_read_reward_athlete_payment_v3", "service_change_reward_athlete_payment_v3"] as const;
const paymentDeliveryActionsV3 = ["lease", "arm", "submitted", "confirm"];
const paymentSigningMethodsV3 = [...paymentMethodsV3] as const;
const clubPaymentMethodsV3 = ["service_read_reward_club_payment_v3", "service_change_reward_club_payment_v3"] as const;
const clubPaymentSigningMethodsV3 = [...clubPaymentMethodsV3] as const;
const paymentActions = (methods: readonly string[]) => methods === paymentMethodsV3 ? paymentDeliveryActionsV3
  : methods === paymentSigningMethodsV3 ? ["attempt"]
  : methods === clubPaymentMethodsV3 ? paymentDeliveryActionsV3
  : methods === clubPaymentSigningMethodsV3 ? ["attempt"] : null;
const paymentChangeMethod = (methods: readonly string[]) => methods === clubPaymentMethodsV3 || methods === clubPaymentSigningMethodsV3
  ? "service_change_reward_club_payment_v3" : "service_change_reward_athlete_payment_v3";

/** One credential destination, two Auth GETs and two private RPC POSTs only.
 * No inherited .env, redirects, token refresh, browser storage or Auth writes.
 * Each request bounds headers AND body, including a stalled response stream. */
export function rewardOperatorFetch(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, legacyMethods, fetchImpl, timeoutMs);
}
export function rewardProgrammeOperatorFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, programmeMethodsV3, fetchImpl, timeoutMs);
}
export function rewardProgrammeSigningFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, programmeSigningMethodsV3, fetchImpl, timeoutMs);
}
export function rewardPaymentOperatorFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, paymentMethodsV3, fetchImpl, timeoutMs);
}
export function rewardPaymentSigningFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, paymentSigningMethodsV3, fetchImpl, timeoutMs);
}
export function rewardClubPaymentOperatorFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, clubPaymentMethodsV3, fetchImpl, timeoutMs);
}
export function rewardClubPaymentSigningFetchV3(target: RewardDemoTarget, signal: AbortSignal,
  fetchImpl: Fetch = globalThis.fetch, timeoutMs = 10_000): Fetch {
  return scopedOperatorFetch(target, signal, clubPaymentSigningMethodsV3, fetchImpl, timeoutMs);
}
function scopedOperatorFetch(target: RewardDemoTarget, signal: AbortSignal, methods: readonly string[],
  fetchImpl: Fetch, timeoutMs: number): Fetch {
  const fixed = rewardDemoTarget(target);
  if (!fixed || fixed.chainId !== target.chainId || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw unavailable();
  return async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); } catch { throw unavailable(); }
    const allowed = new Map([
      [`${fixed.supabaseUrl}/auth/v1/.well-known/jwks.json`, "GET"],
      [`${fixed.supabaseUrl}/auth/v1/user`, "GET"],
      ...methods.map(method => [`${fixed.supabaseUrl}/rest/v1/rpc/${method}`, "POST"] as const),
    ]);
    if (allowed.get(request.url) !== request.method || signal.aborted || request.signal.aborted) throw unavailable();
    if (paymentActions(methods) && request.url.endsWith("/" + paymentChangeMethod(methods))) {
      try {
        // The SDK sends a finite JSON string. Do not drain a caller-controlled
        // request stream outside the timed response/abort boundary below.
        if (typeof init?.body !== "string" || Buffer.byteLength(init.body) > 128 * 1024) throw unavailable();
        const body = JSON.parse(init.body);
        if (!body || !paymentActions(methods)!.includes(body.p_action)) throw unavailable();
      } catch { throw unavailable(); }
    }
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, request.signal, controller.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(unavailable());
      combined.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
    });
    const read = async () => {
      const response = await fetchImpl(request, { redirect: "error", cache: "no-store", credentials: "omit", signal: combined });
      if (combined.aborted || response.redirected || response.url !== request.url
        || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable();
      const limit = request.method === "GET" ? 256 * 1024 : 8 * 1024 * 1024;
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw unavailable();
      if (!response.body) throw unavailable();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read();
        if (combined.aborted) throw unavailable();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw unavailable();
        chunks.push(part.value);
      }
      // The SDK may inspect an error body, but neither cookies nor arbitrary
      // provider headers escape into callers or the operator's output.
      return new Response(Buffer.concat(chunks, size), { status: response.status,
        headers: { "content-type": "application/json" } });
    };
    try { return await Promise.race([read(), stopped]); }
    catch { throw unavailable(); }
    finally {
      clearTimeout(timer);
      if (onAbort) combined.removeEventListener("abort", onAbort);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  };
}

type OperatorClientInput = {
  target: RewardDemoTarget; publishableKey: string; serverKey: string; signal: AbortSignal;
};
export function createRewardOperatorClient(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, legacyMethods, fetchImpl);
}
export function createProgrammeOperatorClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, programmeMethodsV3, fetchImpl);
}
export function createProgrammeSigningClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, programmeSigningMethodsV3, fetchImpl);
}
export function createPaymentOperatorClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, paymentMethodsV3, fetchImpl);
}
export function createPaymentSigningClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, paymentSigningMethodsV3, fetchImpl);
}
export function createClubPaymentOperatorClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, clubPaymentMethodsV3, fetchImpl);
}
export function createClubPaymentSigningClientV3(input: OperatorClientInput, fetchImpl?: Fetch) {
  return createScopedOperatorClient(input, clubPaymentSigningMethodsV3, fetchImpl);
}
function createScopedOperatorClient(input: OperatorClientInput, methods: readonly string[], fetchImpl: Fetch = globalThis.fetch) {
  const target = rewardDemoTarget(input.target);
  const { publishableKey, serverKey, signal } = input;
  if (!target || target.chainId !== input.target.chainId
    || typeof publishableKey !== "string" || !/^sb_publishable_[\x21-\x7e]{16,512}$/.test(publishableKey)
    || typeof serverKey !== "string" || !/^sb_secret_[\x21-\x7e]{16,512}$/.test(serverKey)) throw unavailable();
  const transport = scopedOperatorFetch(target, signal, methods, fetchImpl, 10_000);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } };
  const auth = createClient(target.supabaseUrl, publishableKey, options);
  const admin = createClient(target.supabaseUrl, serverKey, options);
  // Explicit values only: loadServerEnv is never allowed to inspect process.env.
  const environment = loadServerEnv({ SUPABASE_URL: target.supabaseUrl, SUPABASE_ANON_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serverKey, APP_BASE_URL: target.origin,
    RACESON_REWARD_PORTAL_MODE: target.mode, RACESON_REWARD_DEMO_ORIGIN: target.origin,
    RACESON_REWARD_DEMO_SUPABASE_URL: target.supabaseUrl });
  let authenticated: { userId: string; sessionId: string; expiresAtMs: number } | null = null;
  let authenticationGeneration = 0;
  const authenticate = async (accessToken: string, expectedUserId: string) => {
    const generation = ++authenticationGeneration;
    authenticated = null;
    const expected = uuid(expectedUserId);
    if (typeof accessToken !== "string" || accessToken.length < 1 || accessToken.length > 8192 || signal.aborted) throw denied();
    let verified;
    try { verified = await auth.auth.getClaims(accessToken); } catch { throw unavailable(); }
    const claims = verified.data?.claims;
    const identity = claims ? verifiedRequestIdentityFromClaims(claims, environment) : null;
    if (generation !== authenticationGeneration || verified.error || !claims || !identity || identity.userId !== expected || claims.is_anonymous !== false
      || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now() + 5000 || signal.aborted) throw denied();
    authenticated = { ...identity, expiresAtMs: claims.exp * 1000 };
    return { identity, expiresAtMs: claims.exp * 1000 };
  };
  const rpc: RewardLedgerRpc = async (method, args) => {
    if (!authenticated || signal.aborted || Date.now() >= authenticated.expiresAtMs
      || args.p_actor_user_id !== authenticated.userId || args.p_actor_session_id !== authenticated.sessionId
      || !methods.includes(method)
      || (methods !== legacyMethods && args.p_chain_id !== target.chainId)
      || (paymentActions(methods) && method === paymentChangeMethod(methods)
        && !paymentActions(methods)!.includes(args.p_action as string))) throw denied();
    try { return await admin.rpc(method, args); }
    catch { throw unavailable(); }
  };
  return { authenticate, rpc };
}
