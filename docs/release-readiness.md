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
