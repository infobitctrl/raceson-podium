# Direct athlete claims — 8 October 2026

V5 app/contract support is opt-in and **not activated on testnet**. Athlete wallet
creation remains explicit; signing in, viewing an award or publishing awards does
not create a wallet. V5 publication preserves walletless shares. An authenticated
athlete chooses a wallet and claims; an automatic, separately scoped platform
identity credential binds the wallet without another reviewer/payment approval.
The first claim registers and pays atomically. Existing V4 contracts retain their
original claim requirements.

Scoped evidence: 22 V5 contract tests (including original Safe quorum and 512-case
conservation fuzzing), 178 chain tests, 3 owned local-chain/API integration checks,
33 API checks, 36 disposable SQL scenarios, 37 UI tests and 18 Privy adapter tests.
API/web types and the production build pass. Desktop/mobile browser validation
used real components with labelled synthetic wallet/API fixtures; it did not
create a provider wallet or make a testnet payment. New frontend files pass lint;
two retained SponsorClaims hook warnings and existing dependency build warnings
remain. These checks are not a security audit.

The isolated migration adds a private receipt journal and account-bound service
function; it does not change campaign funds, wallets or runtime activation.
Remaining activation work: independently verify provider identity signing,
provision the separate identity issuer, deploy the pinned V5 registry/factory and
approve its narrowly scoped creation-gas policy. Hosted V5 club binding, claim and
Safe receipt integration remain unfinished; do not enable mixed V5 campaigns.

---

# Source release verification — 5 October 2026

The full local Podium application is included in this release. Build dependencies are installed explicitly with `--include=dev` because the production environment sets `NODE_ENV=production`. The configured Vercel output directory `.next-build` matches the app's production `distDir`. The existing Vercel project is connected to this repository's `main` branch and configured to build `demo/rewards/web` with the root lockfile.

Verified before publication:

- Clean locked install and full Next.js 16.3.8 production build.
- API regression suite: 1,054 passed; after the event-scope fix, all 25 hosted-copy tests passed, including the new selected-event/track case.
- Rewards UI: 1,343 tests exercised. Two provider-dependent test files were repaired and their 27 tests passed; the other 200 files passed in the full run.
- Wallet boundary: 53 passed. Dependency compatibility regressions: seven passed. npm dependency audits: zero known vulnerabilities in the installed app and contract locks.
- Contract formatting, pinned tool/dependency versions and original Safe artifact hashes; offline EVM and Monad suites passed.
- Disposable database integration: all 294 scenarios passed, including actual overlapping lock/session checks. Six migration-isolation tests and 171 chain-client tests passed.
- GitHub secret scanning, push protection and confidential vulnerability reporting enabled; no secret alerts before publication.
- Copy-specific live database acceptance: selected event/course save, exact retry and reopen; wrong round/course, combined-club injection and changed-source writes rejected. The entire test transaction was rolled back.
- Frozen isolated source: five completed rounds, ten courses, seven classifications, 471 rows, 444 finishes, 274 athlete aliases and 41 renamed clubs. Combined scope counts 443 finishes under the existing reviewed decision; 196 null-club finishes are unaffiliated per race.
- Whole-publication Gitleaks scan: 17 reviewed false positives. Six known credential values: zero source matches. Server key/password/synthetic server-sentinel comparison against browser build: zero matches.
- Eight historical migrations replaced by reviewed fresh-database templates to omit identity repairs and private identity values. Private runtime/evidence, source-to-alias mapping, database contents and populated environment files are excluded.
- Focused source security review of hosted session/ownership, projection, draft revision and dormant spending boundaries: no validated finding. Coverage is partial across copied compatibility and contract internals; this is not a certification or deployed penetration test.

Supabase's advisor reports intentionally closed RLS tables without client policies and disabled leaked-password checking. See [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [closed-table RLS advice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Shared judge credentials remain private; public signup is closed.

The broader hackathon release still needs a complete hosted sponsor-to-claim walkthrough, authorized Privy/testnet configuration, real user consent where applicable, video and final submission review. Publishing this source does not submit an application, apply to a track, create a wallet or authorize spending.
