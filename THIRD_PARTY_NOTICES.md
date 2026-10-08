# Third-party material

First-party Podium software and developer documentation are covered by the root [MIT License](LICENSE), subject to [license scope](LICENSE-STATUS.md). Existing file-level notices and SPDX identifiers are retained. The compatibility copies under `vendor/security` include their upstream licenses and regression tests. Dependencies are installed from the committed lockfiles and retain their own notices; this repository does not relicense them.

Contract dependencies include OpenZeppelin (MIT), Safe contracts (LGPL-3.0), and forge-std (MIT/Apache-2.0). Their source and tool caches are installed separately and are not included in Git. See `contracts/package-lock.json` and `contracts/README.md` for exact pins. Safe artifacts are used unchanged and checked by hash.

The application retains the project's existing artwork and brand assets. Package, font, image and trademark rights remain with their respective owners. The MIT software grant does not relicense these assets or grant trademark rights.

## Additional dependency declarations

The committed application lockfile contains dependencies with licenses other than MIT. Examples include `react-leaflet` 4.2.1 and `@react-leaflet/core` 2.1.0 (Hippocratic-2.1), `caniuse-lite` (CC-BY-4.0), and dependencies/components under MPL-2.0 or LGPL terms. These declarations describe the locked dependency graph, not a claim that every dependency is included in every deployed browser bundle. The root MIT license does not replace their terms or certify the entire dependency graph as OSI-licensed.

Vendored `braces` and `decode-uri-component` copies retain their original MIT license files under `vendor/security`. Safe/OpenZeppelin sources and artifacts are installed using the pinned contract dependencies; their original notices and corresponding source remain available through those packages. Keep those materials when redistributing the relevant third-party code or artifacts.

## Reused project foundation

First-party sporting and shared application components originated in the pre-existing RacesOn platform. Their reuse and the dated Podium additions are described in [hackathon contributions](docs/hackathon-contributions.md). A repository import is not a claim of new authorship for those components.
