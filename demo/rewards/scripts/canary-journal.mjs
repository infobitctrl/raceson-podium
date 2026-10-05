// Local operator-only transaction journal. No private keys are stored here.
import assert from "node:assert/strict";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const canaryJson = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v, 2) + "\n";
export function openCanaryJournal(directory, { readOnly = false } = {}) {
  assert.equal(resolve(directory), directory);
  if (!existsSync(directory)) {
    if (readOnly) return null;
    assert.equal(realpathSync(dirname(directory)), dirname(directory));
    mkdirSync(directory, { mode: 0o700 });
  }
  const check = (path, file = false) => {
    const info = lstatSync(path);
    assert.equal(realpathSync(path), path);
    assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o077, 0);
    assert.ok(file ? info.isFile() && info.size <= 131072 && info.nlink === 1 : info.isDirectory());
  };
  check(directory);
  const lock = join(directory, "running.lock");
  // Never infer that an old lock is dead; recovery requires checking its process.
  if (!readOnly) mkdirSync(lock, { mode: 0o700 });
  else assert.ok(!existsSync(lock), "Another execution may be active; inspect its process first");
  let closed = false;
  const pathFor = name => { assert.match(name, /^[a-z0-9-]+\.json$/); return join(directory, name); };
  return {
    read(name) {
      assert.ok(!closed); check(directory);
      const path = pathFor(name); if (!existsSync(path)) return null;
      check(path, true); return JSON.parse(readFileSync(path, "utf8"));
    },
    write(name, value) {
      assert.ok(!readOnly && !closed); check(directory);
      const path = pathFor(name), serialized = canaryJson(value);
      assert.ok(Buffer.byteLength(serialized) <= 131072);
      const fd = openSync(path, "wx", 0o600);
      try { writeFileSync(fd, serialized); fsyncSync(fd); } finally { closeSync(fd); }
      const parent = openSync(directory, "r");
      try { fsyncSync(parent); } finally { closeSync(parent); }
      check(path, true); assert.equal(readFileSync(path, "utf8"), serialized);
    },
    close() { if (!closed) { closed = true; if (!readOnly) rmdirSync(lock); } },
  };
}
