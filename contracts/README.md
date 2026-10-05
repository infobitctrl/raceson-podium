# Contract checks

Use Foundry 1.8.0, commit `61ae26af36320d4fa1020f7db53785885e29eeb5`, Solidity `0.8.36+commit.8a079791`, and forge-std 1.16.2 at `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b`. Obtain tools from their official releases and verify platform checksums.

```sh
npm ci --prefix contracts --ignore-scripts --no-audit --no-fund
forge install --root contracts foundry-rs/forge-std@rev=bf647bd6046f2f7da30d0c2bf435e5c76a780c1b --no-git
forge build --root contracts
npm run check:contracts
```

The check verifies tool/dependency versions, original Safe artifact hashes, formatting and offline EVM/Monad tests. It uses no public RPC, real signer or broadcast. A simulation is not a testnet payment or real athlete consent.

Database and chain integration tests expect the pinned `anvil` under `contracts/.toolchain/foundry-v1.8.0/anvil`; keep it outside Git. Put `forge` alongside it or on PATH. Build artifacts, dependency sources and tool caches are excluded from the release.
