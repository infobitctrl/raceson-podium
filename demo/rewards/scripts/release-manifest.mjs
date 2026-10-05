import { rewardDemoTarget } from "@raceson/domain/rewards/environment";

// These are identity boundaries, not proof of provider access or owner approval.
export const DEMO_REPOSITORY = "infobitctrl/raceson-podium";
export const DEMO_REMOTE = "https://github.com/infobitctrl/raceson-podium.git";
export const DEMO_WEB_ROOT = "demo/rewards/web";
export const DEMO_VERCEL_TEAM = "team_i5HAdgm9ScGP1ql20LPoduop";
export const DEMO_SUPABASE_ORGANIZATION = "ayhoscdbhndksmbozfaf";
const productionVercelProject = "prj_fs6FD31qnADjsnDajAI5mypY3uSY";

export function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

/** Only non-secret release metadata. Never accept credentials, arbitrary CLI
 * flags, a production-web root, or a local/mainnet target in this format. */
export function validateDemoReleaseManifest(input) {
  const fail = () => { throw new Error("reward_demo_release_manifest_invalid"); };
  if (!exactKeys(input, ["formatVersion", "kind", "repository", "sourceCommit", "chainId", "origin", "vercel", "supabase"])
    || input.formatVersion !== 1 || input.kind !== "raceson-rewards-testnet"
    || input.repository !== DEMO_REPOSITORY || input.chainId !== 10143
    || typeof input.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(input.sourceCommit)
    || !exactKeys(input.vercel, ["teamId", "projectId", "environment", "rootDirectory"])
    || input.vercel.teamId !== DEMO_VERCEL_TEAM || input.vercel.environment !== "production"
    || input.vercel.rootDirectory !== DEMO_WEB_ROOT
    || typeof input.vercel.projectId !== "string" || !/^prj_[A-Za-z0-9]{8,64}$/.test(input.vercel.projectId)
    || input.vercel.projectId === productionVercelProject
    || !exactKeys(input.supabase, ["organizationId", "projectRef"])
    || input.supabase.organizationId !== DEMO_SUPABASE_ORGANIZATION
    || typeof input.supabase.projectRef !== "string" || !/^[a-z]{20}$/.test(input.supabase.projectRef)) return fail();
  const target = rewardDemoTarget({ mode: "testnet", origin: input.origin,
    supabaseUrl: `https://${input.supabase.projectRef}.supabase.co` });
  if (!target) return fail();
  // Reconstruct a deterministic, minimal value; caller object ordering does not
  // affect the digest, and no unrecognized/private fields can be serialized.
  return {
    formatVersion: 1, kind: "raceson-rewards-testnet", repository: DEMO_REPOSITORY,
    sourceCommit: input.sourceCommit, chainId: 10143, origin: target.origin,
    vercel: { teamId: DEMO_VERCEL_TEAM, projectId: input.vercel.projectId,
      environment: "production", rootDirectory: DEMO_WEB_ROOT },
    supabase: { organizationId: DEMO_SUPABASE_ORGANIZATION, projectRef: input.supabase.projectRef },
  };
}
