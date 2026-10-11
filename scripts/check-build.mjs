import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'demo/rewards/web');
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  assert.ok(!existsSync(join(web, name)), `Use a clean checkout without ${name} for the synthetic build check.`);
}

// Reuse the documented public target; every credential is a new inert test value.
// Construct the environment explicitly so a developer's provider keys cannot leak in.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].filter(key => process.env[key])
  .map(key => [key, process.env[key]]));
for (const line of readFileSync(join(web, '.env.example'), 'utf8').split('\n')) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match) env[match[1]] = match[2];
}
const sentinel = `podium-build-only-server-${randomUUID()}`;
Object.assign(env, {
  CI: 'true', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  SUPABASE_ANON_KEY: 'podium-build-only-public',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'podium-build-only-public',
  SUPABASE_SERVICE_ROLE_KEY: sentinel,
});
const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: root, env, stdio: 'inherit',
});
if (built.error) throw built.error;
assert.equal(built.status, 0, 'Production build failed.');

function inspect(directory, serializedOnly = false) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inspect(path, serializedOnly);
    else if (!serializedOnly || /\.(?:html|rsc|body)$/.test(entry.name)) assert.ok(!readFileSync(path).includes(Buffer.from(sentinel)), `Server-only value leaked into ${path}`);
  }
}
inspect(join(web, '.next-build/static'));
inspect(join(web, '.next-build/server/app'), true);
console.log('Synthetic production build passed; server credential sentinel absent from browser assets.');
