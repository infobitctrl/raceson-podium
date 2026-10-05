import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectMigrationSources } from "../../../packages/db/scripts/reward-migration-sources.mjs";
import { DEMO_REMOTE, validateDemoReleaseManifest } from "./release-manifest.mjs";

export const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const basePrefix = "supabase/migrations/";
const demoPrefix = "demo/rewards/supabase/migrations/";
const requiredEntries = [
  "demo/rewards/web/package.json", "demo/rewards/web/next.config.ts",
  "demo/rewards/web/pages/api/[...path].ts", "apps/api/src/rewards-demo.ts",
  "packages/db/src/rewards/index.ts", "packages/domain/src/rewards/demo-environment.ts",
  "demo/rewards/scripts/release.mjs",
];
export const DEMO_DB_CONFIG = `# Offline migration bundle only; never push this as remote Auth/config.
project_id = "raceson-rewards-demo"

[db]
major_version = 17

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []
`;
const MAX_BYTES = 64 * 1024 * 1024;
const fail = (code) => { throw new Error(`reward_demo_release_${code}`); };
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function git(repository, args, input) {
  // Read-only object/ref commands only. Ignore inherited alternate Git routing;
  // no checkout, index write, hooks, credential helper or network is invoked.
  try {
    return execFileSync("git", ["--no-replace-objects", "-C", repository, ...args], {
      input, timeout: 15_000, maxBuffer: MAX_BYTES, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch { return fail("source_unavailable"); }
}

function treeEntries(repository, commit) {
  const entries = new Map();
  const output = git(repository, ["ls-tree", "-r", "-z", commit]).toString("utf8");
  for (const line of output.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
    if (!match || entries.has(match[4])) return fail("source_tree_invalid");
    entries.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
  }
  return entries;
}

function readBlobs(repository, items) {
  const output = git(repository, ["cat-file", "--batch"], `${items.map(({ oid }) => oid).join("\n")}\n`);
  let offset = 0;
  const result = [];
  for (const item of items) {
    const end = output.indexOf(10, offset);
    if (end < 0) return fail("source_blob_invalid");
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(output.subarray(offset, end).toString("ascii"));
    const length = Number(match?.[2]);
    if (!match || match[1] !== item.oid || !Number.isSafeInteger(length) || length > MAX_BYTES
      || end + 1 + length >= output.length || output[end + 1 + length] !== 10) return fail("source_blob_invalid");
    const bytes = Buffer.from(output.subarray(end + 1, end + 1 + length));
    if (createHash("sha1").update(`blob ${length}\0`).update(bytes).digest("hex") !== item.oid) return fail("source_blob_invalid");
    result.push(bytes);
    offset = end + length + 2;
  }
  if (offset !== output.length) return fail("source_blob_invalid");
  return result;
}

export function readDemoReleaseSource(input, { repository = repositoryDirectory } = {}) {
  const release = validateDemoReleaseManifest(input);
  for (const args of [["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
    if (git(repository, args).toString("utf8").trim() !== DEMO_REMOTE) return fail("repository_mismatch");
  }
  if (git(repository, ["rev-parse", "--verify", `${release.sourceCommit}^{commit}`]).toString("utf8").trim()
    !== release.sourceCommit) return fail("source_commit_invalid");
  const sourceTree = git(repository, ["rev-parse", `${release.sourceCommit}^{tree}`]).toString("utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(sourceTree)) return fail("source_tree_invalid");
  const entries = treeEntries(repository, release.sourceCommit);
  const regular = (entry) => entry?.type === "blob" && ["100644", "100755"].includes(entry.mode);
  if (requiredEntries.some((name) => !regular(entries.get(name)))) return fail("demo_source_missing");
  const names = (prefix) => [...entries.keys()].filter((name) => name.startsWith(prefix) && name.endsWith(".sql"))
    .map((name) => name.slice(prefix.length));
  let selection;
  try { selection = selectMigrationSources(names(basePrefix), names(demoPrefix), true); }
  catch { return fail("migration_inventory_invalid"); }
  if (selection.length > 10_000) return fail("migration_inventory_invalid");
  const blobs = selection.map(({ name, source }) => entries.get(`${source === "base" ? basePrefix : demoPrefix}${name}`));
  if (blobs.some((entry) => !regular(entry))) return fail("migration_not_regular");
  const contents = readBlobs(repository, blobs);
  const migrations = selection.map(({ name, source }, i) => ({
    name, source, version: name.slice(0, 14), bytes: contents[i].length, sha256: sha256(contents[i]),
  }));
  const envelope = {
    formatVersion: 1, purpose: "offline-demo-db-plan", release, sourceTree,
    migrations, migrationDigest: sha256(json(migrations)),
  };
  return { envelope, contents, planDigest: sha256(json(envelope)) };
}

function realDirectory(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== resolve(directory)) return fail("directory_invalid");
}

function regularFile(filename, maxBytes = MAX_BYTES) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) return fail("file_invalid");
  return readFileSync(filename);
}

export function readDemoManifestFile(filename) {
  try { return validateDemoReleaseManifest(JSON.parse(regularFile(filename, 8192).toString("utf8"))); }
  catch { return fail("manifest_invalid"); }
}

/** Create a new, owner-only SQL work directory from Git objects, never from
 * mutable working files. No provider CLI is run and no project link is created. */
export function prepareDemoDbBundle(input, { repository = repositoryDirectory } = {}) {
  const source = readDemoReleaseSource(input, { repository });
  realDirectory(repository);
  const temporaryRoot = join(repository, "tmp");
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  realDirectory(temporaryRoot);
  const directory = mkdtempSync(join(temporaryRoot, "reward-demo-release-"));
  try {
    const migrationDirectory = join(directory, "supabase/migrations");
    mkdirSync(migrationDirectory, { recursive: true, mode: 0o700 });
    const write = (name, bytes) => writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600 });
    write("supabase/config.toml", DEMO_DB_CONFIG);
    source.envelope.migrations.forEach(({ name }, index) => write(`supabase/migrations/${name}`, source.contents[index]));
    write("release-plan.json", json(source.envelope));
    const receipt = verifyDemoDbBundle(input, directory, { repository });
    return { ...receipt, directory };
  } catch (error) {
    // Only the directory just allocated above is owned by this operation.
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Recompute against the separately supplied expected manifest and immutable
 * source. A self-edited envelope/checksum cannot approve a new target or SQL. */
export function verifyDemoDbBundle(input, directory, { repository = repositoryDirectory } = {}) {
  const source = readDemoReleaseSource(input, { repository });
  realDirectory(directory);
  const allowed = new Set(["release-plan.json", "supabase/config.toml",
    ...source.envelope.migrations.map(({ name }) => `supabase/migrations/${name}`)]);
  const directories = new Set(["supabase", "supabase/migrations"]);
  const observed = new Set();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const filename = join(current, entry.name);
      const name = relative(directory, filename).split("\\").join("/");
      if (entry.isDirectory() && directories.has(name)) { realDirectory(filename); walk(filename); }
      else if (entry.isFile() && allowed.has(name)) { regularFile(filename); observed.add(name); }
      else return fail("bundle_unexpected_entry");
    }
  };
  walk(directory);
  if (observed.size !== allowed.size) return fail("bundle_incomplete");
  if (!regularFile(join(directory, "release-plan.json"), 4 * 1024 * 1024).equals(Buffer.from(json(source.envelope)))
    || !regularFile(join(directory, "supabase/config.toml")).equals(Buffer.from(DEMO_DB_CONFIG))) return fail("bundle_metadata_mismatch");
  source.envelope.migrations.forEach(({ name }, index) => {
    if (!regularFile(join(directory, "supabase/migrations", name)).equals(source.contents[index])) return fail("bundle_sql_mismatch");
  });
  return summarizeDemoRelease(source);
}

export function summarizeDemoRelease({ envelope, planDigest }) {
  return {
    status: "prepared_not_approved", sourceCommit: envelope.release.sourceCommit,
    sourceTree: envelope.sourceTree, target: envelope.release, planDigest,
    migrations: { total: envelope.migrations.length,
      base: envelope.migrations.filter(({ source }) => source === "base").length,
      demo: envelope.migrations.filter(({ source }) => source === "demo").length,
      digest: envelope.migrationDigest },
    remoteActionsPerformed: false,
  };
}
