# Security

This is an isolated testnet demonstration. Shared test accounts do not establish real athlete ownership or consent. No production security or funds-safety certification is claimed.

Do not include passwords, API secrets, seeds, private keys, signed private payloads, Auth exports, database dumps, source-to-alias mappings or real participant contact data in Git, issues or pull requests. Exact historical race times can remain linkable even after names are replaced. Public test fixtures must use invented identities.

Keep suspected vulnerabilities confidential. Use GitHub private vulnerability reporting when available, or an existing private contact with the repository owner. Do not publish exploit details in a public issue.

The 5 October source release received locked dependency audits, secret and known-credential comparisons, focused source review of hosted authentication/ownership/isolation/payment boundaries, regression tests and a clean Next.js build. Seventeen secret-pattern alerts were inspected and were test idempotency constants or ordinary enum/localization text. No actual secret was identified in the reviewed export.

The source review is partial: it does not certify every copied compatibility file or provide a deployed penetration test. Hosted money/provider actions are blocked by an explicit method/path allowlist. Database source projections are server-only and bound to the isolated five-round copy. Sponsor writes recheck live sessions, ownership, source fingerprint, canonical structure and saved revision.

Supabase advisory review reported deliberately closed RLS tables without client policies, and disabled leaked-password checking on the free demo project. Closed signup and separately provisioned test identities remain in place. See [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
