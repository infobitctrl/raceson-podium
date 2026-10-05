import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_REMOTE, DEMO_SUPABASE_ORGANIZATION, DEMO_VERCEL_TEAM, validateDemoReleaseManifest } from "../../../demo/rewards/scripts/release-manifest.mjs";
import { DEMO_DB_CONFIG, prepareDemoDbBundle, readDemoManifestFile, readDemoReleaseSource, repositoryDirectory, summarizeDemoRelease, verifyDemoDbBundle } from "../../../demo/rewards/scripts/release-source.mjs";

const cli = fileURLToPath(new URL("../../../demo/rewards/scripts/release.mjs", import.meta.url));
const baseName = "20260907010000_core.sql";
const demoName = "20260908010000_reward_demo.sql";
const basePath = `supabase/migrations/${baseName}`;
const demoPath = `demo/rewards/supabase/migrations/${demoName}`;
const fixtures = {
  ".gitignore": "tmp/\n",
  [basePath]: "-- synthetic schema fixture\r\nselect 'Šibenik';\r\n",
  [demoPath]: "-- synthetic reward overlay\nselect 10143;\n",
  "demo/rewards/web/package.json": "{}\n",
  "demo/rewards/web/next.config.ts": "// synthetic source presence fixture\n",
  "demo/rewards/web/pages/api/[...path].ts": "// synthetic adapter fixture\n",
  "apps/api/src/rewards-demo.ts": "// synthetic entry fixture\n",
  "packages/db/src/rewards/index.ts": "// synthetic subpath fixture\n",
  "packages/domain/src/rewards/demo-environment.ts": "// synthetic policy fixture\n",
  "demo/rewards/scripts/release.mjs": "// synthetic preparation fixture\n",
  "supabase/config.toml": "project_id = 'never-copy-portal-config'\n",
  "supabase/seed.sql": "-- never copy synthetic portal seed\n",
  "supabase/roles.sql": "-- never copy synthetic custom roles\n",
  "supabase/.temp/project-ref": "icdtinbmtvzhswrrzjxq\n",
  ".vercel/project.json": '{"projectId":"prj_fs6FD31qnADjsnDajAI5mypY3uSY"}\n',
  ".env": "SYNTHETIC_SENTINEL=never-copy-this-not-a-real-secret\n",
  "runtime-data.csv": "synthetic-only,never-copy\n",
};
function manifest(sourceCommit = "a".repeat(40)) {
  return {
    formatVersion: 1, kind: "raceson-rewards-testnet", repository: "infobitctrl/raceson-podium",
    sourceCommit, chainId: 10143, origin: "https://rewards-demo.example.invalid",
    vercel: { teamId: DEMO_VERCEL_TEAM, projectId: "prj_DemoFixtureOnly", environment: "production", rootDirectory: "demo/rewards/web" },
    supabase: { organizationId: DEMO_SUPABASE_ORGANIZATION, projectRef: "abcdefghijklmnopqrst" },
  };
}
function fixture(t, initial = fixtures) {
  const parent = join(repositoryDirectory, "tmp");
  mkdirSync(parent, { recursive: true });
  const repository = mkdtempSync(join(parent, "reward-demo-release-test-"));
  // The only recursively removed path is this test's newly allocated directory.
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Rewards Test", "-c", "user.email=rewards-test@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", repository, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("remote", "add", "origin", DEMO_REMOTE);
  const write = (name, bytes) => { mkdirSync(dirname(join(repository, name)), { recursive: true }); writeFileSync(join(repository, name), bytes); };
  for (const [name, bytes] of Object.entries(initial)) write(name, bytes);
  git("add", "--", ...Object.keys(initial));
  git("commit", "--quiet", "-m", "Synthetic release fixture");
  return { repository, git, write, manifest: manifest(git("rev-parse", "HEAD")) };
}

test("release manifest is deterministic, explicitly testnet and separate from production", () => {
  const value = manifest();
  const reverse = Object.fromEntries(Object.entries(value).reverse());
  assert.deepEqual(validateDemoReleaseManifest(reverse), value);
  assert.equal(validateDemoReleaseManifest(value).vercel.environment, "production");
  assert.notEqual(value.vercel.projectId, "prj_fs6FD31qnADjsnDajAI5mypY3uSY");
});

test("manifest refuses protected targets, mainnet, inherited identity and private/unknown fields", () => {
  const mutations = [
    v => { v.chainId = 143; }, v => { v.chainId = 31337; },
    v => { v.kind = "raceson-mainnet"; }, v => { v.sourceCommit = "HEAD"; },
    v => { v.repository = "lukaViPR/sitrail.com"; },
    v => { v.repository = "infobitctrl/raceson.com"; },
    v => { v.vercel.projectId = "prj_fs6FD31qnADjsnDajAI5mypY3uSY"; },
    v => { v.vercel.teamId = "team_another_owner"; },
    v => { v.vercel.rootDirectory = "apps/web"; },
    v => { v.vercel.environment = "preview"; },
    v => { v.supabase.organizationId = "another-org"; },
    v => { v.supabase.organizationId = "necxyrblqkeywnyyqsgz"; },
    v => { v.supabase.organizationId = "ggboeleuibvxmkgcsezs"; },
    v => { v.origin = "http://127.0.0.1:3101"; },
    v => { v.origin = "https://demo.example.invalid/auth"; },
    v => { v.origin = "https://user:private-value@demo.example.invalid"; },
    v => { v.supabase.projectRef = "abcdefghijklmnopqrst.supabase.co"; },
    v => { v.token = "synthetic-sensitive-value"; },
    v => { v.supabase.serviceKey = "synthetic-sensitive-value"; },
    v => { v.vercel.flags = ["--prod"]; },
  ];
  for (const origin of ["raceson.com", "www.raceson.com", "staging.raceson.com", "raceson-staging.vercel.app", "sitrail.com", "www.sitrail.com", "sibenik.trail"]) {
    mutations.push(v => { v.origin = `https://${origin}`; });
    mutations.push(v => { v.origin = `https://${origin}.`; });
  }
  for (const project of ["icdtinbmtvzhswrrzjxq", "gnnmnhhvujdvyohcidki", "whffzvkqwmzbkrybadkq"]) {
    mutations.push(v => { v.supabase.projectRef = project; });
  }
  for (const mutate of mutations) {
    const value = manifest(); mutate(value);
    assert.throws(() => validateDemoReleaseManifest(value), { message: "reward_demo_release_manifest_invalid" });
  }
});

test("preparation reads exact Git blobs, not working files, index, later HEAD or production link state", t => {
  const f = fixture(t);
  const original = readDemoReleaseSource(f.manifest, f);
  f.write(basePath, "select 'different later commit';\n");
  f.git("add", "--", basePath); f.git("commit", "--quiet", "-m", "Later fixture commit");
  f.write(demoPath, "select 'uncommitted edit';\n");
  f.git("add", "--", demoPath);
  f.write("untracked.txt", "keep me\n");
  const before = { head: f.git("rev-parse", "HEAD"), status: f.git("status", "--porcelain"), index: f.git("write-tree") };
  const result = prepareDemoDbBundle(f.manifest, f);
  assert.equal(result.planDigest, original.planDigest);
  assert.equal(result.status, "prepared_not_approved");
  assert.equal(result.remoteActionsPerformed, false);
  assert.deepEqual(result.migrations, { total: 2, base: 1, demo: 1, digest: original.envelope.migrationDigest });
  for (const name of [baseName, demoName]) {
    const source = name === baseName ? basePath : demoPath;
    assert.equal(readFileSync(join(result.directory, "supabase/migrations", name), "utf8"), fixtures[source]);
    assert.equal(lstatSync(join(result.directory, "supabase/migrations", name)).mode & 0o777, 0o600);
  }
  assert.equal(lstatSync(result.directory).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(result.directory, "supabase/config.toml"), "utf8"), DEMO_DB_CONFIG);
  assert.deepEqual(readdirSync(result.directory).sort(), ["release-plan.json", "supabase"]);
  assert.deepEqual(readdirSync(join(result.directory, "supabase")).sort(), ["config.toml", "migrations"]);
  assert.deepEqual({ head: f.git("rev-parse", "HEAD"), status: f.git("status", "--porcelain"), index: f.git("write-tree") }, before);
  assert.equal(verifyDemoDbBundle(f.manifest, result.directory, f).planDigest, result.planDigest);
});

test("bundle verifier refuses edited SQL/config/manifest, missing files and extra seed/link/secret files", t => {
  const f = fixture(t);
  const cases = [
    [basePath, "select 'tampered';\n", /bundle_sql_mismatch/],
    ["supabase/config.toml", "[db.seed]\nenabled = true\n", /bundle_metadata_mismatch/],
    ["release-plan.json", "{}\n", /bundle_metadata_mismatch/],
    ["supabase/seed.sql", "select 'not allowed';\n", /bundle_unexpected_entry/],
    ["supabase/roles.sql", "-- not allowed\n", /bundle_unexpected_entry/],
    [".env", "SYNTHETIC_VALUE=not-allowed\n", /bundle_unexpected_entry/],
    ["supabase/.temp/project-ref", "icdtinbmtvzhswrrzjxq\n", /bundle_unexpected_entry/],
  ];
  for (const [name, contents, error] of cases) {
    const { directory } = prepareDemoDbBundle(f.manifest, f);
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), contents);
    assert.throws(() => verifyDemoDbBundle(f.manifest, directory, f), error);
  }
  const { directory } = prepareDemoDbBundle(f.manifest, f);
  rmSync(join(directory, basePath));
  assert.throws(() => verifyDemoDbBundle(f.manifest, directory, f), /bundle_incomplete/);
  const intact = prepareDemoDbBundle(f.manifest, f);
  const differentTarget = { ...f.manifest, origin: "https://another-demo.example.invalid" };
  assert.throws(() => verifyDemoDbBundle(differentTarget, intact.directory, f), /bundle_metadata_mismatch/);
});

test("bundle verifier refuses symlinked roots and files", t => {
  const f = fixture(t);
  const { directory } = prepareDemoDbBundle(f.manifest, f);
  symlinkSync(directory, join(f.repository, "bundle-link"));
  assert.throws(() => verifyDemoDbBundle(f.manifest, join(f.repository, "bundle-link"), f), /directory_invalid/);
  rmSync(join(directory, basePath));
  symlinkSync(join(f.repository, basePath), join(directory, basePath));
  assert.throws(() => verifyDemoDbBundle(f.manifest, directory, f), /bundle_unexpected_entry/);
});

test("preparation refuses an output-root symlink without writing through it", t => {
  const f = fixture(t);
  const target = join(f.repository, "unrelated-directory");
  mkdirSync(target);
  writeFileSync(join(target, "preserve.txt"), "unchanged\n");
  symlinkSync(target, join(f.repository, "tmp"));
  assert.throws(() => prepareDemoDbBundle(f.manifest, f), /directory_invalid/);
  assert.deepEqual(readdirSync(target), ["preserve.txt"]);
  assert.equal(readFileSync(join(target, "preserve.txt"), "utf8"), "unchanged\n");
});

test("preparation refuses wrong Git identity, missing demo source and malformed/duplicate migrations before creating output", t => {
  const f = fixture(t);
  f.git("remote", "set-url", "origin", "git@github.com:lukaViPR/sitrail.com.git");
  assert.throws(() => prepareDemoDbBundle(f.manifest, f), /repository_mismatch/);
  assert.equal(existsSync(join(f.repository, "tmp")), false);
  f.git("remote", "set-url", "origin", DEMO_REMOTE);
  f.git("rm", "--", "demo/rewards/web/next.config.ts");
  f.git("commit", "--quiet", "-m", "Incomplete fixture source");
  assert.throws(() => prepareDemoDbBundle(manifest(f.git("rev-parse", "HEAD")), f), /demo_source_missing/);
  assert.equal(existsSync(join(f.repository, "tmp")), false);
  for (const name of ["20260907010000_reward_collision.sql", "nested/20260909010000_reward_nested.sql", "bad.sql"]) {
    const initial = { ...fixtures, [`demo/rewards/supabase/migrations/${name}`]: "select 1;\n" };
    const invalid = fixture(t, initial);
    assert.throws(() => prepareDemoDbBundle(invalid.manifest, invalid), /migration_inventory_invalid/);
    assert.equal(existsSync(join(invalid.repository, "tmp")), false);
  }
});

test("committed symlink SQL is rejected rather than dereferenced", t => {
  const f = fixture(t);
  rmSync(join(f.repository, demoPath));
  symlinkSync(join(f.repository, basePath), join(f.repository, demoPath));
  f.git("add", "--", demoPath); f.git("commit", "--quiet", "-m", "Synthetic symlink fixture");
  assert.throws(() => readDemoReleaseSource(manifest(f.git("rev-parse", "HEAD")), f), /migration_not_regular/);
});

test("manifest reads and CLI errors never echo supplied private data or support remote execution flags", t => {
  const f = fixture(t);
  const filename = join(f.repository, "manifest.json");
  writeFileSync(filename, JSON.stringify({ ...f.manifest, token: "SYNTHETIC_PRIVATE_SENTINEL" }));
  assert.throws(() => readDemoManifestFile(filename), /manifest_invalid/);
  for (const args of [["inspect", "--manifest", filename], ["deploy", "--manifest", filename], ["prepare-db", "--manifest", filename, "--include-seed"],
    ["inspect", "--db-url", "SYNTHETIC_PRIVATE_SENTINEL"], ["verify-db", "--manifest", filename, "--manifest", filename]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 15_000 });
    assert.ifError(result.error); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.match(result.stderr, /^reward_demo_release_[a-z_]+\n$/);
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PRIVATE_SENTINEL/);
  }
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /no deployment, migration push or credentials/);
  writeFileSync(filename, JSON.stringify(f.manifest));
  assert.deepEqual(readDemoManifestFile(filename), f.manifest);
  chmodSync(filename, 0o600);
  assert.equal(summarizeDemoRelease(readDemoReleaseSource(f.manifest, f)).remoteActionsPerformed, false);
});
