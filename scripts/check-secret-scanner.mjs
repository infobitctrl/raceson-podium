import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
    // Fixed synthetic bytes keep the detector check reproducible. Random text
    // can contain a default Gitleaks stopword (for example "side") and be ignored.
    // Build the value here so the self-test does not itself resemble a stored key.
    const value = [0x91,0x4e,0x27,0xb8,0xd3,0x60,0xaf,0x05,0xc9,0x72,0x1d,0xe6,0x48,0xb3,0x0f,0xa5,
      0x6c,0x29,0xd8,0x43,0xbe,0x17,0xf0,0x95,0x2a,0x6d,0xc4,0x83,0x5e,0xb1,0x70,0x39];
    const candidate = `const api_key = "${Buffer.from(value).toString('base64url')}";`;
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
