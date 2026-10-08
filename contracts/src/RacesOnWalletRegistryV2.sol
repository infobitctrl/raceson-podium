// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ClubSignaturePolicyV1} from "./ClubSignaturePolicyV1.sol";

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRegisteredRewardClaimV6 {
    function walletRegistry() external view returns (address);
    function claimFromRegistry(bytes32 entitlementId, address recipient) external;
}

/// @notice Account-to-wallet binding, independent of reward approval and prize amounts.
/// @dev The immutable platform issuer attests authenticated account/profile ownership.
/// A wallet is never created here. Registration is an explicit wallet transaction.
/// Beneficiary IDs are random opaque references, never hashes of personal data.
contract RacesOnWalletRegistryV2 is EIP712, ReentrancyGuard {
    struct Binding {
        bytes32 beneficiaryId;
        address recipient;
        uint8 beneficiaryKind;
        uint256 nonce;
        uint64 issuedAt;
        uint64 expiresAt;
        bytes32 clubOwnersHash;
    }

    struct Registration {
        address recipient;
        uint8 beneficiaryKind;
        uint256 nonce;
        bytes32 clubOwnersHash;
    }

    bytes32 public constant BINDING_TYPEHASH = keccak256(
        "WalletBinding(bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 clubOwnersHash)"
    );
    address public immutable identityIssuer;
    mapping(bytes32 => Registration) public registrations;

    error UnsupportedChain();
    error InvalidBinding();
    error InvalidIdentityProof();
    error RecipientRequired();
    event WalletRegistered(
        bytes32 indexed beneficiaryId, address indexed recipient, uint8 beneficiaryKind, uint256 nonce
    );

    constructor(address identityIssuer_) EIP712("RacesOnWalletRegistry", "2") {
        if (block.chainid != 10143 && block.chainid != 31337) revert UnsupportedChain();
        if (identityIssuer_ == address(0) || identityIssuer_ == address(this)) revert InvalidBinding();
        identityIssuer = identityIssuer_;
    }

    function bindingDigest(Binding calldata b) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BINDING_TYPEHASH,
                    b.beneficiaryId,
                    b.recipient,
                    b.beneficiaryKind,
                    b.nonce,
                    b.issuedAt,
                    b.expiresAt,
                    b.clubOwnersHash
                )
            )
        );
    }

    /// @notice The selected wallet registers itself using its platform identity proof.
    /// @dev A Safe invokes this through its ordinary threshold-authorized transaction.
    /// Replacement needs a fresh account proof and a transaction by the new wallet.
    function register(Binding calldata b, bytes calldata identityProof) external nonReentrant {
        _register(b, identityProof);
    }

    /// @notice The athlete's explicit claim can register the wallet and collect
    /// an award atomically. A failed payment also rolls back the registration.
    function registerAndClaim(Binding calldata b, bytes calldata identityProof, address campaign, bytes32 entitlementId)
        external
        nonReentrant
    {
        if (campaign.code.length == 0 || IRegisteredRewardClaimV6(campaign).walletRegistry() != address(this)) {
            revert InvalidBinding();
        }
        _register(b, identityProof);
        IRegisteredRewardClaimV6(campaign).claimFromRegistry(entitlementId, msg.sender);
    }

    function _register(Binding calldata b, bytes calldata identityProof) private {
        if (msg.sender != b.recipient) revert RecipientRequired();
        Registration storage current = registrations[b.beneficiaryId];
        if (
            b.beneficiaryId == bytes32(0) || b.recipient == address(0) || b.recipient == address(this)
                || b.beneficiaryKind > 1 || b.nonce != current.nonce
                || (current.nonce != 0 && current.beneficiaryKind != b.beneficiaryKind) || b.issuedAt > block.timestamp
                || b.expiresAt <= block.timestamp || b.expiresAt <= b.issuedAt
                || uint256(b.expiresAt) - b.issuedAt > 1 days
        ) revert InvalidBinding();
        if (!SignatureChecker.isValidSignatureNow(identityIssuer, bindingDigest(b), identityProof)) {
            revert InvalidIdentityProof();
        }
        if (b.beneficiaryKind == 1) {
            if (b.clubOwnersHash == bytes32(0) || ClubSignaturePolicyV1.ownersHash(b.recipient) != b.clubOwnersHash) {
                revert InvalidBinding();
            }
        } else if (b.clubOwnersHash != bytes32(0)) {
            revert InvalidBinding();
        }
        current.clubOwnersHash = b.clubOwnersHash;
        current.recipient = b.recipient;
        current.beneficiaryKind = b.beneficiaryKind;
        current.nonce++;
        emit WalletRegistered(b.beneficiaryId, b.recipient, b.beneficiaryKind, current.nonce);
    }

    /// @notice Registration generation retires signatures even if the same
    /// treasury and owner set are registered again later.
    function clubPolicyOf(bytes32 beneficiaryId) external view returns (bytes32 ownersHash, uint256 nonce) {
        Registration storage current = registrations[beneficiaryId];
        return (current.clubOwnersHash, current.nonce);
    }

    function recipientOf(bytes32 beneficiaryId, uint8 beneficiaryKind) external view returns (address) {
        Registration storage current = registrations[beneficiaryId];
        return current.beneficiaryKind == beneficiaryKind ? current.recipient : address(0);
    }
}
