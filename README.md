# RacesOn Podium

Sponsor-funded sporting rewards on Monad. RacesOn supplies official results;
sponsors choose prize economics; reviewers approve allocations; verified athletes
and clubs explicitly claim. Walletless beneficiaries retain their shares.

[Hosted demonstration](https://podium.raceson.com) ·
[Architecture](docs/architecture.md) · [Verification](docs/release-readiness.md) ·
[Security and privacy](SECURITY.md) · [Reviewer guide](docs/submission-preparation.md)

See the [hackathon release notes](docs/hackathon-release.md) for the final scope,
verification gates, measured improvements and remaining submission steps.

## Product

1. Select an existing RacesOn event and its races and classifications.
2. Choose reward ratios and save the rules.
3. Explicitly create the contract using RacesOn-funded gas, then fund prizes.
4. Review allocations derived from official results and publish approved awards.
5. Verify wallet ownership and explicitly claim an athlete or club award.

The isolated demo uses Monad testnet **10143** and test MON. The application
supports retained contract versions and direct athlete and club claims, with
Privy wallet integration and sponsored claim fees. Existing deployments retain
their immutable terms; new contract source does not upgrade them. Gas reserves,
sponsor balances and deposited prizes are separate. A transaction hash alone is
not proof of payment.

The demonstration dataset contains five completed rounds, 471 result records and
274 athlete aliases. Names are replaced, but exact times can be correlated with
published results: this is **pseudonymized, not anonymous**. The five-round fixture
is not a product requirement. Judge accounts and private operational records are
not distributed in this repository.

## Quick verification

Use Node 22 (see `.nvmrc`) and the committed lockfiles. No account, wallet or real
credential is needed for the source checks:

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix contracts --ignore-scripts --no-audit --no-fund
npm run check:publication
npm run check:api
npm run check:web
npm run check:lint
npm run test:rewards:ui
npm run test:locale
npm run test:wallet
npm run check:rewards:chain
npm run check:dependencies
npm run check:build
```

`check:build` constructs an environment with inert credentials, builds the real
Next.js application, and checks browser assets for a server-only sentinel. It
needs network access for build-time fonts. It verifies compilation and secret
separation, not authenticated database or payment behavior.

See [contract setup](contracts/README.md) for pinned Foundry/Solidity dependencies
and local-chain tests. `npm run check:rewards:db` replays base migrations and the
demo overlay into scratch databases on a disposable loopback PostgreSQL 16
server at port 5432. Set `PG_BIN` to its binary directory outside Homebrew. Never
replay this public, fresh-database snapshot into a retained or production database.

For authorized development, use the blank environment examples and keep populated
files ignored. The hosted entry point is `demo/rewards/web`; shared rewards UI is
in `apps/web/src/features/rewards`. Missing or mismatched mode, origin and isolated
database configuration fails closed. See [contributing](CONTRIBUTING.md).

## Scope, attribution and license

RacesOn's event administration, registrations, timing, official results and shared
application primitives predate this submission. Compatibility copies support
Podium; the separate RacesOn.com platform is outside this repository's deployment
scope. The public application import does not establish original authorship dates.
See the [contribution history](docs/hackathon-contributions.md).

OpenAI Codex assisted implementation, debugging, tests and documentation. The owner
provided product direction and release decisions. This disclosure is retained;
AI assistance and passing tests do not constitute independent security assurance.

First-party software and developer documentation use the [MIT License](LICENSE).
See [license scope](LICENSE-STATUS.md) and [third-party notices](THIRD_PARTY_NOTICES.md)
for separately licensed dependencies and assets. Branding, photographs, sporting
data and unpublished platform code are outside the software grant.
