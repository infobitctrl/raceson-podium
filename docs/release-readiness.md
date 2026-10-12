## Verification and receipt performance follow-up — 12 October 2026

Baseline: `877cb262dc40f7f9646abc176f5d8bffeb925f21`. Previous full
verification samples ranged from 33.651 to 51.085 seconds; three fresh requests
before this patch took 25.480, 25.607 and 32.204 seconds for 15 campaigns/65 pots.
These read existing finalized state; they are not transaction-confirmation times.
The original samples did not contain per-phase telemetry, so their exact split
between provider latency and concurrent queue load cannot be reconstructed.

Public and private checks share five HTTP starts per second. Directory envelopes
now contain up to eight read-only RPCs, with at most 40 logical reads per second
and a separate rolling 20-call budget for `eth_call` (private requests count
conservatively against it). These stay below the fixed endpoint's documented
50 RPC/s and 25 `eth_call`/s limits. The endpoint, private unbatched transport,
FIFO order, timeouts and absence of retries remain. The limiter is process-local;
it cannot guarantee an IP-wide quota across hosting instances.

Each full directory refresh shares one finalized header and its bytecode reads.
State and receipt queries still execute, every observer rechecks canonical blocks
and chain identity, and nothing is reused across refreshes. The public response's
`Server-Timing` distinguishes fresh, joined and cached work, reports initial
loading and verification duration, and gives the longest summary-write duration.
Cached responses report the stored refresh timings, not new chain work. No
wallet, receipt hash, account or credential is included in these metrics.

Receipt recording previously observed the campaign/award once in the service and
again in the receipt verifier. Athlete, club-payment and club-registration paths
now return the verifier's own checked view. All exact transaction, amount,
recipient, nonce, event, finality and canonical-block assertions remain. Account,
scope, treasury and Safe nonce rechecks remain; preparation and signing are unchanged.

Owned-chain measurements (synthetic accounts, no hosted sends) used identical
contracts and 200 ms HTTP pacing. For 15 programmes/65 pots with a synthetic
150 ms response delay, complete results were equal: 93 to 54 HTTP requests and
20.023 to 11.569 seconds. An already-finalized V6 athlete receipt required 59
versus 32 requests and 11.726 versus 7.168 seconds. These isolate application
verification; they are not a promised public-network latency.

Regression coverage includes mixed-batch rate limits, cancellation, response
identity/errors, read-only transport, refresh-scoped reuse, fresh canonical
rechecks, receipt write rejection and one complete observation per receipt.
The release's exact CI run and hosted measurements provide final validation.

## Hackathon release candidate — 12 October 2026

The final review starts from `120be9c46acb2a5c67b234ea5521bf6e89d5b499`.
The small follow-up removes unsupported hosted profile-history API/database reads
while keeping their existing empty UI and ordinary/local history behavior.
Five regression cases cover hosted request suppression, empty slugs and retained
compatibility paths; three fail against the prior implementation. Next response
headers now prohibit incoming framing and MIME sniffing without imposing script,
connection or outgoing-frame restrictions on wallet providers.

Baseline API (1,241), UI (1,917), locale/account (93), wallet (63), chain unit (212),
contract and owned-chain integration checks pass, alongside types, zero-warning
lint, dependency audits, publication and synthetic production-build checks.
The follow-up reruns affected suites; the exact final commit must pass all CI jobs,
including disposable database verification and full-history secret scanning,
before tagging. See [hackathon release notes](hackathon-release.md) for scope,
performance evidence and remaining owner submission steps.

## English-only hackathon presentation — 12 October 2026

The Podium composition root now fixes the presentation language to English.
Saved browser and account language preferences are left intact, including when
other account fields are edited. Nested compatibility layouts inherit the same
language boundary; desktop/mobile language controls and account language fields
are hidden while that boundary is active. Wallet, consent, payment, authentication
and account update logic are unchanged.

English and Croatian dictionaries are separate modules with their original
contents preserved verbatim. The initial Podium shell and the shared English
fallback import only English. The shared bilingual provider and Croatian
compatibility copy remain available in source; this is a hackathon presentation
decision, not deletion of language support. Some lazy compatibility modules still
contain bilingual copy. Re-enablement requires restoring the selectable provider
and browser/account preference initialization at RewardsDemoEntry, then rerunning
locale and rendered checks.

`npm run test:locale` verifies shared bilingual behavior, dictionary completeness,
interpolation and account preference preservation. Rewards UI tests cover fixed
English despite Croatian cookies/account settings, nested layouts, route-language
attempts and server/client agreement. CI now runs these locale/account checks.
Initial-script sizes and controlled download timings are measured independently
of complete page load and live chain verification.

## Responsive artwork and shared sponsor details — 12 October 2026

Event photographs now have 480/960 pixel WebP card variants and larger header
variants. Original artwork and CSS framing are retained. The two largest originals
(3.11 MB and 2.77 MB) become 37.6 KB and 86.6 KB at the 960 pixel card size;
the shared header logo drops from 274.8 KB to 24.2 KB. Browser selection depends
on layout and display density; these are file sizes, not page-load guarantees.
Regeneration is documented alongside the optimized assets.

Home now shares one sponsor scope across live campaigns and distribution history.
Public branding reads use the existing browser QueryClient with 30-second
freshness and 60-second inactive retention. Public details render independently
of owner requests. Owner-only records remain in exact-session component state,
are discarded on logout/rotation, and never enter the public cache unless their
ID is already public. Saves update existing public entries and shared owner views;
conflicts and failures retain the existing retry behavior. Review records remain
read-only. No API, database, chain, wallet, consent or payment implementation changes.

A controlled Home regression delays public data by 40 ms and owner data by two
seconds: public/owner requests fall from two each to one each, and both sponsor
names are present at 60 ms instead of waiting for the owner. Additional regressions
cover navigation reuse, nested providers, failure recovery, account/session
changes, late responses/saves and unpublished branding isolation. Hosted asset
transfer and rendered checks accompany the release; this does not change full
chain-verification latency.

## More efficient complete campaign verification — 12 October 2026

The public directory now overlaps at most 16 complete campaign observations,
refilling each slot when it finishes. This fills the existing four-read RPC
batches more efficiently. The same shared queue still permits five HTTP starts
and at most 20 logical reads per second per process. Private transports and all
transaction, receipt, runtime, balance, accounting and finality checks are unchanged.
The 90-second deadline still retains dated facts and prevents overlapping refreshes.

On an owned disposable chain, the current 15-campaign/65-pot shape produces
identical full observations with 117 to 93 HTTP requests. At the deployed 200 ms
start interval, full verification takes 23.384 versus 18.877 seconds. A separate
16-campaign/96-pot test also produces identical results and keeps the longest
observed queue wait below the existing 15-second request timeout. These controlled
measurements do not guarantee provider latency. Regression tests cover refilling
33 campaigns and stopping a 200-campaign directory at the deadline without
starting another refresh over stalled workers. No new cache, provider, dependency,
database change or wallet/consent/payment behavior is introduced.

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
