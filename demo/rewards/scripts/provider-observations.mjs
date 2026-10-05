import { validateDemoReleaseManifest } from "./release-manifest.mjs";
import { readDemoReleaseSource, sha256 } from "./release-source.mjs";
import { readProviderJson } from "./provider-http.mjs";

const fail = (code) => { throw new Error(`reward_demo_observation_${code}`); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clockValue = (value) => Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000;
const tokenValid = (value) => typeof value === "string" && value.length >= 16 && value.length <= 8192
  && /^[A-Za-z0-9._~+/-]+=*$/.test(value);

function vercelProjectProjection(value, release) {
  if (!record(value) || value.id !== release.vercel.projectId || value.accountId !== release.vercel.teamId
    || value.rootDirectory !== release.vercel.rootDirectory || value.framework !== "nextjs"
    || value.nodeVersion !== "22.x" || value.commandForIgnoringBuildStep != null
    || (value.buildCommand != null && value.buildCommand !== "npm run build")
    || (value.installCommand != null && value.installCommand !== "npm ci")
    || value.outputDirectory != null) return fail("vercel_project_mismatch");
  if (value.link != null && (!record(value.link) || value.link.type !== "github"
    || `${value.link.org}/${value.link.repo}` !== release.repository)) return fail("vercel_repository_mismatch");
  return {
    projectId: value.id, teamId: value.accountId, rootDirectory: value.rootDirectory,
    framework: "nextjs", nodeVersion: "22.x", ignoredBuildStep: null,
    buildCommand: value.buildCommand ?? "package-default", installCommand: value.installCommand ?? "provider-default",
    outputDirectory: null, linkedRepository: value.link == null ? null : release.repository,
  };
}

function supabaseProjectProjection(value, release) {
  // Current management API distinguishes the opaque id from the project ref.
  // Neither an id/name resemblance nor an organization display name is identity.
  if (!record(value) || value.ref !== release.supabase.projectRef
    || value.organization_id !== release.supabase.organizationId || value.status !== "ACTIVE_HEALTHY"
    || !record(value.database) || typeof value.database.version !== "string" || !/^17\.\d/.test(value.database.version)
    || typeof value.region !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.region)) return fail("supabase_project_mismatch");
  return { projectRef: value.ref, organizationId: value.organization_id,
    status: "ACTIVE_HEALTHY", postgresMajor: 17, region: value.region };
}

function domainProjection(value, release) {
  const hostname = new URL(release.origin).hostname;
  if (!record(value) || value.name !== hostname || value.projectId !== release.vercel.projectId
    || value.verified !== true || value.redirect != null || value.gitBranch != null
    || value.customEnvironmentId != null || (value.target != null && value.target !== "production")) return fail("domain_mismatch");
  return { hostname, projectId: value.projectId, verified: true, binding: "default-production", redirect: null };
}

function authProjection(value, release) {
  if (!record(value) || value.site_url !== release.origin || value.mailer_autoconfirm !== false
    || value.mailer_allow_unverified_email_sign_ins !== false || value.external_email_enabled !== true
    || value.external_anonymous_users_enabled !== false || value.mailer_secure_email_change_enabled !== false
    || typeof value.disable_signup !== "boolean" || typeof value.uri_allow_list !== "string"
    || value.uri_allow_list.length > 16_384) return fail("auth_configuration_mismatch");
  // Only reviewed callback forms are projected. No arbitrary query strings,
  // private values, cross-host globs or raw Auth configuration are returned.
  const paths = ["", "/", "/auth", "/auth?*", "/auth/reset", "/auth/reset?*",
    "/athlete/account", "/athlete/account?*", "/**"];
  const allowed = new Set(paths.map((path) => `${release.origin}${path}`));
  const redirects = value.uri_allow_list === "" ? [] : value.uri_allow_list.split(",").map((item) => item.trim());
  if (redirects.length > 64 || new Set(redirects).size !== redirects.length
    || redirects.some((item) => !allowed.has(item))) return fail("auth_redirect_mismatch");
  return {
    siteOrigin: release.origin, redirectPaths: redirects.map((item) => item.slice(release.origin.length)).sort(),
    emailConfirmationRequired: true, unverifiedEmailSignInAllowed: false, emailPasswordEnabled: true,
    anonymousUsersEnabled: false, secureDoubleEmailChange: false, signupDisabled: value.disable_signup,
  };
}

/** A read-only, non-atomic provider observation, NOT a release capability.
 * Source and transport injection exist for local tests/programmatic callers;
 * the executable CLI fixes both to the actual Git reader and native HTTPS. */
export async function observeDemoProviders(input, {
  expectedPlanDigest, vercelReadToken, supabaseReadToken,
  readSource = readDemoReleaseSource, fetchImpl = fetch, now = Date.now, timeoutMs = 15_000,
} = {}) {
  const release = validateDemoReleaseManifest(input);
  if (typeof expectedPlanDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedPlanDigest)) return fail("plan_digest_required");
  if (!tokenValid(vercelReadToken) || !tokenValid(supabaseReadToken) || vercelReadToken === supabaseReadToken) return fail("read_tokens_required");
  const source = readSource(release);
  if (source?.planDigest !== expectedPlanDigest) return fail("plan_mismatch");
  const started = now();
  if (!clockValue(started)) return fail("clock_invalid");
  const projectUrl = `https://api.vercel.com/v9/projects/${release.vercel.projectId}`;
  const teamQuery = `?teamId=${release.vercel.teamId}`;
  const databaseUrl = `https://api.supabase.com/v1/projects/${release.supabase.projectRef}`;
  const read = (url, token) => readProviderJson(url, token, { fetchImpl, timeoutMs });
  // All targets and the source digest are validated before either provider is
  // contacted. Do not fetch domain/Auth configuration for a mismatched project.
  const projects = await Promise.all([
    read(`${projectUrl}${teamQuery}`, vercelReadToken), read(databaseUrl, supabaseReadToken),
  ]);
  const vercel = vercelProjectProjection(projects[0], release);
  const supabase = supabaseProjectProjection(projects[1], release);
  const configs = await Promise.all([
    read(`${projectUrl}/domains/${encodeURIComponent(new URL(release.origin).hostname)}${teamQuery}`, vercelReadToken),
    read(`${databaseUrl}/config/auth`, supabaseReadToken),
  ]);
  const domain = domainProjection(configs[0], release);
  const auth = authProjection(configs[1], release);
  const completed = now();
  if (!clockValue(completed) || completed < started || completed - started > 60_000) return fail("clock_invalid");
  const configuration = { vercel, supabase, domain, auth };
  return {
    formatVersion: 1, kind: "rewards-demo-provider-observation", status: "observed_not_approved",
    sourceCommit: release.sourceCommit, planDigest: expectedPlanDigest,
    startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(),
    reviewBefore: new Date(started + 300_000).toISOString(),
    configuration, configurationDigest: sha256(JSON.stringify(configuration)),
    httpReads: 4, remoteMutationsPerformed: false,
    credentialsProvenanceVerified: false, deployedArtifactVerified: false, releaseAuthorized: false,
  };
}
