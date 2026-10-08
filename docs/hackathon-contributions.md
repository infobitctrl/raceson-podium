# Hackathon contribution history

Scope: the public RacesOn Podium repository through `62d27c880e3d33e80d894597c893e69b31df424f`, reviewed 8 October 2026. This ledger describes source history; a commit by itself does not prove a deployed or consented user flow.

## Pre-existing foundation

RacesOn's sporting platform predates this rewards submission: event/race administration, registrations, timing, official results, persistent sporting identities and shared scoring. Podium consumes those facts. Compatibility copies of shared web/API/domain/database code and base migrations remain in this repository to support the isolated rewards application. Retained `@raceson/*` names are compatibility names, not a claim that the whole sporting website was built for the hackathon.

Rewards contracts, calculations and prototype flows also existed before the October public import and were developed further in the dated changes below. The public import does not establish the original authorship date of each such component. The separate private upstream platform/history and real data are not exported here.

## Public history during the build window

The published history begins on 4 October, within the hackathon's September–October 2026 build window. It is not a continuous public Git record starting on 1 September. No earlier commits have been fabricated, backdated or rewritten to make the import look like fresh implementation.

| Commit date | Public commit | Contribution / boundary |
| --- | --- | --- |
| 2026-10-04 | [c3ed463](https://github.com/infobitctrl/raceson-podium/commit/c3ed4631983b07ba3b19412be3d289af97519ef3) | Public repository begins with submission documentation; not the start of all underlying development. |
| 2026-10-05 | [9f96727](https://github.com/infobitctrl/raceson-podium/commit/9f96727ff3769c429e6b73c78b127f65fea81aae) | Application import and isolated hosted demo; includes pre-existing code, not a new-authorship claim. |
| 2026-10-05 | [ceddec4](https://github.com/infobitctrl/raceson-podium/commit/ceddec49746df418bc789c088ef5f98b5663f26c) | Bind sponsor funding to copied sporting sources and wallet authority. |
| 2026-10-06 | [299d868](https://github.com/infobitctrl/raceson-podium/commit/299d8682288221af4dcf2d6e5903355bbfd3f940) | Exact source-backed award approval for hosted reviewers. |
| 2026-10-06 | [7b89340](https://github.com/infobitctrl/raceson-podium/commit/7b8934037936cb53030f540552c11d31d9b7b94c) | Hosted wallet-control proof and athlete destination flow. |
| 2026-10-06 | [ed2a7ac](https://github.com/infobitctrl/raceson-podium/commit/ed2a7ac3fadc8f2cc0a1aa3462e63427c6483ce9) | Hosted club treasury and claim workflow integration. |
| 2026-10-07 | [b80ddd9](https://github.com/infobitctrl/raceson-podium/commit/b80ddd9af3babccb2466ae85a77ac755c0ca6f4f) | Reviewer-owned operator wallet for new demo campaigns. |
| 2026-10-08 | [58626ec](https://github.com/infobitctrl/raceson-podium/commit/58626ec3da04d595e46cb61ade0913e83565bb3e) | Explicit wallet setup and opt-in direct athlete claims. |
| 2026-10-08 | [4fd9cac](https://github.com/infobitctrl/raceson-podium/commit/4fd9cac49ff7b3b82b55fba172464f714f8d98fc) | Privy-sponsored athlete claim fees. |
| 2026-10-08 | [fc4863e](https://github.com/infobitctrl/raceson-podium/commit/fc4863e9cbd3d91650bb88d84146855debfc3452) | Continue reviewer approval through publication and claims opening. |
| 2026-10-08 | [1012410](https://github.com/infobitctrl/raceson-podium/commit/1012410f2a3e14426bd016ff0ebe7357ea98b4fb) | Member selection for sponsored club treasury creation. |
| 2026-10-08 | [93de46f](https://github.com/infobitctrl/raceson-podium/commit/93de46f9081a37e2cf104cfdcf462a6ecbb75941) | Public campaign accounting and complete reward hierarchy. |
| 2026-10-08 | [2664e4a](https://github.com/infobitctrl/raceson-podium/commit/2664e4aaa94aba22d2b10dd46e79a50a95b2f37a) | Finalized-revert creation recovery, dependency fixes, small-club guidance and tested V6 source; V6 app activation remains pending. |
| 2026-10-08 | [62d27c8](https://github.com/infobitctrl/raceson-podium/commit/62d27c880e3d33e80d894597c893e69b31df424f) | Publish an already-deployed reviewer-boundary migration; a source-packaging correction, not a new hosted feature. |

The [complete public history](https://github.com/infobitctrl/raceson-podium/commits/main/) contains the intervening UI, authorization, recovery and workflow changes. The table is a navigational sample, not an exhaustive list of authors or every contribution.

## What the submission claims

The rewards contribution connects existing sporting facts to sponsor-defined economics, saved immutable plans, separately funded Monad escrow, reviewed awards and explicitly confirmed recipient claims. The new hosted integration and subsequent fixes are reviewable in the commit diffs above. The project does not claim to have invented its inherited sporting platform or that all imported source was newly written during the build window.

Tests with synthetic accounts and local chains, real testnet observations, and actual participant consent are different forms of evidence. In particular, V6 contracts/Registry V2 in source do not establish active V6 app behavior; deployed V5 contracts retain their existing policy. Neither this ledger nor commit counts certify the hackathon's substantial-majority eligibility requirement. The disclosed pre-existing scope and dated changes are provided for judges to assess that requirement.

## AI assistance and attribution

OpenAI Codex assisted implementation, debugging, testing and documentation. The owner supplied product direction and release decisions. AI assistance does not establish that code is correct or independently audited; see the README, tests and security limitations. External libraries and vendored components retain their original attribution and terms in [third-party notices](../THIRD_PARTY_NOTICES.md). First-party published software is covered by [MIT](../LICENSE), subject to [license scope](../LICENSE-STATUS.md).
