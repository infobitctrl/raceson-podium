# Hosted copy and sponsor drafts

The isolated target is `niklhlmljiikwbkrmapw`. Its five-round copy, private
session-checked preview RPCs and 275 fresh Auth accounts are installed. The preview
is deployed at https://podium.raceson.com in the separate Vercel project
`raceson-podium`, under `veddoo-5600s-projects`.

The hosted entry is `/`; `/auth` and `/rewards/demo-copy` reach the same focused
login/results interface, using ordinary application Auth.
Login/logout/session refresh, account context, results, and sponsor-owned draft
template/list/read/save are enabled by `RACESON_REWARD_HOSTED_COPY_MODE=sponsor-drafts-v1`.
The earlier `preview-v1` mode remains read-only. Other routes,
including signup, password delivery, source publishing, wallets and payments,
are rejected. Keep the switch set until another reviewed product slice adds its
own permissions. Do not restore portal grants or reuse historical demo accounts.

Use `.env.example` as a configuration inventory, not a runnable deployment file.
Choose one concrete isolated HTTPS origin and set matching server/browser values.
Keep server keys out of all `NEXT_PUBLIC_*` variables and out of Git. Do not copy
the historical local app's environment. Do not add Privy/operator/relayer keys for
this planning slice. Existing local port 3102 and its database are unrelated.

Athlete usernames are `racesmon1` through `racesmon274`; sponsor username is
`podium.sponsor`. The shared athlete test password is generated and stored outside
source, with a different generated sponsor password. Internal `.invalid` Auth
emails are compatibility placeholders; no messages are sent to them. Never use
this binding as original athlete identity, age, consent or wallet evidence.
Public signup, anonymous login and manual identity linking are disabled in Auth.

## Build and release

`build.mjs` packages the existing Auth and results feature plus
`@raceson/api/rewards-demo` into Vercel Build Output API v3. It does not upload
the workspace or database. Pin/build dependencies with the root lockfile and
the separate esbuild lockfile here; compile the API first with `npm run api:check`.
Run the isolated bundler dependency install with
`npm ci --prefix demo/rewards/hosted-copy --workspaces=false` when needed.

Invoke `node demo/rewards/hosted-copy/build.mjs <fresh-workspace-tmp-directory>
https://podium.raceson.com <selected-project-publishable-key>`. Only the publishable
key enters the static bundle. Set the ten server variables from `.env.example`
as sensitive production environment variables on project
`prj_zRfHoxNJKJDQtOvbSIzjUgSwhbBW` / team `team_i5HAdgm9ScGP1ql20LPoduop`.
No other integration keys are needed. The host adapter also requires an explicit
hosted mode and Host header; it cannot silently enable the full portal.

Link only the fresh output directory to that exact project. `vercel link` can
create `.env.local` with an OIDC token; remove that task-owned generated file from
the artifact directory and never publish it. Use `vercel deploy --prebuilt --prod
--dry --json` to check the upload manifest, then scan every output file for secrets
and inspect any findings before deploying. Source maps, SQL, database exports,
private records and local env files are not part of this output. Keep source
inventories and evidence outside the upload directory. Do not publish this entire
working directory or substitute a normal source deployment command.

After deployment, verify ordinary browser login, reload, account switching and
logout, exact counts, source review holds, denied mutations and session revocation
at the actual origin. The verified release is documented in
`docs/delivery/rewards-hackathon/hosted-deployment-20261005.md`.
Sponsor economics now save through a narrow copy-bound wrapper around the V5
revision store. Official category identities and the draft-only state cannot be
edited. Controller review, contract creation, funding and explicit testnet claims
remain later integration steps. The owner's Round 3 Long / Races Club29 selection
and 196 per-race unaffiliated decisions now resolve the combined/club preview holds.

Saved allocations expose a sponsor-only read endpoint ending in
`/allocation/:revision/handoff`. The downloadable JSON binds saved economics,
source hashes, both reviewed decision sets and exact decimal-string amounts.
It remains unapproved with zero payable and contains no wallet, signature or
controller authority. The UI displays its SHA-256 separately. To check integrity:

```sh
node demo/rewards/hosted-copy/verify-handoff.mjs /path/to/private-record.json --expected-sha256 DIGEST_FROM_SPONSOR_VIEW
```

A matching checksum identifies content; it is not an attestation. Keep exact-copy
review files private. Public-source examples must use fully synthetic results.
