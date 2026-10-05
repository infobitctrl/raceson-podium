// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IClubRewardTreasury {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @notice Native-test-MON escrow for one race or one league epoch, never an athlete wallet.
/// @dev Sporting evidence and profile/club authority are trusted off-chain operator attestations.
///      Opaque beneficiary IDs must NOT be public profile IDs or hashes of personal information.
contract RacesOnRewardCampaign is EIP712, ReentrancyGuard {
    enum State {
        Funding,
        Review,
        Staged,
        Active,
        Closed,
        Cancelled
    }

    struct AwardInput {
        bytes32 entitlementId;
        bytes32 beneficiaryId;
        uint8 pot;
        uint256 amount;
        bytes32 explanationHash;
        uint8 beneficiaryKind; // 0 = athlete, 1 = club; no public identity mapping.
    }

    struct Entitlement {
        bytes32 beneficiaryId;
        uint256 amount;
        bytes32 explanationHash;
        uint256 authorizationNonce;
        address recipient;
        uint8 pot;
        bool paid;
        uint8 beneficiaryKind;
    }

    uint256 public constant CLAIM_LIFETIME = 365 days;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 1 days;
    uint256 public constant ALLOCATION_REVIEW_PERIOD = 1 days;
    uint256 public constant PUBLICATION_REVIEW_PERIOD = 3 days;
    uint256 public constant MAX_UPLOAD_BATCH = 64;
    bytes32 public constant CLAIM_AUTHORIZATION_TYPEHASH = keccak256(
        "ClaimAuthorization(bytes32 entitlementId,address recipient,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest)"
    );
    bytes32 public constant RECEIVE_REWARD_TYPEHASH = keccak256(
        "ReceiveReward(bytes32 entitlementId,address recipient,uint256 amount,uint8 pot,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest)"
    );

    address public immutable operator;
    address payable public immutable treasury;
    bytes32 public immutable programmeId;
    bytes32 public immutable campaignId;
    bytes32 public immutable programmeManifestHash;
    uint8 public immutable enabledPot; // 0 = race, 1 = league; no mixing in a campaign.

    State public state;
    uint256 public accountedFunding;
    uint256 public treasuryReturned;
    uint256[2] public budgets;
    uint256[2] public allocated;
    uint256[2] public paid;
    mapping(bytes32 => Entitlement) public entitlements;
    mapping(bytes32 => bool) public beneficiaryAllocated;
    bytes32 public lastEntitlementId;
    bytes32 public uploadDigest;
    uint256 public entitlementCount;
    bytes32 public snapshotDigest;
    bytes32 public allocationDigest;
    uint256 public activationNotBefore;
    uint256 public claimDeadline;
    bool public paused;
    uint256 public pausedAt;

    error UnsupportedChain();
    error InvalidConfiguration();
    error Unauthorized();
    error WrongState();
    error InvalidFunding();
    error InvalidAward();
    error DuplicateBeneficiary();
    error BudgetExceeded();
    error InvalidReview();
    error ReviewNotFinished();
    error ClaimsUnavailable();
    error UnknownOrPaidEntitlement();
    error InvalidNonce();
    error InvalidAuthorizationTime();
    error InvalidOperatorSignature();
    error InvalidRecipientSignature();
    error InvalidClubTreasury();
    error TransferFailed();
    error NothingToReturn();

    event Funded(address indexed funder, uint256 amount, uint256 total);
    event FundingClosed(uint8 indexed pot, uint256 budget);
    event AwardUploaded(
        bytes32 indexed entitlementId,
        bytes32 indexed beneficiaryId,
        uint8 indexed pot,
        uint256 amount,
        bytes32 explanationHash,
        uint8 beneficiaryKind
    );
    event AllocationStaged(
        bytes32 indexed allocationDigest, bytes32 indexed snapshotDigest, uint256 count, uint256 activationNotBefore
    );
    event Activated(bytes32 indexed allocationDigest, uint256 claimDeadline);
    event RewardPaid(
        bytes32 indexed entitlementId, address indexed recipient, uint8 indexed pot, uint256 amount, uint256 nonce
    );
    event AuthorizationRevoked(bytes32 indexed entitlementId, uint256 newNonce);
    event Paused(uint256 pausedAt);
    event Resumed(uint256 pauseDuration, uint256 claimDeadline);
    event Closed();
    event Cancelled();
    event TreasuryReturned(address indexed treasury, uint256 amount);
    event SurplusReturned(address indexed treasury, uint256 amount);

    constructor(
        address operator_,
        address payable treasury_,
        bytes32 programmeId_,
        bytes32 campaignId_,
        bytes32 programmeManifestHash_,
        uint8 enabledPot_
    ) EIP712("RacesOnRewardCampaign", "2") {
        if (block.chainid != 10143 && block.chainid != 31337) revert UnsupportedChain();
        if (
            operator_ == address(0) || treasury_ == address(0) || programmeId_ == bytes32(0)
                || campaignId_ == bytes32(0) || programmeManifestHash_ == bytes32(0) || enabledPot_ > 1
        ) {
            revert InvalidConfiguration();
        }
        operator = operator_;
        treasury = treasury_;
        programmeId = programmeId_;
        campaignId = campaignId_;
        programmeManifestHash = programmeManifestHash_;
        enabledPot = enabledPot_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier inState(State requiredState) {
        if (state != requiredState) revert WrongState();
        _;
    }

    /// @dev Explicit deposits only; forced transfers never change accountedFunding.
    ///      The operator/treasury accepts fixed-treasury return terms for these test tokens.
    function fund() external payable nonReentrant inState(State.Funding) {
        if (msg.sender != treasury && msg.sender != operator) revert Unauthorized();
        if (msg.value == 0) revert InvalidFunding();
        accountedFunding += msg.value;
        emit Funded(msg.sender, msg.value, accountedFunding);
    }

    function closeFunding() external nonReentrant onlyOperator inState(State.Funding) {
        if (accountedFunding == 0) revert InvalidFunding();
        budgets[enabledPot] = accountedFunding;
        state = State.Review;
        emit FundingClosed(enabledPot, accountedFunding);
    }

    /// @notice Atomically deposit the exact remainder and freeze the operator-signed budget.
    /// @dev A competing explicit deposit invalidates the expected pre-state instead of
    ///      overfunding. Forced MON stays surplus. Zero-value closure is valid only when
    ///      explicit deposits already equal the positive expected budget. Programme
    ///      budget approval remains off-chain; these arguments are bound by the transaction.
    function completeFunding(uint256 expectedAccountedFunding, uint256 expectedBudget)
        external
        payable
        nonReentrant
        onlyOperator
        inState(State.Funding)
    {
        if (
            expectedBudget == 0 || accountedFunding != expectedAccountedFunding
                || expectedAccountedFunding > expectedBudget || msg.value != expectedBudget - expectedAccountedFunding
        ) revert InvalidFunding();
        accountedFunding = expectedBudget;
        budgets[enabledPot] = expectedBudget;
        state = State.Review;
        if (msg.value != 0) emit Funded(msg.sender, msg.value, expectedBudget);
        emit FundingClosed(enabledPot, expectedBudget);
    }

    /// @notice Append fixed awards in globally ascending opaque entitlement-ID order.
    /// @dev Cancel/rebuild an incorrect review; no edits, replacement IDs or silent deletions.
    function uploadAwards(AwardInput[] calldata awards) external nonReentrant onlyOperator inState(State.Review) {
        if (awards.length == 0 || awards.length > MAX_UPLOAD_BATCH) revert InvalidAward();
        for (uint256 i = 0; i < awards.length; i++) {
            AwardInput calldata award = awards[i];
            if (
                award.entitlementId <= lastEntitlementId || award.beneficiaryId == bytes32(0) || award.pot != enabledPot
                    || award.amount == 0 || award.explanationHash == bytes32(0) || award.beneficiaryKind > 1
            ) {
                revert InvalidAward();
            }
            if (beneficiaryAllocated[award.beneficiaryId]) revert DuplicateBeneficiary();
            uint256 remaining = budgets[enabledPot] - allocated[enabledPot];
            if (award.amount > remaining) revert BudgetExceeded();
            allocated[enabledPot] += award.amount;
            beneficiaryAllocated[award.beneficiaryId] = true;
            entitlements[award.entitlementId] = Entitlement({
                beneficiaryId: award.beneficiaryId,
                amount: award.amount,
                explanationHash: award.explanationHash,
                authorizationNonce: 0,
                recipient: address(0),
                pot: award.pot,
                paid: false,
                beneficiaryKind: award.beneficiaryKind
            });
            lastEntitlementId = award.entitlementId;
            uploadDigest = keccak256(abi.encode(uploadDigest, award));
            entitlementCount++;
            emit AwardUploaded(
                award.entitlementId,
                award.beneficiaryId,
                award.pot,
                award.amount,
                award.explanationHash,
                award.beneficiaryKind
            );
        }
    }

    /// @param latestPublicationAt Latest relevant publication/correction timestamp, attested by the operator.
    function stageAllocation(
        bytes32 snapshotDigest_,
        bytes32 expectedUploadDigest,
        uint256 expectedCount,
        uint64 latestPublicationAt
    ) external nonReentrant onlyOperator inState(State.Review) {
        if (
            snapshotDigest_ == bytes32(0) || expectedUploadDigest != uploadDigest || expectedCount != entitlementCount
                || latestPublicationAt == 0 || latestPublicationAt > block.timestamp
        ) revert InvalidReview();
        snapshotDigest = snapshotDigest_;
        allocationDigest = keccak256(
            abi.encode(
                programmeId,
                campaignId,
                programmeManifestHash,
                snapshotDigest_,
                enabledPot,
                budgets,
                allocated,
                uploadDigest,
                entitlementCount,
                latestPublicationAt
            )
        );
        uint256 publicationReadyAt = uint256(latestPublicationAt) + PUBLICATION_REVIEW_PERIOD;
        uint256 allocationReadyAt = block.timestamp + ALLOCATION_REVIEW_PERIOD;
        activationNotBefore = publicationReadyAt > allocationReadyAt ? publicationReadyAt : allocationReadyAt;
        state = State.Staged;
        emit AllocationStaged(allocationDigest, snapshotDigest_, entitlementCount, activationNotBefore);
    }

    /// @dev The operator must re-extract/review current sources before submitting these digests.
    ///      Equality binds its attestation; the contract cannot inspect the RacesOn database.
    function activate(bytes32 expectedAllocationDigest, bytes32 revalidatedSnapshotDigest)
        external
        nonReentrant
        onlyOperator
        inState(State.Staged)
    {
        if (expectedAllocationDigest != allocationDigest || revalidatedSnapshotDigest != snapshotDigest) {
            revert InvalidReview();
        }
        if (block.timestamp < activationNotBefore) revert ReviewNotFinished();
        claimDeadline = block.timestamp + CLAIM_LIFETIME;
        state = State.Active;
        emit Activated(allocationDigest, claimDeadline);
    }

    function claim(
        bytes32 entitlementId,
        address payable recipient,
        uint256 nonce,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes calldata operatorSignature,
        bytes calldata recipientSignature
    ) external nonReentrant {
        _requireClaimsAvailable();
        Entitlement storage award = entitlements[entitlementId];
        if (award.amount == 0 || award.paid) revert UnknownOrPaidEntitlement();
        if (recipient == address(0)) revert InvalidRecipientSignature();
        if (award.beneficiaryKind == 1) _requireClubTreasury(recipient);
        if (nonce != award.authorizationNonce) revert InvalidNonce();
        if (
            issuedAt > block.timestamp || expiresAt <= block.timestamp || expiresAt <= issuedAt
                || uint256(expiresAt) - uint256(issuedAt) > MAX_AUTHORIZATION_LIFETIME
        ) revert InvalidAuthorizationTime();
        (bytes32 approvalHash, bytes32 receiptHash) = claimDigests(entitlementId, recipient, nonce, issuedAt, expiresAt);
        if (!SignatureChecker.isValidSignatureNow(operator, approvalHash, operatorSignature)) {
            revert InvalidOperatorSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(recipient, receiptHash, recipientSignature)) {
            revert InvalidRecipientSignature();
        }

        award.paid = true;
        award.authorizationNonce++;
        award.recipient = recipient;
        paid[award.pot] += award.amount;
        emit RewardPaid(entitlementId, recipient, award.pot, award.amount, nonce);
        _transfer(recipient, award.amount);
    }

    function claimDigests(bytes32 entitlementId, address recipient, uint256 nonce, uint64 issuedAt, uint64 expiresAt)
        public
        view
        returns (bytes32 approvalHash, bytes32 receiptHash)
    {
        Entitlement storage award = entitlements[entitlementId];
        if (award.amount == 0) revert UnknownOrPaidEntitlement();
        approvalHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_AUTHORIZATION_TYPEHASH, entitlementId, recipient, nonce, issuedAt, expiresAt, allocationDigest
                )
            )
        );
        receiptHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECEIVE_REWARD_TYPEHASH,
                    entitlementId,
                    recipient,
                    award.amount,
                    award.pot,
                    nonce,
                    issuedAt,
                    expiresAt,
                    allocationDigest
                )
            )
        );
    }

    /// @notice Invalidates outstanding unused proofs; a concurrently executed valid claim can win first.
    function revokeAuthorization(bytes32 entitlementId) external nonReentrant onlyOperator inState(State.Active) {
        Entitlement storage award = entitlements[entitlementId];
        if (award.amount == 0 || award.paid) revert UnknownOrPaidEntitlement();
        award.authorizationNonce++;
        emit AuthorizationRevoked(entitlementId, award.authorizationNonce);
    }

    function pause() external nonReentrant onlyOperator {
        _requireClaimsAvailable();
        paused = true;
        pausedAt = block.timestamp;
        emit Paused(pausedAt);
    }

    function resume() external nonReentrant onlyOperator inState(State.Active) {
        if (!paused) revert ClaimsUnavailable();
        uint256 duration = block.timestamp - pausedAt;
        claimDeadline += duration;
        paused = false;
        pausedAt = 0;
        emit Resumed(duration, claimDeadline);
    }

    function close() external nonReentrant onlyOperator inState(State.Active) {
        if (paused || block.timestamp < claimDeadline) revert ClaimsUnavailable();
        state = State.Closed;
        emit Closed();
    }

    function cancel() external nonReentrant onlyOperator {
        if (state != State.Funding && state != State.Review && state != State.Staged) revert WrongState();
        state = State.Cancelled;
        emit Cancelled();
    }

    /// @notice Pull-style return only to the immutable treasury, only after cancellation/expiry.
    /// @dev Even unallocated funds are retained until this terminal state; no active outflow shortcut.
    function returnToTreasury() external nonReentrant onlyOperator {
        _requireReturnAllowed();
        uint256 amount = accountedFunding - paid[0] - paid[1] - treasuryReturned;
        if (amount == 0) revert NothingToReturn();
        treasuryReturned += amount;
        emit TreasuryReturned(treasury, amount);
        _transfer(treasury, amount);
    }

    function returnSurplus() external nonReentrant onlyOperator {
        _requireReturnAllowed();
        uint256 reserved = accountedFunding - paid[0] - paid[1] - treasuryReturned;
        uint256 amount = address(this).balance - reserved;
        if (amount == 0) revert NothingToReturn();
        emit SurplusReturned(treasury, amount);
        _transfer(treasury, amount);
    }

    function _requireClaimsAvailable() private view {
        if (state != State.Active || paused || block.timestamp >= claimDeadline) revert ClaimsUnavailable();
    }

    /// @dev Prevent a previously approved club Safe from weakening to 1-of-N before execution.
    ///      This is NOT Safe bytecode/ownership attestation: the operator service must also
    ///      verify the actual proxy, singleton, fallback handler and represented club authority.
    function _requireClubTreasury(address recipient) private view {
        if (recipient.code.length == 0) revert InvalidClubTreasury();
        try IClubRewardTreasury(recipient).getThreshold() returns (uint256 threshold) {
            if (threshold != 2) revert InvalidClubTreasury();
        } catch {
            revert InvalidClubTreasury();
        }
        try IClubRewardTreasury(recipient).getOwners() returns (address[] memory owners) {
            if (owners.length != 3) revert InvalidClubTreasury();
        } catch {
            revert InvalidClubTreasury();
        }
    }

    function _requireReturnAllowed() private view {
        if (paused || (state != State.Cancelled && state != State.Closed)) revert ClaimsUnavailable();
    }

    function _transfer(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
