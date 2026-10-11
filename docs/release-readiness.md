# Source verification — 11 October 2026

Reviewed from public commit `dc5e74f2cf3479ae803051a1287e4a49efe85834` in a separate
release checkout. Canonical application source matched the fetched remote; public
packaging and sanitized historical migrations were preserved.

## Corrections in this release

- Restore the already approved 20-attempt creation migration to public source.
  The hosted limit had changed on 9 October while the public snapshot still used
  ten. No hosted database change is made by this release.
- Repair a partial UI mock and a stale club projection expectation. Update SQL
  capacity assertions to the approved limit and include recovery/claim scenarios
  in the standard database command.
- Remove unused imports and an unused lazy entry; make the numeric rounding test
  explicit; restore scoped rewards lint and portable PostgreSQL tool selection.
- Use platform temporary directories for local-chain tests and guarantee cleanup
  if setup fails; retain strict directory ownership and loopback restrictions.
- Add CI for application checks, local contracts/database integration, full-history
  secret scanning, publication paths, dependency advisories and synthetic builds.
- Replace superseded submission/status prose with current setup, architecture,
  privacy and reviewer guidance. Preserve license, inherited-code and AI disclosures.

## Local evidence

Environment: Node 22.23.2, locked npm dependencies, macOS, PostgreSQL 16 on loopback,
Foundry 1.8.0, Solidity 0.8.36 and owned Anvil instances. No public transaction,
provider setting, production dataset or beneficiary consent was changed.

| Check | Result |
| --- | --- |
| API/domain/repository suite | 1,209 cases covered; the socket-dependent file passed separately after the sandbox denied local sockets |
| Rewards UI | 1,801 tests across 258 files |
| Wallet adapters | 63 tests |
| Chain-client unit tests | 207 tests |
| Contract checks | 257 tests per EVM/Monad configuration, including fuzz/invariant suites; pinned Safe artifacts and formatting verified |
| Owned local-chain integration | Full run plus corrected direct-claim file; 224 original cases covered, plus the new directory-boundary regression |
| SQL migration isolation | 6 tests |
| Disposable database integration | 297 scenarios plus 5 creation-recovery and 49 current operation/claim scenarios |
| Types and rewards lint | Types pass; zero lint errors, ten existing React dependency warnings retained for review |
| Dependency audit | Zero known vulnerabilities in application and contract lockfiles at review time |
| Secrets | All 107 starting commits scanned; 18 initial alerts reviewed as non-secrets; exact allowlists preserve default detectors |
| Build | Real Next.js production build with inert credentials; server-only sentinel absent from client assets |

GitHub CI records checks against the published commit; local evidence is not a
substitute for a green remote run. Counts include negative authorization and
failure cases and do not represent real athlete payments.

## Remaining limits

Semantic security review focused on authentication, ownership, public projection,
signing, claim, current contract and SQL boundaries. Inherited compatibility code
and historical versions were not exhaustively reviewed line by line. No validated
vulnerability was found in that scope; this is not formal verification or an
independent external audit.

Existing React effect-dependency warnings remain in legacy claim/editor components
and stale-request guards. Provider dependencies emit build warnings. Refactoring
those lifecycle paths requires focused behavior evidence; dependencies must not be
added mechanically where doing so could repeat requests or discard unsaved work.

Read-only UI checks cover public entry/navigation and private-route rejection.
This review does not re-execute a sponsor-to-recipient testnet payment, recheck all
mobile/accessibility flows, prove real-user consent, or finish outstanding cohort
claims. Earlier testnet evidence must retain its original date and contract version.

A prior measured large campaign still required minutes for sequential winner
verification. Safe follow-up optimization should batch public observations with
bounded concurrency and immutable block context; measure before and after and
preserve fail-closed receipt checks. Never cache authorization or signing readiness
merely to accelerate display.

See the [submission checklist](submission-preparation.md) for product walkthrough,
media, support, rights and portal items requiring separate completion.
