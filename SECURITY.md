# Security and privacy

Podium is an isolated testnet demonstration. Shared demo accounts do not establish
real athlete ownership or consent. No production funds-safety certification or
independent external audit is claimed.

## Public and private information

| Information | Boundary |
| --- | --- |
| Contract source, ABI, bytecode and public deployment addresses | Public and reviewable. Source is not a signing credential. |
| Broadcast transactions, contract state, recipient addresses and amounts | Public blockchain facts; removing them from Git cannot make them private. |
| Pseudonymized approved sporting display and reward totals | Deliberately public through narrow projections. Exact sporting times remain linkable. |
| Account-to-wallet mappings, identity proofs, consent records, unpublished allocations and signing journals | Restricted server/database records, excluded from public source and public API projections. |
| Passwords, tokens, seeds, private keys, provider credentials and private signed payloads | Never commit, expose in client bundles, print in logs or include in issues. |

Public fixtures use synthetic identities. Real participant contacts, database or
Auth exports, identity-to-alias mappings, keystores and populated environment files
must remain outside Git. Browser-visible `NEXT_PUBLIC_` variables are public; a
service-role or signer credential must never have that prefix.

## Controls

The hosted API has an explicit method/path allowlist. Allowed money and provider
actions still require their own session, role, ownership, source, consent and
receipt checks. Database projections are service-only. Sponsor writes bind to the
current session, saved revision and canonical sporting source. Integer money
calculations run on the server; browser amounts are previews.

Claims bind identity, destination, contract, chain, amount and replay context.
Historical contract versions preserve their terms. Funding, allocation approval,
activation and finalized payment remain separate states. Creation reservations
count failed attempts toward 20 global and per-sponsor attempts per rolling day;
the unchanged per-attempt cap is 3 test MON.

GitHub secret scanning and push protection are enabled. Source quality CI scans
full Git history with Gitleaks, checks tracked paths, runs locked dependency
advisory checks and verifies a synthetic server key is absent from browser assets.
The Gitleaks allowlist is restricted to exact reviewed lines in named files;
it does not exempt test directories or arbitrary credential-like values.

## Review scope and limits

The 11 October 2026 review inventoried tracked source and scanned all 107 existing
commits. Eighteen initial pattern alerts were reviewed as synthetic idempotency
values, classification labels or localization text; no actual secret was found.
GitHub had no open secret alerts, and both npm locks had zero known advisories at
review time. These checks cannot prove that an undiscovered credential never existed.

Semantic review covered hosted authentication and ownership, public projections,
signing policy, wallet/claim state, current contract and service-only SQL
boundaries. Coverage of inherited compatibility code and historical versions is
partial. Local tests are not a deployed penetration test, formal verification or
proof of real-user consent. See [release verification](docs/release-readiness.md)
for repeatable checks and outstanding product evidence.

## Reporting

Use GitHub's private vulnerability reporting for this repository or an existing
private contact with its owner. Include affected version, reproduction and impact
without credentials or real personal data. Do not post exploit details or secrets
in public issues. If a credential is exposed, revoke or rotate it; deleting a file
or adding an ignore rule is insufficient.
