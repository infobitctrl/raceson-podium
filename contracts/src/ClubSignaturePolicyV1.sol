// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IClubSignatureTreasuryV1 {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @dev Policy checks do not attest Safe bytecode or sporting membership. The
/// identity issuer pins the independently verified owners in Registry V2.
library ClubSignaturePolicyV1 {
    error InvalidClubPolicy();
    error TwoFreshOwnerSignaturesRequired();

    function owners(address treasury) internal view returns (address[] memory result) {
        if (treasury.code.length == 0) revert InvalidClubPolicy();
        if (IClubSignatureTreasuryV1(treasury).getThreshold() != 2) revert InvalidClubPolicy();
        result = IClubSignatureTreasuryV1(treasury).getOwners();
        if (result.length != 3) revert InvalidClubPolicy();
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (result[j] < result[i]) (result[i], result[j]) = (result[j], result[i]);
            }
        }
        if (result[0] <= address(1) || result[0] == result[1] || result[1] == result[2]) revert InvalidClubPolicy();
    }

    function ownersHash(address treasury) internal view returns (bytes32) {
        return keccak256(abi.encode(owners(treasury)));
    }

    /// @dev Exactly two canonical EIP-712 ECDSA signatures, sorted by signer.
    /// No Safe approved-hash, eth_sign, EIP-1271 or module authorization substitutes.
    /// EIP-7702 owners remain supported: signatures recover their underlying EOA.
    function verify(address treasury, bytes32 expectedOwnersHash, bytes32 digest, bytes calldata signatures)
        internal
        view
    {
        address[] memory roster = owners(treasury);
        if (expectedOwnersHash == bytes32(0) || keccak256(abi.encode(roster)) != expectedOwnersHash) {
            revert InvalidClubPolicy();
        }
        if (signatures.length != 130) revert TwoFreshOwnerSignaturesRequired();
        address previous;
        for (uint256 i; i < 2; ++i) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signatures[i * 65:(i + 1) * 65]);
            if (
                err != ECDSA.RecoverError.NoError || signer <= previous
                    || (signer != roster[0] && signer != roster[1] && signer != roster[2])
            ) {
                revert TwoFreshOwnerSignaturesRequired();
            }
            previous = signer;
        }
    }
}
