const MAX_RESPONSE_BYTES = 1024 * 1024;
class ProviderReadError extends Error {}
const fail = (code) => { throw new ProviderReadError(`reward_demo_observation_${code}`); };

/** Fixed provider-management origins only. No caller-supplied base URL,
 * redirects, mutation method, cookies, CLI authentication or environment pull. */
export async function readProviderJson(url, token, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { return fail("request_invalid"); }
  if (!["https://api.vercel.com", "https://api.supabase.com"].includes(parsed.origin)
    || parsed.username || parsed.password || parsed.hash
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) return fail("request_invalid");
  const controller = new AbortController();
  let timer;
  let reader;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderReadError("reward_demo_observation_timeout"));
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
      signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (controller.signal.aborted) return fail("timeout");
    if (response.status !== 200 || !response.ok || response.redirected || response.url !== url) return fail("http_failed");
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return fail("response_invalid");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) return fail("response_too_large");
    if (!response.body) return fail("response_invalid");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) return fail("timeout");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return fail("response_too_large");
      chunks.push(value);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
    catch { return fail("response_invalid"); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("response_invalid");
    return value;
  };
  try { return await Promise.race([request(), timeout]); }
  catch (error) {
    if (error instanceof ProviderReadError) throw error;
    return fail("http_failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Do not wait on an uncooperative response stream after a timeout/error.
    if (reader) void reader.cancel().catch(() => {});
  }
}
