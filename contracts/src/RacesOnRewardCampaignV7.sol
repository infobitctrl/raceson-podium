// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnWalletRegistryV3} from "./RacesOnWalletRegistryV3.sol";

import {ClubSignaturePolicyV1} from "./ClubSignaturePolicyV1.sol";

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Native-test-MON escrow for one race or one league epoch, never an athlete wallet.
/// @dev The reviewer approves sporting awards once. The separate wallet registry binds identity later.
///      Opaque beneficiary IDs must NOT be public profile IDs or hashes of personal information.
contract RacesOnRewardCampaignV7 is EIP712, ReentrancyGuard {
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

    uint256 public immutable CLAIM_LIFETIME;
    address public immutable fundingSource;
    address payable public immutable expiredTreasury;
    address payable public immutable cancellationTreasury;
    uint256 public unallocatedReturned;
    uint256 public expiredReturned;
    uint256 public constant MAX_AUTHORIZATION_LIFETIME = 1 days;
    uint256 public constant MAX_CLUB_AUTHORIZATION_LIFETIME = 2 days;
    // An organizer's announced policy is fixed before this campaign accepts funding.
    // Zero explicitly means official publication without a timed complaint window.
    uint256 public immutable reviewPeriod;
    uint256 public constant PROTOCOL_VERSION = 6;
    uint256 public constant MAX_UPLOAD_BATCH = 64;
    bytes32 public constant RECEIVE_REWARD_TYPEHASH = keccak256(
        "ReceiveReward(bytes32 entitlementId,address recipient,uint256 amount,uint8 pot,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest)"
    );

    bytes32 public constant RECEIVE_CLUB_REWARD_TYPEHASH = keccak256(
        "ReceiveClubReward(bytes32 entitlementId,address recipient,uint256 amount,uint8 pot,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest,bytes32 clubOwnersHash,uint256 registrationNonce)"
    );

    address public immutable operator;
    RacesOnWalletRegistryV3 public immutable walletRegistry;
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
    uint256 public reviewStartedAt;
    uint256 public officialPublishedAt;
    bytes32 public publicationEvidenceHash;
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
    error InvalidRecipientSignature();
    error InvalidClubTreasury();
    error ClubOwnerSignaturesRequired();
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
    event FinalResultsApproved(
        bytes32 indexed allocationDigest,
        bytes32 indexed publicationEvidenceHash,
        uint256 reviewStartedAt,
        uint256 reviewPeriod,
        uint256 officialPublishedAt,
        uint256 approvedAt
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
        uint8 enabledPot_,
        uint64 reviewPeriod_,
        uint64 claimLifetime_,
        address fundingSource_,
        address payable expiredTreasury_,
        address payable cancellationTreasury_,
        address walletRegistry_
    ) EIP712("RacesOnRewardCampaign", "8") {
        if (block.chainid != 10143 && block.chainid != 31337) {
            revert UnsupportedChain();
        }
        if (
            walletRegistry_.code.length == 0 || operator_ == address(0) || treasury_ == address(0)
                || programmeId_ == bytes32(0) || fundingSource_ == address(0) || expiredTreasury_ == address(0)
                || cancellationTreasury_ == address(0) || claimLifetime_ < 1 days || claimLifetime_ > 3650 days
                || reviewPeriod_ > 365 days || campaignId_ == bytes32(0) || programmeManifestHash_ == bytes32(0)
                || enabledPot_ > 1
        ) {
            revert InvalidConfiguration();
        }
        operator = operator_;
        walletRegistry = RacesOnWalletRegistryV3(walletRegistry_);
        treasury = treasury_;
        programmeId = programmeId_;
        campaignId = campaignId_;
        programmeManifestHash = programmeManifestHash_;
        enabledPot = enabledPot_;
        reviewPeriod = reviewPeriod_;
        CLAIM_LIFETIME = claimLifetime_;
        fundingSource = fundingSource_;
        expiredTreasury = expiredTreasury_;
        cancellationTreasury = cancellationTreasury_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    modifier onlyFundingSource() {
        if (msg.sender != fundingSource) revert Unauthorized();
        _;
    }

    modifier inState(State requiredState) {
        if (state != requiredState) revert WrongState();
        _;
    }

    /// @dev Explicit deposits only; forced transfers never change accountedFunding.
    ///      The operator/treasury accepts fixed-treasury return terms for these test tokens.
    function fund() external payable nonReentrant inState(State.Funding) {
        if (msg.sender != fundingSource) revert Unauthorized();
        if (msg.value == 0) revert InvalidFunding();
        accountedFunding += msg.value;
        emit Funded(msg.sender, msg.value, accountedFunding);
    }

    function closeFunding() external nonReentrant onlyFundingSource inState(State.Funding) {
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
        onlyFundingSource
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

    /// @notice Approve the exact rewards against officially published final results.
    /// @dev This is the operator's attestation of the platform's completed complaint
    ///      process, NOT proof that the chain observed the publication or complaints.
    ///      Timestamps must come from authenticated, immutable server evidence, never
    ///      browser input. Historical final results need new allocation approval here,
    ///      but do not acquire another complaint window merely because they are imported.
    ///      A correction requires cancellation/rebuild before activation, not edits.
    /// @param reviewStartedAt_ Platform start of the announced complaint window.
    /// @param officialPublishedAt_ Final publication after that window was completed.
    /// @param publicationEvidenceHash_ Opaque commitment to the exact final publication
    ///      and approval evidence. Must not contain personal information.
    function stageAllocation(
        bytes32 snapshotDigest_,
        bytes32 expectedUploadDigest,
        uint256 expectedCount,
        uint64 reviewStartedAt_,
        uint64 officialPublishedAt_,
        bytes32 publicationEvidenceHash_
    ) external nonReentrant onlyOperator inState(State.Review) {
        if (
            snapshotDigest_ == bytes32(0) || expectedUploadDigest != uploadDigest || expectedCount != entitlementCount
                || publicationEvidenceHash_ == bytes32(0) || reviewStartedAt_ == 0
                || officialPublishedAt_ > block.timestamp
                || uint256(officialPublishedAt_) < uint256(reviewStartedAt_) + reviewPeriod
        ) revert InvalidReview();
        snapshotDigest = snapshotDigest_;
        reviewStartedAt = reviewStartedAt_;
        officialPublishedAt = officialPublishedAt_;
        publicationEvidenceHash = publicationEvidenceHash_;
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
                reviewPeriod,
                CLAIM_LIFETIME,
                treasury,
                expiredTreasury,
                cancellationTreasury,
                reviewStartedAt_,
                officialPublishedAt_,
                publicationEvidenceHash_,
                address(walletRegistry)
            )
        );
        // Official publication AND approval of this complete allocation are now present.
        // Activation requires a fresh operator revalidation but adds no automatic delay.
        activationNotBefore = block.timestamp;
        state = State.Staged;
        emit AllocationStaged(allocationDigest, snapshotDigest_, entitlementCount, activationNotBefore);
        emit FinalResultsApproved(
            allocationDigest,
            publicationEvidenceHash_,
            reviewStartedAt_,
            reviewPeriod,
            officialPublishedAt_,
            block.timestamp
        );
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

    /// @notice Claim an athlete award from the registered recipient wallet.
    /// No reviewer, operator or sponsor authorization is involved after activation.
    function claimDirect(bytes32 entitlementId) external nonReentrant {
        _requireClaimsAvailable();
        Entitlement storage award = entitlements[entitlementId];
        address payable recipient = _recipient(award);
        if (award.beneficiaryKind == 1) revert ClubOwnerSignaturesRequired();
        if (msg.sender != recipient) revert InvalidRecipientSignature();
        _pay(entitlementId, award, recipient);
    }

    /// @dev Only the immutable registry may forward an athlete's explicit
    /// register-and-claim transaction. The published beneficiary still determines
    /// the destination; callers cannot select someone else's award or wallet.
    function claimFromRegistry(bytes32 entitlementId, address caller) external nonReentrant {
        if (msg.sender != address(walletRegistry)) revert Unauthorized();
        _requireClaimsAvailable();
        Entitlement storage award = entitlements[entitlementId];
        address payable recipient = _recipient(award);
        if (award.beneficiaryKind == 1) revert ClubOwnerSignaturesRequired();
        if (caller != recipient) revert InvalidRecipientSignature();
        _pay(entitlementId, award, recipient);
    }

    /// @notice Athlete relay path: only the recipient's fresh consent is required.
    function claim(
        bytes32 entitlementId,
        uint256 nonce,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes calldata recipientSignature
    ) external nonReentrant {
        _requireClaimsAvailable();
        Entitlement storage award = entitlements[entitlementId];
        address payable recipient = _recipient(award);
        if (award.beneficiaryKind == 1) revert ClubOwnerSignaturesRequired();
        if (nonce != award.authorizationNonce) revert InvalidNonce();
        if (
            issuedAt > block.timestamp || expiresAt <= block.timestamp || expiresAt <= issuedAt
                || uint256(expiresAt) - issuedAt > MAX_AUTHORIZATION_LIFETIME
        ) revert InvalidAuthorizationTime();
        if (!SignatureChecker.isValidSignatureNow(
                recipient, claimDigest(entitlementId, nonce, issuedAt, expiresAt), recipientSignature
            )) {
            revert InvalidRecipientSignature();
        }
        _pay(entitlementId, award, recipient);
    }

    /// @notice Anyone can pay gas; exactly two pinned club owners authorize the
    /// exact current award. Payment always goes to the registered treasury.
    function claimClub(
        bytes32 entitlementId,
        uint256 nonce,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes calldata ownerSignatures
    ) external nonReentrant {
        _requireClaimsAvailable();
        Entitlement storage award = entitlements[entitlementId];
        address payable recipient = _recipient(award);
        if (award.beneficiaryKind != 1) revert InvalidClubTreasury();
        if (nonce != award.authorizationNonce) revert InvalidNonce();
        if (
            issuedAt > block.timestamp || expiresAt <= block.timestamp || expiresAt <= issuedAt
                || uint256(expiresAt) - issuedAt > MAX_CLUB_AUTHORIZATION_LIFETIME
        ) revert InvalidAuthorizationTime();
        (bytes32 ownersHash,) = walletRegistry.clubPolicyOf(award.beneficiaryId);
        ClubSignaturePolicyV1.verify(
            recipient, ownersHash, clubClaimDigest(entitlementId, nonce, issuedAt, expiresAt), ownerSignatures
        );
        _pay(entitlementId, award, recipient);
    }

    function clubClaimDigest(bytes32 entitlementId, uint256 nonce, uint64 issuedAt, uint64 expiresAt)
        public
        view
        returns (bytes32)
    {
        Entitlement storage award = entitlements[entitlementId];
        address recipient = _recipient(award);
        if (award.beneficiaryKind != 1) revert InvalidClubTreasury();
        (bytes32 ownersHash, uint256 registrationNonce) = walletRegistry.clubPolicyOf(award.beneficiaryId);
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECEIVE_CLUB_REWARD_TYPEHASH,
                    entitlementId,
                    recipient,
                    award.amount,
                    award.pot,
                    nonce,
                    issuedAt,
                    expiresAt,
                    allocationDigest,
                    ownersHash,
                    registrationNonce
                )
            )
        );
    }

    /// @dev Identity attestation pins the verified club owner set. Proxy/singleton,
    /// fallback and membership provenance remain the issuer service's responsibility.
    function _recipient(Entitlement storage award) private view returns (address payable recipient) {
        if (award.amount == 0 || award.paid) revert UnknownOrPaidEntitlement();
        recipient = payable(walletRegistry.recipientOf(award.beneficiaryId, award.beneficiaryKind));
        if (recipient == address(0)) revert InvalidRecipientSignature();
        if (award.beneficiaryKind == 1) {
            (bytes32 expected,) = walletRegistry.clubPolicyOf(award.beneficiaryId);
            if (expected == bytes32(0) || ClubSignaturePolicyV1.ownersHash(recipient) != expected) {
                revert InvalidClubTreasury();
            }
        }
    }

    function _pay(bytes32 entitlementId, Entitlement storage award, address payable recipient) private {
        uint256 nonce = award.authorizationNonce;
        award.paid = true;
        award.authorizationNonce++;
        award.recipient = recipient;
        paid[award.pot] += award.amount;
        emit RewardPaid(entitlementId, recipient, award.pot, award.amount, nonce);
        _transfer(recipient, award.amount);
    }

    function claimDigest(bytes32 entitlementId, uint256 nonce, uint64 issuedAt, uint64 expiresAt)
        public
        view
        returns (bytes32)
    {
        Entitlement storage award = entitlements[entitlementId];
        address recipient = _recipient(award);
        return _hashTypedDataV4(
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

    /// @notice Terminal returns preserve separate immutable economic destinations.
    /// @dev Each lane is independently callable so one rejecting receiver does not
    ///      block the other. No return is possible while awards remain claimable.
    function returnUnallocated() external nonReentrant onlyOperator inState(State.Closed) {
        _returnUnallocated();
    }

    function returnExpired() external nonReentrant onlyOperator inState(State.Closed) {
        _returnExpired();
    }

    function returnToTreasury() external nonReentrant onlyOperator {
        _requireReturnAllowed();
        if (state == State.Cancelled) {
            uint256 amount = accountedFunding - treasuryReturned;
            if (amount == 0) revert NothingToReturn();
            treasuryReturned += amount;
            emit TreasuryReturned(cancellationTreasury, amount);
            _transfer(cancellationTreasury, amount);
        } else {
            bool unallocatedPending = accountedFunding - allocated[enabledPot] > unallocatedReturned;
            bool expiredPending = allocated[enabledPot] - paid[enabledPot] > expiredReturned;
            if (!unallocatedPending && !expiredPending) revert NothingToReturn();
            if (unallocatedPending) _returnUnallocated();
            if (expiredPending) _returnExpired();
        }
    }

    function _returnUnallocated() private {
        _requireReturnAllowed();
        uint256 amount = accountedFunding - allocated[enabledPot] - unallocatedReturned;
        if (amount == 0) revert NothingToReturn();
        unallocatedReturned += amount;
        treasuryReturned += amount;
        emit TreasuryReturned(treasury, amount);
        _transfer(treasury, amount);
    }

    function _returnExpired() private {
        _requireReturnAllowed();
        uint256 amount = allocated[enabledPot] - paid[enabledPot] - expiredReturned;
        if (amount == 0) revert NothingToReturn();
        expiredReturned += amount;
        treasuryReturned += amount;
        emit TreasuryReturned(expiredTreasury, amount);
        _transfer(expiredTreasury, amount);
    }

    function returnSurplus() external nonReentrant onlyOperator {
        _requireReturnAllowed();
        uint256 reserved = accountedFunding - paid[0] - paid[1] - treasuryReturned;
        uint256 amount = address(this).balance - reserved;
        if (amount == 0) revert NothingToReturn();
        emit SurplusReturned(cancellationTreasury, amount);
        _transfer(cancellationTreasury, amount);
    }

    function _requireClaimsAvailable() private view {
        if (state != State.Active || paused || block.timestamp >= claimDeadline) revert ClaimsUnavailable();
    }

    function _requireReturnAllowed() private view {
        if (paused || (state != State.Cancelled && state != State.Closed)) revert ClaimsUnavailable();
    }

    function _transfer(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
