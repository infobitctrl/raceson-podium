# RacesOn Podium

Sponsor-funded sporting rewards on Monad. RacesOn supplies official sporting facts; sponsors choose prize economics; controllers review allocations; verified beneficiaries explicitly claim. Walletless beneficiaries retain their shares.

This repository contains the actual Podium application: the Next.js entry point in `demo/rewards/web`, the existing rewards UI in `apps/web/src/features/rewards`, and its API, database, domain and contract layers. Vercel builds this source from `main` for [podium.raceson.com](https://podium.raceson.com).

## Hosted demonstration

The hosted app uses only the isolated Supabase project `niklhlmljiikwbkrmapw`: Šibenik Trail League closed after five completed rounds, ten courses, seven classifications, 471 result records and 274 demo athlete aliases. Participant and club names are replaced. Exact times remain linkable to published sporting results; this is pseudonymized data, not anonymous data. No database dump or identity-to-alias mapping is published here.

Visitors browse the completed events in the existing Podium interface. Provisioned test accounts can inspect copied results; the sponsor can save and reopen prize rules and review exact integer allocations. The Round 3 duplicate uses the reviewed Long result/Races Club29 for combined scope; 196 finishes with no club remain unaffiliated per race.

The hosted V5 demonstration supports sponsor contract creation, separate prize funding, reviewer publication and explicit athlete claims. Privy provides embedded wallets and signing, including sponsored athlete claim fees. Dated testnet evidence includes finalized athlete payments; these are demonstration executions, not proof of real-athlete consent or production readiness. V6 club-signature contracts and Registry V2 are included as tested source but are not yet integrated or active in the application. Existing V5 deployments retain their original terms. Judge access is distributed privately, never through this repository.

## Hackathon scope and pre-existing work

RacesOn's event administration, registrations, timing, official results, sporting identities and shared scoring/application primitives predate this submission. This repository contains compatibility copies of some of that foundation; they are not presented as new hackathon inventions. The separate RacesOn.com platform and its production data are outside this submission's source/deployment scope.

Podium adds sponsor reward economics, reviewed allocations, Monad escrow/claims and Privy wallet/signing integration. The public repository began with documentation on 4 October 2026 and imported the application on 5 October. That import contains existing work and is not evidence that every imported line was written then. The subsequent public commits document substantial rewards integration and product changes. See the [dated contribution ledger](docs/hackathon-contributions.md) for exact commits, inherited boundaries and evidence limitations. No private upstream history, credentials or participant mappings are published.

## AI coding tools

OpenAI Codex was used to assist source development, debugging, test creation/execution and documentation, including these submission materials. The project owner directed product decisions and release authorization. AI-assisted work remains subject to the repository's tests, review and stated limitations; this disclosure does not imply an independent external security audit or formal verification. Contribution history records code changes, not a claim that every line was manually authored.

## License and attribution

First-party software and accompanying developer documentation in this repository are available under the [MIT License](LICENSE), an [OSI-approved license](https://opensource.org/license/mit). See [license scope](LICENSE-STATUS.md) for the boundaries of the grant and [third-party notices](THIRD_PARTY_NOTICES.md) for separately licensed dependencies and assets. Existing third-party notices are preserved. Branding, photographs, sporting data and unpublished platform code are not included in the software grant.

## Build and test

Use Node 22 and the committed npm lockfile:

```sh
npm ci
npm ci --prefix contracts --ignore-scripts --no-audit --no-fund
npm run check:api
npm run test:rewards:ui
npm run test:wallet
npm run check:dependencies
```

For the hosted-mode build, copy `demo/rewards/web/.env.example` to the ignored `.env.local` in the same directory, supply authorized project keys privately, then run `npm run build`. The server service-role key must never use a `NEXT_PUBLIC_` name. Build guards require matching browser/server mode, origin and isolated database. This copy intentionally fails closed without its provisioned database and source pin; it never falls back to production.

Vercel settings: Next.js, Node 22, root `demo/rewards/web`, install `npm ci --include=dev --prefix ../../..`, build `npm run build`, output `.next-build`, include files outside the root directory. Deployment configuration is held in the existing Vercel project, not a local prebuilt upload.

See [contract setup](contracts/README.md) for the pinned Foundry toolchain. `npm run check:rewards:db` replays base migrations plus the demo overlay into a disposable loopback PostgreSQL database and runs authorization scenarios with owned local chains. It needs local PostgreSQL and the built contract artifacts. The published base migrations are for fresh databases: historical identity repairs are omitted or replaced by schema-only versions. Never replay this public snapshot into an existing RacesOn database.

See [release verification](docs/release-readiness.md), [architecture](docs/architecture.md), [security](SECURITY.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [license status](LICENSE-STATUS.md).
