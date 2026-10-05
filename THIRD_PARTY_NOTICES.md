# Third-party material

Existing file-level notices and SPDX identifiers are retained. The compatibility copies under `vendor/security` include their upstream licenses and regression tests. Dependencies are installed from the committed lockfiles and retain their own notices; this repository does not relicense them.

Contract dependencies include OpenZeppelin (MIT), Safe contracts (LGPL-3.0), and forge-std (MIT/Apache-2.0). Their source and tool caches are installed separately and are not included in Git. See `contracts/package-lock.json` and `contracts/README.md` for exact pins. Safe artifacts are used unchanged and checked by hash.

The application retains the project's existing artwork and brand assets. Package, font, image and trademark rights remain with their respective owners. No blanket license for these assets is implied by the repository's visibility or by a first-party source file's SPDX identifier.
