# Architecture and trust boundaries

The sponsor selects an existing event, chooses reward categories and ratios, saves
rules, explicitly creates a reward contract and deposits the prize budget.
Authorized review turns official results into exact approved allocations. Verified
athletes or club representatives register wallets, authorize and claim awards.

| Boundary | Responsibility |
| --- | --- |
| Upstream sporting platform | Event, route, classification, registration and official-result truth |
| Sponsor | Prize budget and reward ratios |
| Rewards domain/API | Integer calculations, authorization, immutable source/rule binding |
| Sporting reviewer and controller | Review and attest the exact allocation |
| Contract | Escrow, approved distribution and replay-safe claims |
| Privy or external wallet | Supported wallet access, control proofs and explicit signatures |
| Athlete or club representative | Verified ownership and recipient consent |

Creation gas, sponsor balances and deposited prizes are distinct. Walletless
beneficiaries retain their shares. Private identity records stay outside public
chain instructions. Existing contracts retain their original versions and terms.

The planned source layout preserves the standalone demo app, rewards features,
API, domain, database and chain packages, contracts and isolation tests. Retained
`@raceson/*` compatibility names do not make this the production sporting portal.
