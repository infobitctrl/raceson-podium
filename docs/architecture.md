# Architecture and trust boundaries

A sponsor chooses existing sporting facts and reward economics. Reviewed official
results become exact allocations. Contracts hold escrow and enforce claims;
wallets provide explicit control proofs and signatures.

| Source area | Responsibility |
| --- | --- |
| `demo/rewards/web` | Isolated Next.js entry point, server routes and wallet provider adapters |
| `apps/web/src/features/rewards` | Sponsor, reviewer, athlete, club and public interfaces |
| `apps/api/src/features/rewards` | Session/role/ownership checks, workflow orchestration, provider and receipt verification |
| `packages/domain/src/rewards` | Canonical sporting/rule models and integer allocations |
| `packages/db/src/rewards` | Typed repository operations and restricted database projections |
| `packages/rewards-chain` | Contract encoding, signature domains, receipt checks and chain clients |
| `contracts` | Versioned escrow, factories, registries and claim enforcement |
| `demo/rewards/supabase/migrations` | Demo-only overlay above compatibility base migrations |

Thin routes delegate to feature services. The browser previews economics; server
facts and integer arithmetic determine money. The upstream RacesOn platform owns
events, routes, classifications and official results. Sponsors cannot invent
sporting classifications or enter results to award themselves prizes.

A saved plan freezes source/rule context. Creation reserves a recoverable nonce
and private execution journal. Prize funding does not approve an allocation;
review does not pay a beneficiary. Publication and activation precede explicit
claims. Only a matching successful, canonical and finalized receipt establishes
payment. Walletless beneficiaries keep their shares.

Athlete identity/consent and account-wallet mappings stay private. Public views
expose approved pseudonymized display and accounting through limited projections.
Blockchain addresses, transactions and state remain publicly observable. Club
ownership consent is distinct from allocation review and payment signatures.

Contract versions, budgets, operators and policy terms remain immutable for
existing deployments. New source or runtime support is not evidence of activation
on a particular campaign. The application supports retained versions; test and
release evidence must name the version actually exercised.

Retained `@raceson/*` names and copied non-rewards components serve compatibility.
They do not expand Podium into a second registration or event-management platform.
The public migration snapshot is for fresh disposable databases; historical
private identity repairs are intentionally omitted or replaced with schema-only
versions.
