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
const translationPath = 'apps/web/src/shared/i18n/englishMessages.ts';
const translationLines = readFileSync(join(root, translationPath), 'utf8').split('\n');
const translationFixtures = ['rewards.claimV3.unmatched', 'rewards.depositV3.help', 'rewards.depositV3.noWallet'].map(key => {
  const index = translationLines.findIndex(line => line.includes(`"${key}"`));
  assert.ok(index >= 0, 'The reviewed translation fixture moved; review its exception.');
  return [translationPath, translationLines.slice(index, index + 2).join('\n')];
});
const directory = mkdtempSync(join(tmpdir(), 'podium-scanner-check-'));
try {
  for (const [path, reviewed] of [[relative, allowed], ...translationFixtures]) {
    const fixture = join(directory, path);
    mkdirSync(dirname(fixture), {recursive: true});
    // These random values are solely detector tests, never credentials.
    const candidate = `const api_key = "A1b2C3d4${randomBytes(48).toString('base64url')}";`;
    for (const [source, expected] of [[reviewed, 0], [candidate, 1], [`${candidate} ${reviewed.trim()}`, 1], [`${reviewed.trim()} ${candidate}`, 1]]) {
      writeFileSync(fixture, `${source}\n`);
      const result = spawnSync(process.argv[2] ?? 'gitleaks', [
        'dir', '--redact', '--no-banner', '--config', join(root, '.gitleaks.toml'), '.',
      ], {cwd: directory, stdio: 'ignore'});
      if (result.error) throw result.error;
      assert.equal(result.status, expected, `Secret scanner fixture check failed for ${path} (${source === reviewed ? 'reviewed' : source === candidate ? 'candidate' : source.startsWith(candidate) ? 'prefix' : 'suffix'}).`);
    }
    rmSync(fixture);
  }
  console.log('Secret scanner accepts the reviewed fixture and rejects new values, including on the same line.');
} finally {
  rmSync(directory, {recursive: true, force: true});
}
