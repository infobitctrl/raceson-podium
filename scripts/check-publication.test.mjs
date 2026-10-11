import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privatePublicationPath} from './check-publication.mjs';

test('public source and blank environment templates remain publishable', () => {
  for (const path of ['contracts/src/RacesOnWalletRegistryV3.sol', 'demo/rewards/web/.env.example',
    '.env.test.example', 'packages/db/src/rewards/payments.ts', 'SECURITY.md']) {
    assert.equal(privatePublicationPath(path), false, path);
  }
});

test('private files remain blocked even when force-added past ignore rules', () => {
  for (const path of ['.env', '.env.local', 'demo/rewards/web/.env.production',
    'contracts/broadcast/deploy.json', 'wallet/keystores/account.json', 'wallet/export.key',
    'db/backup.dump', 'demo/rewards/local/accounts.json', 'docs/threads/consent.md',
    '.vercel/project.json', 'output/wallets.json', 'temp/id_ed25519', 'export.private.json']) {
    assert.equal(privatePublicationPath(path), true, path);
  }
});
