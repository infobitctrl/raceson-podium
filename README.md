# RacesOn Podium

Sponsor-funded sporting rewards on Monad. RacesOn supplies official sporting facts; sponsors choose prize economics; controllers review allocations; verified beneficiaries explicitly claim. Walletless beneficiaries retain their shares.

This repository contains the actual Podium application: the Next.js entry point in `demo/rewards/web`, the existing rewards UI in `apps/web/src/features/rewards`, and its API, database, domain and contract layers. Vercel builds this source from `main` for [podium.raceson.com](https://podium.raceson.com).

## Hosted demonstration

The hosted app uses only the isolated Supabase project `niklhlmljiikwbkrmapw`: Šibenik Trail League closed after five completed rounds, ten courses, seven classifications, 471 result records and 274 demo athlete aliases. Participant and club names are replaced. Exact times remain linkable to published sporting results; this is pseudonymized data, not anonymous data. No database dump or identity-to-alias mapping is published here.

Visitors browse the completed events in the existing Podium interface. Provisioned test accounts can inspect copied results; the sponsor can save and reopen prize rules and review exact integer allocations. The Round 3 duplicate uses the reviewed Long result/Races Club29 for combined scope; 196 finishes with no club remain unaffiliated per race.

Contract creation, funding, controller approval, Privy provisioning and claims remain unavailable on this hosted copy. Local testnet implementation and simulation tests are included; those do not establish real athlete consent or complete a hosted payment flow. Judge credentials are distributed privately, never through this repository.

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

See [release verification](docs/release-readiness.md), [architecture](docs/architecture.md), [security](SECURITY.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [license status](LICENSE-STATUS.md). Public visibility is not a new project-wide open-source license grant.
