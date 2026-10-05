# RacesOn Podium — submission preparation, 5 October 2026

Local review pack; no portal field, selected track, bounty or submission has been
changed. This supersedes the current-state claims in the 4 October copy. The
authenticated [submission form](https://hackathon.monad.xyz/project?tab=submission)
still shows **1/6 complete**, last saved 18 September 11:20 UTC. The cutoff shown
in Zagreb is **14 October 2026 at 05:59 CEST / 03:59 UTC**.

## What judges can use today

[podium.raceson.com](https://podium.raceson.com) is an isolated, authenticated demo
with sponsor rules and saved allocation previews. It uses five completed rounds,
471 result rows and 274 fictional athlete profiles. The original sporting platform
and database are separate. All 444 finishes remain in the source; combined rewards
count 443 after the owner's duplicate-finish decision. The 196 finishes with no
club are unaffiliated for those races; their athlete rewards are retained.

Exact historical times make results cross-correlatable. The dataset is
**pseudonymized, not anonymous**. Source identities, contact details, old login
credentials and consent records are not imported. Public repository examples must
be invented fixtures; judge exports and the exact copied dataset stay private.
Shared accounts demonstrate test personas, not real athlete consent or adoption.

The hosted application does not yet expose contract creation, gas spending,
funding, Privy wallets or claims. Its testnet label and allocation arithmetic alone
do not establish a working onchain submission or satisfy the Privy bounty. The
retained local/September demonstrations are separate evidence and must be labelled
by date, environment and version.

## Draft form copy

### One-line description

RacesOn Podium turns verified race participation into sponsor-funded rewards for athletes and clubs, with reviewed allocations and a Monad escrow-and-claim workflow.

### Project description

Local runners and clubs create the energy behind recurring race communities.
RacesOn Podium gives sponsors a way to reward that participation with explicit
rules and allocations that the community can inspect.

A sponsor selects an existing RacesOn event and its existing races and sporting
classifications, chooses reward ratios, and saves a version of the rules. RacesOn
supplies sporting facts; sponsors control economics. The product supports race
and league prizes, athlete participation and club rewards. Walletless athletes
retain their shares.

Our current hosted demo covers five completed Šibenik trail league rounds in a
separate database. Athlete and club names are fictional; exact sporting times are
retained for verification. Judges can inspect source results, saved sponsor plans
and exact integer allocation calculations. One reviewed duplicate finish counts
only once in combined metrics, and entries without a club remain unaffiliated for
that race. Original results and category tables remain intact.

The complete rewards workflow separates sponsor contract creation, RacesOn-funded
creation gas, sponsor prize deposits, controller approval and athlete claims.
Monad contracts enforce escrow and claims; Privy supplies the wallet creation and
signing path. These later actions are not yet enabled in this hosted planning
release. Our final demonstration must prove them on the submitted version before
we describe them as completed.

RacesOn's registration, timing platform and some reused components predate this
entry. The submission concerns the rewards product and its integration. We will
provide the exact source revision and dated contribution evidence with the final
release. We do not claim a permissionless sporting oracle, real runner adoption,
an external security audit or mainnet readiness. Shared judge profiles and test
MON are demonstration tools.

### Go-to-market and user acquisition

Our first pilot targets one recurring local trail league, its active clubs and
one sponsor already interested in that community. We will offer a bounded rewards
campaign with clear eligibility, a visible allocation budget and an opt-in claim
journey. Existing league and club channels are the proposed route to participants;
we do not claim an agreed partnership or paid campaign.

The sponsor offer is a campaign whose rules, awards and settlement can be checked.
We will test whether that clarity helps sponsors renew and gives athletes and
clubs a useful participation incentive. Athletes should not need to buy tokens
or already own a wallet to earn an allocation.

The first pilot will measure sponsor setup completion, funded campaigns,
onboarding and claim completion, support requests and sponsor interest in
renewal. Demo logins and testnet transfers will remain separate from real users,
commercial revenue and retained customers. Pricing is a hypothesis to validate
with sponsors. Expansion to further events follows a reliable first campaign
and clear sporting, controller and support responsibilities.

### Privy answer — conditional draft, not ready to assert as hosted behavior

The existing Podium wallet integration uses Privy for explicit embedded-wallet
creation or selection and signing inside the reward journey, beyond ordinary
login. Wallet-control proof and award-specific recipient consent remain separate
from sporting eligibility and controller approval.

The final demonstration will show a test participant choosing a wallet, signing
for the exact award and inspecting a confirmed Monad testnet receipt. It must
also show cancellation without payment and duplicate-claim rejection. Privy is
not the sporting oracle, controller or operator gas source. Older local signing
and payment evidence will be labelled separately; it will not be presented as
fresh acceptance of the hosted five-round release.

Before pasting this answer, replace the second paragraph with the exact observed
deployed behavior, recording URL, source revision and verified receipt. Do not
claim recovery, MFA, smart accounts or provider gas sponsorship without evidence.

## Judge walkthrough for the current planning release

Credentials belong in the form's private access field, never in this document,
Git, videos or screenshots. Keep sponsor access separate from shared athlete
access; neither may grant controller or signing authority.

1. Open the canonical HTTPS demo and sign in with the separately supplied demo
   sponsor account. Open **Campaigns** and the saved **Committee demo · five rounds**.
2. Inspect revision 1, the 250 test MON plan and existing classifications. Preview
   allocations: four league awards of 37.5, 100 unallocated, zero payable.
3. Open **Club kilometres · review check**, revision 1. Preview 100 test MON across
   38 clubs with zero held and zero payable. Inspect the combined-result and
   per-race unaffiliated notes.
4. In the handoff release, use **Prepare review record**, then **Save review JSON**. Record the SHA-256
   displayed separately from the JSON. Verify locally with:

   ```sh
   node demo/rewards/hosted-copy/verify-handoff.mjs /path/to/private-record.json --expected-sha256 DIGEST_FROM_SPONSOR_VIEW
   ```

   This confirms integrity against that digest. It is not a controller signature,
   approval, entitlement activation or receipt. Editing a saved plan requires a
   new preview; an old revision cannot be downloaded as current.
5. Sign out and use a separately supplied athlete persona. Confirm results are
   readable and sponsor campaign controls are absent. Sign out after testing.

The next complete judge guide must add independently verified creation, funding,
Privy consent, claim/replay and receipt steps. Do not ask judges to infer those
steps from the current preview or use personal funds in shared demo wallets.

## Recording plan and missing assets

| Asset | Concrete preparation / remaining evidence |
| --- | --- |
| Technical video, ≤3 minutes | 0:00 problem/test identity; 0:15 existing event and sponsor rules; 0:45 real contract/deposit receipts; 1:10 allocation review; 1:40 Privy action and explicit claim; 2:30 verified receipt and replay denial; 2:50 source/access. Unavailable hosted actions must be completed before final capture. |
| Pitch, ≤2 minutes | Team introduction, community problem, athlete/club value, honest first-pilot plan. Owner supplies team identities, role and actual experience. |
| Privy video, optional ≤2 minutes | Wallet action, exact signature context, cancellation and successful claim on final environment. |
| Logo | Form requires PNG/JPG/WEBP ≤2 MB, at least 500 px, ≤4 million pixels. Use a rights-approved 1000×1000 asset. This stricter form limit supersedes the track page's 3 MB wording. |
| Community | Both bounties remain selected. The required onboarded Metropolis community name is blank; owner must identify their actual builder affiliation. No group is inferred from the running dataset. |
| Source link | infobitctrl/raceson-podium is public and now includes the actual Next.js application source. See release-readiness.md for build, data isolation and verification scope. |
| Support | Named operator, backup, contact and availability through judging still need confirmation. |

## Ordered release work

1. Finish and verify the portable allocation handoff (this task).
2. Complete the reviewed-allocation-to-contract flow in the isolated hosted
   environment, reusing existing reward layers. Prepare exact provider, gas,
   funding and test-recipient scopes before any separately gated action.
3. Demonstrate Privy wallet/signing, explicit consent, claim, replay rejection and
   confirmed receipt on that exact release. Existing payouts are not substitutes.
4. Finish the clean public-source candidate: rights/first-party license decision,
   third-party notices and media review, synthetic bootstrap, full source/secret
   and dependency review, fresh-checkout build/tests. Publish the approved
   candidate to the dedicated repository and verify unauthenticated readability.
5. Package logo and record/upload the real technical and pitch videos. Confirm
   community affiliation, contribution disclosure and private judge guide.
6. Review the complete existing entry, then perform its separately authorized
   final submission once and retain the acknowledgement. Do not reapply or change
   the chosen tracks.

The wider product inventory is a local review aid, not release approval. A passing
npm advisory check alone is not a completed security audit. Refer to this task's
verification record for exact source, environment and outstanding checks.
