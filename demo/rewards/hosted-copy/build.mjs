import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rewardDemoTarget } from '@raceson/domain/rewards/environment';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [outputArg, origin, publicKey] = process.argv.slice(2);
const supabaseUrl = 'https://niklhlmljiikwbkrmapw.supabase.co';
if (!outputArg || !origin || !publicKey?.startsWith('sb_publishable_')
  || !rewardDemoTarget({ mode: 'testnet', origin, supabaseUrl })) throw Error('Expected output directory, isolated HTTPS origin, publishable key');
const output = resolve(outputArg), rel = relative(root, output);
if (!rel.startsWith('tmp/') || rel.includes('..')) throw Error('Build only into a fresh workspace tmp subdirectory');
const destination = resolve(output, '.vercel/output');
await mkdir(destination, { recursive: true });
// Each release uses a new output directory: never inherit stale assets from an earlier build.
await mkdir(resolve(destination, 'static'), { recursive: false });
await mkdir(resolve(destination, 'functions/api.func'), { recursive: true });
const publicEnv = {
  NEXT_PUBLIC_RACESON_REWARDS_ENABLED: 'true', NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: 'testnet',
  NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN: origin, NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_RACESON_API_BASE_URL: '/api', NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL: origin,
  NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY: 'raceson-rewards-demo-auth',
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLIC_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
};
const publicSource = await readFile(resolve(root, 'apps/web/src/lib/public-env.ts'), 'utf8');
const define = { 'process.env.NODE_ENV': '"production"' };
for (const key of new Set(publicSource.match(/NEXT_PUBLIC_[A-Z_]+/g))) define[`process.env.${key}`] = JSON.stringify(publicEnv[key] ?? '');
const client = await build({ absWorkingDir: root, entryPoints: ['demo/rewards/hosted-copy/client.tsx'],
  outdir: resolve(destination, 'static/assets'), entryNames: 'app-[hash]', bundle: true, minify: true,
  format: 'esm', target: 'es2022', jsx: 'automatic', tsconfig: 'apps/web/tsconfig.json',
  define, metafile: true, sourcemap: false, legalComments: 'external' });
const server = await build({ absWorkingDir: root, entryPoints: ['demo/rewards/hosted-copy/server.cjs'],
  outfile: resolve(destination, 'functions/api.func/handler.cjs'), bundle: true, minify: true,
  platform: 'node', format: 'cjs', target: 'node22', metafile: true, sourcemap: false,
  legalComments: 'external' });
await writeFile(resolve(destination, 'functions/api.func/.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'handler.cjs', launcherType: 'Nodejs',
  maxDuration: 30, regions: ['dub1'], shouldAddHelpers: false, shouldAddSourcemapSupport: false,
}));
const assets = Object.keys(client.metafile.outputs), js = assets.find(p => p.endsWith('.js')), css = assets.find(p => p.endsWith('.css'));
const assetUrl = p => '/' + relative(resolve(destination, 'static'), resolve(root, p)).split('\\').join('/');
await writeFile(resolve(destination, 'static/index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="RacesOn Podium committee preview — five completed rounds with fictional profiles."><title>RacesOn Podium · Committee preview</title><link rel="stylesheet" href="${assetUrl(css)}"><style>body{margin:0}</style></head><body><div id="root"></div><noscript>Enable JavaScript to sign in to the committee preview.</noscript><script type="module" src="${assetUrl(js)}"></script></body></html>`);
await writeFile(resolve(destination, 'static/robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(resolve(destination, 'config.json'), JSON.stringify({ version: 3, routes: [
  ...(origin === 'https://raceson-podium.vercel.app' ? [] : [{ src: '/(.*)',
    has: [{ type: 'host', value: 'raceson-podium.vercel.app' }], methods: ['GET', 'HEAD'],
    status: 308, headers: { Location: `${origin}/$1` } }]),
  { src: '/(.*)', headers: { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${supabaseUrl}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` }, continue: true },
  { src: '/api(?:/.*)?', dest: '/api' }, { handle: 'filesystem' },
  { src: '/(?:auth|rewards/demo-copy)?', dest: '/index.html', headers: { 'Cache-Control': 'no-store' } },
] }, null, 2));
await writeFile(resolve(output, '.vercelignore'), '*\n');
// Keep source inventory beside the upload root, never inside the deployable artifact.
const inputs = [...new Set([...Object.keys(client.metafile.inputs), ...Object.keys(server.metafile.inputs)])];
const sourceHashes = [];
for (const path of inputs.filter(p => !p.includes('node_modules/'))) {
  sourceHashes.push({ path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') });
}
await writeFile(`${output}.manifest.json`, JSON.stringify({ origin, sourceHashes, client: client.metafile, server: server.metafile }, null, 2));
console.log(JSON.stringify({ output, origin, sourceFiles: sourceHashes.length, staticAssets: assets.length, serverBytes: server.metafile.outputs[Object.keys(server.metafile.outputs).find(p => p.endsWith('handler.cjs'))].bytes }));
