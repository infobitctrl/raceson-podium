# Contributing

Keep changes within the sponsor-funded rewards product. Do not import production
credentials, participant mappings or upstream registration/timing features.

Describe the user, current failure, expected observable outcome and smallest
meaningful verification before editing. Prefer a complete product slice over
new generic infrastructure. Keep routes thin and money calculations in the
existing domain/API/repository/chain layers.

## Checks

Follow the clean install and source checks in [README](README.md). Use
`npm run check:lint` for the owned rewards UI; inherited compatibility UI is not
covered by that lint gate. React dependency warnings require review and must not
be silenced by changing financial or consent lifecycles without evidence.

For contract or database changes, use the pinned tools in
[contracts/README.md](contracts/README.md), then run:

```sh
npm run check:contracts
npm run check:rewards:db
npm --workspace @raceson/rewards-chain run test:integration
```

Database checks require an owned PostgreSQL 16 server on loopback port 5432 and
create/drop only their scratch databases. `PG_BIN` selects the binary directory.
The SQL harness supports `--creation` and `--operations` for focused workflows.
Chain integration uses owned local Anvil instances, never public broadcasting.

Before publication, review the exact staged diff, run `git diff --check`,
`npm run check:publication`, and Gitleaks against the full history and candidate.
With Gitleaks 8.30.1 installed, `node scripts/check-secret-scanner.mjs` also
checks that the reviewed exceptions reject new values on the same line.
Use synthetic fixtures for negative authorization, consent and payment cases.
Never weaken checks merely to make a suite green.

## Dependency updates and previews

Routine Dependabot version proposals are paused (`open-pull-requests-limit: 0`).
Security update proposals remain enabled and both lockfiles are audited in CI.
Plan major upgrades as reviewed changes with compatibility tests; a newer version
alone is not a reason to merge. See [GitHub's update options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#open-pull-requests-limit).

Dependabot branches run the complete credential-free GitHub checks, including a
build with inert configuration. They do not create hosted previews. The Vercel
configuration [excludes `dependabot/**`](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)
from automatic deployments. Hosted preview environments require separately
approved isolated configuration; do not copy live credentials or weaken the
`reward_demo_configuration_required` guard to make a dependency preview build.

## Review and release

State the source revision, environment, changes, tests and remaining limits.
Distinguish implemented, tested, committed, published, deployed and behavior
verified. Account access, provider permission, gas spending, recipient consent and
release authority are separate. An ordinary code contribution authorizes none of
the financial actions.

The connected Vercel project builds `main` automatically. Verify its source SHA
and canonical alias after publishing. Browser checks should cover the changed
flow, relevant desktop/phone sizes, keyboard access, loading/error/retry states
and console health. Never infer a successful payment from a build or wallet hash.

Keep documentation concise and descriptive. Preserve third-party attribution,
pre-existing-code disclosure and accurate AI-assistance disclosure. Do not commit
agent transcripts, private handoffs, repetitive generated status logs or output
folders. Security reports should use the private channel in [SECURITY](SECURITY.md).
