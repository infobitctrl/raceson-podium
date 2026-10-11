import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function privatePublicationPath(path) {
  const segments = path.split('/');
  const name = segments.at(-1);
  if (segments.some(part => [
    '.git', '.vercel', '.codex', '.agents', '.migration', '.migration-work',
    '.worktree-hold', '.sitrail-cli-sync', 'node_modules', 'keystore', 'keystores',
    'broadcast', '.toolchain',
  ].includes(part))) return true;
  if (/^(?:tmp|audits|output|outputs|\.artifacts)\//.test(path)
    || /^docs\/(?:handoff|threads|delivery)\//.test(path)
    || /^demo\/rewards\/local\//.test(path)) return true;
  if (name.startsWith('.env') && !/^\.env(?:\.[\w-]+)?\.example$/.test(name)) return true;
  return /\.(?:pem|key|p12|pfx|keystore|wallet|dump|sqlite3?|log)$/i.test(name)
    || /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/.test(name)
    || /\.private\./i.test(name);
}

export function checkPublication() {
  // Inspect the Git index: ignore rules alone cannot protect an already tracked file.
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const violations = files.filter(path => privatePublicationPath(path)
    || lstatSync(resolve(root, path)).isSymbolicLink());
  if (violations.length) throw new Error(`Remove private paths or symlinks from the release:\n${violations.join('\n')}`);
  console.log(`Publication paths checked: ${files.length}; no private paths or source symlinks.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkPublication();
