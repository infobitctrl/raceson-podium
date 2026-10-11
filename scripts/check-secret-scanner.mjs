import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const relative = 'apps/api/test/reward-calculation-service.test.mjs';
const allowed = readFileSync(join(root, relative), 'utf8').split('\n')
  .find(line => line.includes('const reserveInput ='));
assert.ok(allowed, 'The reviewed scanner fixture moved; review its exception.');
const directory = mkdtempSync(join(tmpdir(), 'podium-scanner-check-'));
try {
  const fixture = join(directory, relative);
  mkdirSync(dirname(fixture), {recursive: true});
  // These random values are generated solely for detector tests, never credentials.
  const candidate = `const api_key = "${randomBytes(48).toString('base64url')}";`;
  for (const [source, expected] of [[allowed, 0], [candidate, 1], [`${candidate} ${allowed.trim()}`, 1]]) {
    writeFileSync(fixture, `${source}\n`);
    const result = spawnSync(process.argv[2] ?? 'gitleaks', [
      'dir', '--redact', '--no-banner', '--config', join(root, '.gitleaks.toml'), '.',
    ], {cwd: directory, stdio: 'ignore'});
    if (result.error) throw result.error;
    assert.equal(result.status, expected, 'Secret scanner exception became too broad or no longer matches.');
  }
  console.log('Secret scanner accepts the reviewed fixture and rejects new values, including on the same line.');
} finally {
  rmSync(directory, {recursive: true, force: true});
}
