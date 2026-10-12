# Hackathon release — 12 October 2026

RacesOn Podium demonstrates sponsor-funded rewards from official sporting results
on **Monad testnet 10143**, using test MON. The hosted demo is
[podium.raceson.com](https://podium.raceson.com). This release freezes the reviewed
hackathon source; it is not a mainnet or real-funds release.

## What is included

- Existing-event selection, saved reward economics, explicit contract creation
  with RacesOn-funded gas, separate prize funding, reviewed allocations and
  explicit athlete/club claims. Walletless shares and immutable contract terms remain.
- Fast dated campaign summaries with complete background chain verification,
  bounded RPC batches, responsive WebP artwork and shared sponsor reads.
- English-only hackathon presentation, preserving saved language preferences
  and the Croatian source dictionaries for later re-enablement.
- Incoming-frame protection and MIME-sniffing protection. The hosted account
  view now returns its existing empty history state directly because the separate
  platform's history API/view is unavailable in this demo.

The performance follow-up removes duplicate receipt observations, shares one
finalized snapshot per directory refresh and fills larger bounded read batches.
Wallet, consent and payment rules, contracts, database and provider configuration
are unchanged. The hosted history guard starts zero API/database reads; regression
tests also retain the ordinary and local-demo history paths.

## Verification and security

The GitHub release links the exact commit's Source quality run. All three jobs
must pass: application, contracts/disposable PostgreSQL and full-history secrets.
They cover API/domain/repository tests, UI and locale/account tests, wallet adapters,
chain clients, EVM/Monad contract checks, local-chain integration, migration and
SQL scenarios, zero-warning rewards lint, types, publication paths, dependency
audits and a production build with synthetic server-credential isolation.

The release review traced current authentication, ownership, SQL sessions/grants,
public projections/caches, provider signing and V7/registry claim boundaries.
No validated vulnerability was found in those paths. Baseline tracked-source and
132-commit history scans were clean, GitHub had no open secret alert, and both
dependency audits reported no known vulnerabilities. Final CI repeats these gates.

Manual semantic coverage of inherited compatibility components and historical
contracts is partial. This is a single-agent review, not an independent audit,
formal verification or guarantee against unknown vulnerabilities. Public contract
state, addresses, amounts and transactions remain public blockchain information;
account mappings, consent, credentials and signing journals remain private.

## Verification performance follow-up

The original full live check varied with provider and shared-queue load. Three
fresh baseline samples took 25.480–32.204 seconds; earlier samples reached
51.085 seconds. Controlled tests reduced complete directory verification from
20.023 to 11.569 seconds and an already-finalized receipt check from 11.726 to
7.168 seconds. Complete results and receipt validation remain equal. See
[the detailed measurements and limits](release-readiness.md) and the versioned
GitHub release for hosted results.

## Earlier measured performance

Earlier 12 October releases measured the following changes. These measurements
retain their original scope; they are not new full-page benchmarks for this tag.

| Measurement | Before | After |
| --- | --- | --- |
| Events initial modern JavaScript, gzip | 393,072 bytes | 310,413 bytes |
| Browser-selected event photo/logo set | 7,903,928 bytes | 648,084 bytes |
| Home public/owner sponsor requests | 2 / 2 | 1 / 1 |
| Full live directory, 15 campaigns/65 pots, two-run mean | 25.393 s | 22.198 s |

Full verification still depends on the testnet provider and must retain receipt,
accounting and finalized-block checks. Dated cached totals are not payment proof.
Future work can assess progressive large-chart rendering, compatibility bundle
splitting and directory/detail snapshot reuse with the same privacy and freshness
guards. These are optimization opportunities, not established release blockers.

## Before submitting

Use the [reviewer guide](submission-preparation.md) for the walkthrough and owner
checklist: private judge access, rights-approved media/video, team and track details,
support contact, current contest requirements and submission acknowledgement.
This source release does not submit a hackathon form or finish separate demo-claim
operations. Rehearse the authorized end-to-end demo on the chosen accounts;
automated local payments do not establish real athlete consent.

Reproduce checks from the [README](../README.md) and
[contract setup](../contracts/README.md). Detailed change history and testing
limits are in [release verification](release-readiness.md). Retain the existing
license, inherited-code attribution and AI-assistance disclosure.
