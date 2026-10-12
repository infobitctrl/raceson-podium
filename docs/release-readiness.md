## Faster complete public directory refresh — 12 October 2026

Full directory verification groups up to four read-only RPC calls per request,
up from two. The same queue permits five HTTP starts per second, bounding the
process to 20 logical reads per second. This is below the selected testnet
endpoint's documented 50 RPC/s and 25 eth_call/s limits, checked against
[Monad network documentation](https://docs.monad.xyz/developer-essentials/testnet).
The limit is process-local, not an account-wide or distributed quota.

All observer logic is unchanged: transactions, receipts, bytecode, balances,
accounting and finalized-block checks still run. The private transport, wallet,
consent and payment flows, failure deadline and dated fallback remain unchanged.
No provider key, retry, dependency or new cache is introduced.

On an owned disposable chain, 15 funded programmes with 65 pots produce identical
complete observations. Compared with the deployed two-read transport, HTTP
requests fall from 201 to 117 (41.8% fewer); a synthetic 20 ms request-start
interval completes in 4.229 versus 2.524 seconds. The deployed interval remains
200 ms. Hosted performance still depends on provider latency and is measured
separately during release verification. Tests cover reversed response ordering,
partial-batch errors, short batches, the logical-read ceiling, fresh reads and
unchanged private request pacing.

## Saved public campaign card summaries — 12 October 2026

Campaign cards preload the latest saved, fully verified public amounts and status.
Each campaign has an independent, project/environment-scoped Runtime Cache entry;
only the strict existing public projection is stored. Entries retain their chain
block and original observation time. Current database publications control list
membership, metadata and identity; changed or withdrawn publications cannot reuse
an old summary. Cache reads are bounded to one second and retention is one day.
The cache is ephemeral: a miss safely falls back to the dated publication.

Public browsing treats observations younger than 60 seconds as recent. Older
figures trigger the unchanged full verification. While that request runs, the
browser checks saved summaries every four seconds so completed campaigns update
individually. Visible pages recheck on a 60-second interval; Refresh status forces
a check. New confirmed payments and lifecycle states become visible as their
full observer completes. This is a public display cache, not a payment receipt
or a guarantee of instantaneous chain state. No financial action is intercepted.

Failed checks keep the latest available figures and dates. Browser merges reject
older observations even if a delayed response or cache eviction returns publication
zeros. Private live-only queries, wallet/consent/payment implementations, chain
validation, RPC pacing and the 90-second server deadline are unchanged. No new
scheduled job, database migration or detached hosted verification is introduced.

Regression coverage includes a new-server cache preload, confirmed payment/status
projection, partial updates during an unfinished request, failure recovery,
cache outages/timeouts, strict privacy, replaced/withdrawn publications and the
60-second freshness boundary. Hosted measurements accompany release verification.

## Full public directory verification — 12 October 2026

The public directory groups up to two read-only JSON-RPC calls per HTTP request.
It retains the existing endpoint, five HTTP starts per second, zero retries and
zero result caching. Private observers keep their original transport. Contract
getters retain deployless aggregation; every receipt, runtime, balance and finality
check still runs. The directory transport explicitly rejects transaction methods.

A disposable-chain regression verifies 15 independent programmes and 65 prize
pots against the original transport: identical observations, 357 to 201 network
requests, and 7.222 to 4.061 seconds with a synthetic 20 ms start interval. These
are controlled measurements, not hosted latency promises. Hosted validation and
exact-commit checks accompany deployment.

## Public browsing — 12 October 2026

Campaigns and Home now display dated publications before the live directory check
finishes. The read-only `/api/v1/rewards/public-campaigns/snapshot` endpoint returns
the existing strict public projection with `refreshStatus: published`; it does
not start chain work or expose execution records. Events uses this publication
list for sponsorship counts, so chain availability cannot hide those counts.

Live verification remains bounded and request-owned on hosted functions. Its
public observer overlaps independent pot reads at a single finalized anchor. Four
campaign checks stay in flight; each completed slot takes the next campaign
immediately, avoiding a slowest-campaign barrier between groups.
Public browsing allows five seconds beyond the server deadline to receive partial
verified updates; private callers retain their existing request behavior. A failed
check keeps dated figures visible and offers retry. Late publications never replace
newer live data. The freshness notice precedes the campaign cards, pagination
returns focus to results, and below-fold Home images load lazily. The header uses
its compact navigation earlier and lets the logo shrink to avoid horizontal overflow.

Tests cover deferred/failing reads, retry, deduplication, publication privacy,
route restrictions, timestamps, pagination focus and unchanged private loading.
Provider latency still affects fresh chain status; a fast publication response is
not a fresh payment check. Wallet, consent and payment flows are unchanged.

## Full league verification uses larger bounded batches

The public chart collector requests up to 500 rewards per response, reducing a
302-reward league from 13 requests to one. The 100-row option stays supported;
legacy requests still default to 25 and the visible ledger still shows 25 rows.
The finalized-block, complete
allocation commitment, per-reward and privacy checks remain mandatory. Failed or
inconsistent batches never replace a complete verified collection.

A disposable EVM regression compares all 302 records at the same block using
the hosted deployless read batching configuration, checks identical results and
bounds the RPC overhead. This reduces repeated work; hosted elapsed time still
depends on network load and function reuse. Wallet, consent, payment and provider
configuration are unchanged.

The public campaign overview also overlaps the independent reads of up to six
pots at its single finalized anchor. Private observers retain their existing
read order. Public Server-Timing headers report only numeric durations for
campaign lookup, observation and award validation; they expose no private inputs.

## Progressive public campaign loading

Public detail pages display the existing published campaign projection while
current chain verification runs. Published and last-verified timestamps remain
visible. The first reward page may reuse the freshly verified campaign block;
all canonical-chain, allocation commitment and row checks still apply. A cache
miss performs full verification. Private action observers are unchanged.

Completed reward collections are retained only in the campaign screen's memory
(up to 12 pot collections). Revisiting a round shows its complete chart and ledger
immediately while requesting current status. Partial collections never replace a
verified result; failures retain the original timestamp and offer a fresh retry.
No wallets, consent, signatures or private identities are cached or newly exposed.

## Public campaign loading follow-up — 11 October 2026

Public campaign details now load sporting context through a narrow read-only
source projection, avoiding a chain refresh of unrelated campaigns. Reward pages
reuse an exact finalized observation for up to two minutes (64 snapshots per
reader), with fresh chain/finality/hash checks before reuse. Each page still
verifies its own 25 reward records and allocation commitment; complete chart
collections retain one block. Unpinned refreshes always re-observe current state.
No wallet, consent, private action, contract or database changes.

Regression coverage includes cache isolation/expiry/eviction, provider changes,
failed reads, public field restrictions, hosted routing, independent source
loading and actual claims on a disposable local chain. Hosted timings depend on
provider load and process reuse; this is not a guaranteed latency target.

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
- Both the hosted request filter and public pagination accept the optional block
  number only for public reward reads. Private verification,
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
