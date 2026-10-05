# RacesOn Podium

Sponsor-funded sporting rewards on Monad. Sponsors choose an existing event and
set reward rules. Reviewed official results determine allocations. Verified
athletes and clubs explicitly authorize and claim their awards; beneficiaries
without a wallet keep their reserved share.

## Repository status

This repository is being prepared for hackathon review. The initial commit
contains project and release documentation. **Application source is not included
yet, and this checkout is not runnable.** The full reviewed source will be imported
before the repository is made public and supplied as the hackathon code link.

The live planning demo is [podium.raceson.com](https://podium.raceson.com).
It supports isolated demo logins, source-result inspection, saved sponsor rules
and allocation review. Contract creation, funding, Privy and claims are not yet
enabled in this hosted release. See the [current submission preparation](docs/submission-preparation.md)
for verified scope, judge steps and remaining release gates.

The intended complete demo uses test MON on Monad testnet (10143), with disposable local
chain (31337) tests. No mainnet deployment or production sporting database belongs
in this repository.

## Project boundaries

- RacesOn supplies sporting facts; sponsors control prize economics.
- Authenticated review and controller approval precede distribution.
- Contracts hold prize funds and enforce explicit claims.
- Server-side integer calculations determine awards.
- Funding, approval and payment are separate steps. A transaction hash alone is
  not a verified payment receipt.

Privy is used for embedded wallet access and supported wallet/signing operations.
Its exact integration and the judge walkthrough will be documented with the
source release. External wallets and sporting approvals have separate authority.

See [architecture](docs/architecture.md), [release readiness](docs/release-readiness.md),
[security reporting](SECURITY.md) and [license status](LICENSE-STATUS.md).

No runner identities, credentials, database dumps or source-to-demo account mapping
are included. Judge access instructions will be delivered privately.
