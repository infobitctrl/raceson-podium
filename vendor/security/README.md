# Reviewed dependency compatibility patches

These private local packages replace two vulnerable transitive dependencies.
The root manifest declares each file dependency and uses an npm `$dependency`
override so every consumer resolves the same copy. They are checked-in source,
not postinstall patches; `npm ci --ignore-scripts` must still install the fixes.
Keep this directory in any product source export. Do not publish these packages
to npm or claim they are upstream releases.

| Local package | Upstream source | Change |
| --- | --- | --- |
| `@raceson/braces` | `braces` 3.0.3, MIT | A fixed limit of 128 nested AST containers at parser entry and every recursive walker entry, including direct AST/library APIs. Excess depth throws `SyntaxError` with `ERR_BRACES_DEPTH`; callers must handle invalid patterns as before. Escaped, quoted and bracketed literal braces do not consume depth. |
| `@raceson/decode-uri-component` | `decode-uri-component` 0.5.0, MIT | Preserve the upstream fixed decoding algorithm, export its function through CommonJS, and retain the former 0.2.x `+`-to-space behavior expected by query-string 7. |

Each package retains its upstream license and source provenance in `UPSTREAM.json`.
The brace copy changes only parse/compile/expand/stringify plus the new depth
helper. The decoder algorithm is unchanged from 0.5.0. Local versions and scoped
names distinguish our maintained copies from upstream packages; registry audit
tools cannot certify these copies. No advisory is suppressed and no clean audit
is a substitute for the regression checks.

Run `npm ci --ignore-scripts` then `npm run check:dependencies`. Tests verify the
actual consumer resolution, nested/cyclic AST rejection, ordinary expansion,
legacy decoding, malformed query keys/values/fragments with a subprocess timeout,
and actual WalletConnect URI parsing. The normal wallet suite and demo production
build are additional release checks. The running developer installation must be
reinstalled separately before it uses these source changes.

References:

- [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [Decoder advisory and upstream fix](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr)

Remove a local replacement only after a compatible upstream release resolves its
advisory and passes these consumer and build checks. This work does not certify
unrelated expansion-volume limits, the complete dependency graph, or hosted
Privy sign-in and consent.
