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
- Pause unsolicited routine dependency-upgrade PRs and exclude Dependabot branches
  from hosted previews; retain security updates and credential-free CI builds.
- Replace superseded submission/status prose with current setup, architecture,
  privacy and reviewer guidance. Preserve license, inherited-code and AI disclosures.

## Initial audit evidence

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

The follow-up below resolves the ten React warnings. Provider dependencies still
emit build warnings; these are distinct from the rewards lint gate.

Read-only UI checks cover public entry/navigation and private-route rejection.
This review does not re-execute a sponsor-to-recipient testnet payment, recheck all
mobile/accessibility flows, prove real-user consent, or finish outstanding cohort
claims. Earlier testnet evidence must retain its original date and contract version.

Public reward verification now uses the bounded, finalized-block loader described
below. Network latency still depends on the hosted service and chain provider.
Authorization and signing readiness are never cached to accelerate display.

See the [submission checklist](submission-preparation.md) for product walkthrough,
media, support, rights and portal items requiring separate completion.

## Follow-up: effect lifecycles and public verification

Starting source: `96122b1583e0b58b7bac61061544c910b4334c1f`.

- Resolve all ten lint warnings and fail the rewards lint command on any warning.
  Effect callbacks stay stable across presentation changes. Callback-only renders
  preserve explicit consent; editor-step query changes preserve unsaved rules.
  Request-generation cleanup keeps its existing invalidation behavior.
- Read the first public reward page at the current finalized block, then request
  at most four remaining pages concurrently at that same block. Restore reward
  order before publishing the complete collection. A changed block, timestamp,
  total, availability, duplicate reward or failed request discards the collection;
  retry begins with a fresh finalized block. Unmount and selection changes abort
  outstanding requests. Existing 25-row response limits remain in force.
- Only public pagination accepts the optional block number. Private verification,
  wallet prompts, explicit consent, transaction submission and receipt validation
  keep their existing action paths. No authorization cache, contract, database
  migration, provider setting or public projection field changes.

The controlled 741-reward regression uses one second per page: 30 sequential
request waves become nine bounded waves (70% less waiting). The test fails against
its sequential predecessor and passes with the new loader. This is a latency
model, not a claim that every live provider will improve by exactly 70%.

Focused negative tests cover invalid/future/reorganized snapshot blocks, partial
collections, mismatched responses, cancellation, recovery, private-field rejection
and callback-only rerenders. An owned local-chain journey verifies twelve exact
payments, rejects missing consent and duplicate claims, keeps earlier public
snapshots unchanged after payment, and confirms fresh reads show the receipts.
These synthetic checks establish neither real athlete consent nor testnet payment.

The source-quality workflow runs application, wallet, chain, contract, database,
publication, dependency, build and full-history secret checks on the final commit.
Use its exact-commit results as the release gate; local test artifacts are private.
