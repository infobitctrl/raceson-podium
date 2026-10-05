import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baseDirectory = join(rootDirectory, "supabase/migrations");
const demoDirectory = join(rootDirectory, "demo/rewards/supabase/migrations");
const migrationName = /^\d{14}_[a-z0-9_]+\.sql$/;

// Pure selection policy: production never includes the optional demo overlay.
// Merge by timestamp, not by directory, so replay matches a composed CLI tree.
export function selectMigrationSources(baseNames, demoNames = [], includeDemo = false) {
  if (typeof includeDemo !== "boolean" || !Array.isArray(baseNames)
    || !Array.isArray(demoNames) || baseNames.length === 0
    || (includeDemo && demoNames.length === 0)) {
    throw new Error("Invalid migration source selection");
  }
  const selected = [
    ...baseNames.map((name) => ({ name, source: "base" })),
    ...(includeDemo ? demoNames.map((name) => ({ name, source: "demo" })) : []),
  ];
  const versions = new Set();
  for (const entry of selected) {
    if (typeof entry.name !== "string" || !migrationName.test(entry.name)) {
      throw new Error("Invalid migration filename");
    }
    if (entry.source === "base" && /^\d{14}_reward_/.test(entry.name)) {
      throw new Error("Reward migrations belong in the isolated demo overlay");
    }
    const version = entry.name.slice(0, 14);
    if (versions.has(version)) throw new Error("Duplicate migration version");
    versions.add(version);
  }
  return selected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function readNames(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error("Invalid migration directory");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => {
      if (!entry.isFile()) throw new Error("Migration must be a regular SQL file");
      return entry.name;
    });
}

export function listMigrationSources(includeDemo = false) {
  return selectMigrationSources(readNames(baseDirectory), includeDemo ? readNames(demoDirectory) : [], includeDemo)
    .map(({ source, name }) => join(source === "base" ? baseDirectory : demoDirectory, name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--demo")) {
      throw new Error("Usage: reward-migration-sources.mjs [--demo]");
    }
    process.stdout.write(`${listMigrationSources(args.length === 1).join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
