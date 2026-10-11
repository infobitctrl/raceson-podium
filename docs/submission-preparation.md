# Reviewer and submission guide

This guide describes the source and demo. It does not assert that an external
submission form, video or hackathon entry has been completed.

## Project description

RacesOn Podium connects official sporting results to sponsor-funded rewards on
Monad. Sponsors select an existing event, choose reward economics and fund escrow.
Reviewed allocations preserve walletless shares. Verified athletes and clubs
explicitly claim; gas funding, prize deposits and reward payments remain separate.

The isolated testnet demonstration uses pseudonymized sporting data and separately
provisioned demo accounts. It supports athlete and club workflows with Privy
wallet/signing integration. Shared accounts demonstrate test personas, not
real-athlete adoption or consent. The five-round sample is not a universal rule.

## Suggested walkthrough

1. Open [the public demo](https://podium.raceson.com), inspect an existing event,
   campaign rules and separate athlete/club reward ledgers.
2. Use privately supplied sponsor access to reopen a saved plan and explain the
   event/race/classification choices and exact allocation arithmetic.
3. Show the contract version, creation receipt and separate prize deposit receipt.
   Only execute a new transaction with the relevant owner's authorization.
4. Demonstrate reviewer approval and publication of the exact allocation. Explain
   that activation is not payment and walletless beneficiaries retain shares.
5. With an authorized demo beneficiary, show wallet control, explicit claim,
   cancellation/retry behavior and a matching finalized payment receipt. For a
   club, show its recorded treasury and the required distinct owner signatures.
6. Show replay rejection and unchanged accounting after a repeated claim. Label
   simulated evidence and actual testnet transactions separately.

Judge credentials, account-wallet mappings, consent records and provider settings
must be supplied privately. Never use personal funds in shared demo wallets.

## Final submission checklist

| Area | Evidence required |
| --- | --- |
| Source | Public commit link, passing CI, clean dependency/secret checks and reproducible setup |
| Product | Sponsor-to-reviewed-allocation-to-explicit-claim walkthrough on the identified release |
| Integrity | Official source binding, integer conservation, walletless shares and immutable contract terms |
| Privacy | Synthetic examples, narrow public projections, no private credentials or identity exports |
| Usability | Desktop/phone and keyboard checks, loading/error states, clear recovery and payment status |
| Performance | Measured response times for representative campaign sizes, including chain verification |
| Rights | Software license, third-party/media rights and inherited-code attribution |
| AI disclosure | Accurate description of tools used; no claim of independent audit or manual authorship |
| Presentation | Working source/demo links, rights-approved logo and concise recorded technical/pitch videos |
| Operations | Private judge access, named support owner and an approved recovery procedure |
| Submission | Owner-confirmed team, track/community details, current portal requirements and final acknowledgement |

Use [release verification](release-readiness.md) for what this source review
actually checked. The source audit did not log into the submission portal,
validate current contest rules, upload media or complete outstanding demo claims.
Check those items directly before final submission.
