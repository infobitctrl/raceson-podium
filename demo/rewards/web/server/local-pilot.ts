import {resolve} from "node:path";
import { spawn } from "node:child_process";

const root = resolve(process.cwd(), "../../..");
/** Server-only, explicitly armed local runner. No shell, request-derived command,
 * inherited application credentials, token arguments or operator impersonation. */
export function localPilotRunner() {
  const digest = process.env.RACESON_REWARD_LOCAL_PILOT_SOURCE_SHA;
  if (process.env.NODE_ENV !== "development" || process.env.RACESON_REWARD_PORTAL_MODE !== "local-testnet" ||
    process.env.RACESON_REWARD_DEMO_ORIGIN !== "http://127.0.0.1:3102" ||
    process.env.RACESON_REWARD_DEMO_SUPABASE_URL !== "http://127.0.0.1:55321" || !/^[0-9a-f]{64}$/.test(digest ?? "")) return undefined;
  return (identity: { userId: string; sessionId: string }, round: 2 | 3 | 4, change: unknown, signal: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(Error("reward_pilot_unavailable")); return; }
    const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT"].filter(k => process.env[k]).map(k => [k, process.env[k]!]));
    const child = spawn(process.execPath, [root + "/demo/rewards/scripts/privy-testnet-pilot-ui.mjs"], {
      cwd: root, env: { ...env, NODE_ENV: "development", RACESON_REWARD_LOCAL_PILOT_SOURCE_SHA: digest! }, stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "", done = false;
    const stop = () => { child.kill("SIGTERM"); };
    const timeout = setTimeout(stop, 10 * 60 * 1000);
    signal.addEventListener("abort", stop, { once: true });
    const finish = (error?: Error, value?: unknown) => { if (done) return; done = true; clearTimeout(timeout);
      signal.removeEventListener("abort", stop); if (error) reject(error); else resolve(value); };
    child.stdout!.on("data", chunk => { output += chunk; if (output.length > 65536) { stop(); finish(Error("reward_pilot_unavailable")); } });
    child.on("error", () => finish(Error("reward_pilot_unavailable")));
    child.stdin!.on("error", () => finish(Error("reward_pilot_unavailable")));
    child.on("exit", code => {
      try { const value = JSON.parse(output); if (code !== 0 || value.error || signal.aborted) throw Error(value.error ?? "reward_pilot_unavailable"); finish(undefined, value); }
      catch (error) { finish(error instanceof Error ? error : Error("reward_pilot_unavailable")); }
    });
    child.stdin!.end(JSON.stringify({ identity, round, change: change ?? null }));
  });
}
