// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";

/// @dev Deliberately synthetic ERC-1271 fixture, NOT evidence of deployed Safe compatibility.
contract TestRecipient is IERC1271 {
    address public immutable signer;
    bool public rejectPayment;
    bool public rejectSignature;
    bool public reentrySucceeded;
    address public reentryTarget;
    bytes public reentryData;

    constructor(address signer_) {
        signer = signer_;
    }

    function configure(bool rejectPayment_, bool rejectSignature_, address target, bytes memory data) external {
        rejectPayment = rejectPayment_;
        rejectSignature = rejectSignature_;
        reentryTarget = target;
        reentryData = data;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(hash, signature);
        return !rejectSignature && recoverError == ECDSA.RecoverError.NoError && recovered == signer
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    receive() external payable {
        require(!rejectPayment, "receiver rejected");
        if (reentryTarget != address(0)) (reentrySucceeded,) = reentryTarget.call(reentryData);
    }
}

contract ForceTestMon {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract RacesOnRewardCampaignTest is Test {
    // Public, synthetic local test signers only. Never funded or used outside disposable tests.
    uint256 private constant OPERATOR_KEY = 0xA11CE;
    uint256 private constant ATHLETE_KEY = 0xB0B;
    uint256 private constant SECOND_KEY = 0xCAFE;
    address internal operator;
    address payable internal treasury;
    address payable private athlete;
    Campaign internal campaign;
    bytes32 internal constant SNAPSHOT = keccak256("synthetic snapshot");

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        operator = vm.addr(OPERATOR_KEY);
        athlete = payable(vm.addr(ATHLETE_KEY));
        treasury = payable(vm.addr(0x777));
        vm.deal(operator, 1000 ether);
        vm.deal(address(this), 1000 ether);
        campaign = _deploy(0);
    }

    /// @dev Protocol-specific staging hook; production v1/v2 artifacts stay unchanged.
    function _stageAllocation(Campaign target, bytes32 snapshot, bytes32 upload, uint256 count, uint64 publication)
        internal
        virtual
    {
        target.stageAllocation(snapshot, upload, count, publication);
    }

    function _deploy(uint8 pot) internal virtual returns (Campaign) {
        return new Campaign(
            operator, treasury, keccak256("test programme"), keccak256("test campaign"), keccak256("test rules"), pot
        );
    }

    function _fund(Campaign target) internal {
        vm.startPrank(operator);
        target.fund{value: 12 ether}();
        target.closeFunding();
        vm.stopPrank();
    }

    function testCompleteFundingAtomicallyDepositsRemainderAndFreezesExactBudget() public {
        vm.startPrank(operator);
        campaign.fund{value: 3 ether}();
        campaign.completeFunding{value: 9 ether}(3 ether, 12 ether);
        vm.stopPrank();
        assertEq(uint256(campaign.state()), uint256(Campaign.State.Review));
        assertEq(campaign.accountedFunding(), 12 ether);
        assertEq(campaign.budgets(0), 12 ether);
        assertEq(campaign.budgets(1), 0);
        assertEq(address(campaign).balance, 12 ether);
        vm.prank(operator);
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.completeFunding{value: 9 ether}(3 ether, 12 ether);
        assertEq(address(campaign).balance, 12 ether);
    }

    function testCompleteFundingRejectsCompetingDepositAndDoesNotSpendTheRemainder() public {
        vm.startPrank(operator);
        campaign.fund{value: 3 ether}();
        // Another authorized deposit lands after a worker observed three.
        campaign.fund{value: 1 ether}();
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.completeFunding{value: 9 ether}(3 ether, 12 ether);
        vm.stopPrank();
        assertEq(campaign.accountedFunding(), 4 ether);
        assertEq(address(campaign).balance, 4 ether);
        assertEq(campaign.budgets(0), 0);
        assertEq(uint256(campaign.state()), uint256(Campaign.State.Funding));
    }

    function testCompleteFundingIgnoresForcedSurplusAndCanCloseAlreadyExactDeposits() public {
        Campaign league = _deploy(1);
        new ForceTestMon{value: 5 ether}(payable(address(league)));
        vm.startPrank(operator);
        league.fund{value: 12 ether}();
        league.completeFunding(12 ether, 12 ether);
        vm.stopPrank();
        assertEq(league.accountedFunding(), 12 ether);
        assertEq(league.budgets(0), 0);
        assertEq(league.budgets(1), 12 ether);
        assertEq(address(league).balance, 17 ether);
        assertEq(uint256(league.state()), uint256(Campaign.State.Review));
    }

    function testCompleteFundingRejectsWrongAuthorityAmountAndZeroOrSmallerBudget() public {
        vm.prank(treasury);
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.completeFunding(0, 1 ether);
        vm.startPrank(operator);
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.completeFunding(0, 0);
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.completeFunding{value: 2 ether}(0, 1 ether);
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.completeFunding(0, 1 ether);
        campaign.fund{value: 2 ether}();
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.completeFunding(2 ether, 1 ether);
        vm.stopPrank();
        assertEq(campaign.accountedFunding(), 2 ether);
        assertEq(uint256(campaign.state()), uint256(Campaign.State.Funding));
    }

    function testFuzzCompleteFundingConservesExplicitBudget(uint96 budgetSeed, uint96 priorSeed, bool leaguePot)
        public
    {
        uint256 budget = bound(uint256(budgetSeed), 1, 100 ether);
        uint256 prior = bound(uint256(priorSeed), 0, budget);
        Campaign target = _deploy(leaguePot ? 1 : 0);
        vm.startPrank(operator);
        if (prior > 0) target.fund{value: prior}();
        target.completeFunding{value: budget - prior}(prior, budget);
        vm.stopPrank();
        assertEq(target.accountedFunding(), budget);
        assertEq(target.budgets(leaguePot ? 1 : 0), budget);
        assertEq(target.budgets(leaguePot ? 0 : 1), 0);
        assertEq(address(target).balance, budget);
    }

    function _awards(uint8 pot) internal pure returns (Campaign.AwardInput[] memory items) {
        items = new Campaign.AwardInput[](2);
        items[0] =
            Campaign.AwardInput(bytes32(uint256(1)), bytes32(uint256(1001)), pot, 5 ether, keccak256("award one"), 0);
        items[1] =
            Campaign.AwardInput(bytes32(uint256(2)), bytes32(uint256(1002)), pot, 3 ether, keccak256("award two"), 0);
    }

    function _stage(Campaign target) private {
        _fund(target);
        vm.startPrank(operator);
        target.uploadAwards(_awards(target.enabledPot()));
        _stageAllocation(target, SNAPSHOT, target.uploadDigest(), 2, uint64(block.timestamp - 3 days));
        vm.stopPrank();
    }

    function _active(Campaign target) private {
        _stage(target);
        vm.warp(target.activationNotBefore());
        bytes32 digest = target.allocationDigest();
        vm.prank(operator);
        target.activate(digest, SNAPSHOT);
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _proofs(
        Campaign target,
        bytes32 id,
        address recipient,
        uint256 nonce,
        uint64 issued,
        uint64 expires,
        uint256 recipientKey
    ) private view returns (bytes memory approval, bytes memory consent) {
        (bytes32 first, bytes32 second) = target.claimDigests(id, recipient, nonce, issued, expires);
        return (_sign(OPERATOR_KEY, first), _sign(recipientKey, second));
    }

    function _claim(Campaign target, uint256 id, address payable recipient, uint256 key, uint256 nonce) private {
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) = _proofs(target, bytes32(id), recipient, nonce, issued, expires, key);
        target.claim(bytes32(id), recipient, nonce, issued, expires, first, second);
    }

    function _assertUnpaid(Campaign target, uint256 id, uint256 nonce) private view {
        (,,, uint256 actualNonce, address recipient,, bool isPaid,) = target.entitlements(bytes32(id));
        assertFalse(isPaid);
        assertEq(actualNonce, nonce);
        assertEq(recipient, address(0));
    }

    function testDeploymentRejectsMainnetAndInvalidConfiguration() public {
        vm.chainId(143);
        vm.expectRevert(Campaign.UnsupportedChain.selector);
        _deploy(0);
        vm.chainId(10143);
        assertEq(_deploy(1).enabledPot(), 1);
        vm.expectRevert(Campaign.InvalidConfiguration.selector);
        _deploy(2);
        vm.expectRevert(Campaign.InvalidConfiguration.selector);
        new Campaign(address(0), treasury, bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), 0);
    }

    function testFundingRequiresAuthorityAndFreezesOnlyExplicitDeposits() public {
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.fund{value: 1 ether}();
        vm.prank(operator);
        vm.expectRevert(Campaign.InvalidFunding.selector);
        campaign.closeFunding();
        new ForceTestMon{value: 7 ether}(payable(address(campaign)));
        _fund(campaign);
        assertEq(campaign.accountedFunding(), 12 ether);
        assertEq(campaign.budgets(0), 12 ether);
        assertEq(campaign.budgets(1), 0);
        assertEq(address(campaign).balance, 19 ether);
        vm.prank(operator);
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.fund{value: 1 ether}();
    }

    function testUploadIsAppendOnlyBoundedAndDoesNotStoreDestinations() public {
        _fund(campaign);
        Campaign.AwardInput[] memory items = _awards(0);
        vm.prank(operator);
        campaign.uploadAwards(items);
        assertEq(campaign.entitlementCount(), 2);
        assertEq(campaign.allocated(0), 8 ether);
        _assertUnpaid(campaign, 1, 0);
        vm.prank(operator);
        vm.expectRevert(Campaign.InvalidAward.selector);
        campaign.uploadAwards(items);
        items = new Campaign.AwardInput[](65);
        vm.prank(operator);
        vm.expectRevert(Campaign.InvalidAward.selector);
        campaign.uploadAwards(items);
    }

    function testInvalidBatchRollsBackAllAwards() public {
        _fund(campaign);
        Campaign.AwardInput[] memory items = _awards(0);
        items[1].amount = 10 ether;
        vm.prank(operator);
        vm.expectRevert(Campaign.BudgetExceeded.selector);
        campaign.uploadAwards(items);
        assertEq(campaign.entitlementCount(), 0);
        assertEq(campaign.uploadDigest(), bytes32(0));
        assertEq(campaign.allocated(0), 0);
        assertFalse(campaign.beneficiaryAllocated(items[0].beneficiaryId));
    }

    function testDuplicateBeneficiaryAndDisabledPotAreRejected() public {
        _fund(campaign);
        Campaign.AwardInput[] memory items = _awards(0);
        items[1].beneficiaryId = items[0].beneficiaryId;
        vm.prank(operator);
        vm.expectRevert(Campaign.DuplicateBeneficiary.selector);
        campaign.uploadAwards(items);
        items = _awards(1);
        vm.prank(operator);
        vm.expectRevert(Campaign.InvalidAward.selector);
        campaign.uploadAwards(items);
    }

    function testReviewRequiresMatchingManifestAndBothTimeWindows() public virtual {
        _fund(campaign);
        vm.startPrank(operator);
        campaign.uploadAwards(_awards(0));
        bytes32 digest = campaign.uploadDigest();
        vm.expectRevert(Campaign.InvalidReview.selector);
        _stageAllocation(campaign, SNAPSHOT, bytes32(0), 2, uint64(block.timestamp));
        vm.expectRevert(Campaign.InvalidReview.selector);
        _stageAllocation(campaign, SNAPSHOT, digest, 1, uint64(block.timestamp));
        _stageAllocation(campaign, SNAPSHOT, digest, 2, uint64(block.timestamp));
        assertEq(campaign.activationNotBefore(), block.timestamp + 3 days);
        bytes32 stagedDigest = campaign.allocationDigest();
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(Campaign.ReviewNotFinished.selector);
        campaign.activate(stagedDigest, SNAPSHOT);
        vm.warp(campaign.activationNotBefore());
        vm.expectRevert(Campaign.InvalidReview.selector);
        campaign.activate(stagedDigest, keccak256("changed sources"));
        campaign.activate(stagedDigest, SNAPSHOT);
        vm.stopPrank();
        assertEq(campaign.claimDeadline(), block.timestamp + 365 days);
    }

    function testActiveAwardsCannotBeChangedCancelledOrWithdrawn() public {
        _active(campaign);
        vm.startPrank(operator);
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.uploadAwards(_awards(0));
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.cancel();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.returnToTreasury();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.returnSurplus();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.close();
        vm.stopPrank();
    }

    function testAnyRelayerCanExecuteOnlyTheTwoSignedMessagesOnce() public {
        _active(campaign);
        _claim(campaign, 1, athlete, ATHLETE_KEY, 0);
        assertEq(athlete.balance, 5 ether);
        assertEq(campaign.paid(0), 5 ether);
        assertEq(campaign.paid(1), 0);
        (,,, uint256 nonce, address recipient,, bool isPaid,) = campaign.entitlements(bytes32(uint256(1)));
        assertEq(nonce, 1);
        assertEq(recipient, athlete);
        assertTrue(isPaid);
        uint64 issued = uint64(block.timestamp);
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), athlete, 0, issued, issued + 1 hours, ATHLETE_KEY);
        vm.expectRevert(Campaign.UnknownOrPaidEntitlement.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, issued, issued + 1 hours, first, second);
    }

    function testBothSignaturesAreRequiredAndCannotBeSwappedOrRedirected() public {
        _active(campaign);
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        bytes32 id = bytes32(uint256(1));
        (bytes memory first, bytes memory second) = _proofs(campaign, id, athlete, 0, issued, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(id, athlete, 0, issued, expires, "", second);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claim(id, athlete, 0, issued, expires, first, "");
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(id, athlete, 0, issued, expires, second, first);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(id, payable(vm.addr(SECOND_KEY)), 0, issued, expires, first, second);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(bytes32(uint256(2)), athlete, 0, issued, expires, first, second);
    }

    function testSignaturesBindExactDomainTypesStoredAmountAndPot() public {
        _active(campaign);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("RacesOnRewardCampaign"),
                keccak256(bytes(_signingVersion())),
                block.chainid,
                address(campaign)
            )
        );
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes32 approval, bytes32 receipt) = campaign.claimDigests(bytes32(uint256(1)), athlete, 0, issued, expires);
        bytes32 expectedApproval = keccak256(
            abi.encodePacked(
                hex"1901",
                domain,
                keccak256(
                    abi.encode(
                        keccak256(
                            "ClaimAuthorization(bytes32 entitlementId,address recipient,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest)"
                        ),
                        bytes32(uint256(1)),
                        athlete,
                        uint256(0),
                        issued,
                        expires,
                        campaign.allocationDigest()
                    )
                )
            )
        );
        bytes32 expectedReceipt = keccak256(
            abi.encodePacked(
                hex"1901",
                domain,
                keccak256(
                    abi.encode(
                        keccak256(
                            "ReceiveReward(bytes32 entitlementId,address recipient,uint256 amount,uint8 pot,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 allocationDigest)"
                        ),
                        bytes32(uint256(1)),
                        athlete,
                        uint256(5 ether),
                        uint8(0),
                        uint256(0),
                        issued,
                        expires,
                        campaign.allocationDigest()
                    )
                )
            )
        );
        assertEq(approval, expectedApproval);
        assertEq(receipt, expectedReceipt);
        assertNotEq(approval, receipt);
    }

    function _signingVersion() internal pure virtual returns (string memory) {
        return "2";
    }

    function testCrossCampaignAndChainReplayFails() public {
        _stage(campaign);
        Campaign other = _deploy(0);
        _stage(other);
        vm.warp(campaign.activationNotBefore());
        vm.startPrank(operator);
        campaign.activate(campaign.allocationDigest(), SNAPSHOT);
        other.activate(other.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), athlete, 0, issued, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        other.claim(bytes32(uint256(1)), athlete, 0, issued, expires, first, second);
        vm.chainId(10143);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, issued, expires, first, second);
    }

    function testAuthorizationTimeIsSignedAndCannotOutliveOneDay() public {
        _active(campaign);
        uint64 now_ = uint64(block.timestamp);
        _expectTimeFailure(now_ + 1, now_ + 1 hours);
        _expectTimeFailure(now_ - 1 hours, now_);
        _expectTimeFailure(now_, now_ + 1 days + 1);
        _expectTimeFailure(now_, now_);
        _expectTimeFailure(now_, now_ - 1);
        uint64 expires = now_ + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), athlete, 0, now_, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, now_, expires + 1, first, second);
    }

    function _expectTimeFailure(uint64 issued, uint64 expires) private {
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), athlete, 0, issued, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, issued, expires, first, second);
    }

    function testRevocationInvalidatesOldProofsAndAllowsNewConsent() public {
        _active(campaign);
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), athlete, 0, issued, expires, ATHLETE_KEY);
        vm.prank(operator);
        campaign.revokeAuthorization(bytes32(uint256(1)));
        vm.expectRevert(Campaign.InvalidNonce.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, issued, expires, first, second);
        _claim(campaign, 1, payable(vm.addr(SECOND_KEY)), SECOND_KEY, 1);
        vm.prank(operator);
        vm.expectRevert(Campaign.UnknownOrPaidEntitlement.selector);
        campaign.revokeAuthorization(bytes32(uint256(1)));
    }

    function testERC1271ConsentAndRevocableSignatureState() public {
        _active(campaign);
        TestRecipient receiver = new TestRecipient(athlete);
        receiver.configure(false, true, address(0), "");
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), address(receiver), 0, issued, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claim(bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second);
        receiver.configure(false, false, address(0), "");
        campaign.claim(bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second);
        assertEq(address(receiver).balance, 5 ether);
    }

    function testReceiverFailureRollsBackAndDoesNotBlockAnotherAward() public {
        _active(campaign);
        TestRecipient receiver = new TestRecipient(athlete);
        receiver.configure(true, false, address(0), "");
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), address(receiver), 0, issued, expires, ATHLETE_KEY);
        vm.expectRevert(Campaign.TransferFailed.selector);
        campaign.claim(bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second);
        _assertUnpaid(campaign, 1, 0);
        assertEq(campaign.paid(0), 0);
        assertEq(address(campaign).balance, 12 ether);
        _claim(campaign, 2, payable(vm.addr(SECOND_KEY)), SECOND_KEY, 0);
        assertEq(campaign.paid(0), 3 ether);
        receiver.configure(false, false, address(0), "");
        campaign.claim(bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second);
        assertEq(campaign.paid(0), 8 ether);
    }

    function testReceiverCannotReenterClaim() public {
        _active(campaign);
        TestRecipient receiver = new TestRecipient(athlete);
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes memory first, bytes memory second) =
            _proofs(campaign, bytes32(uint256(1)), address(receiver), 0, issued, expires, ATHLETE_KEY);
        bytes memory payload = abi.encodeCall(
            campaign.claim, (bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second)
        );
        receiver.configure(false, false, address(campaign), payload);
        campaign.claim(bytes32(uint256(1)), payable(address(receiver)), 0, issued, expires, first, second);
        assertFalse(receiver.reentrySucceeded());
        assertEq(address(receiver).balance, 5 ether);
        assertEq(campaign.paid(0), 5 ether);
    }

    function testPauseIsExplicitExtendsClockOnceAndBlocksEveryOutflow() public {
        _active(campaign);
        uint256 deadline = campaign.claimDeadline();
        vm.startPrank(operator);
        campaign.pause();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.pause();
        campaign.revokeAuthorization(bytes32(uint256(1)));
        vm.warp(block.timestamp + 400 days);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.close();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.returnToTreasury();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.returnSurplus();
        vm.stopPrank();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 1, 0, 1, "", "");
        vm.prank(operator);
        campaign.resume();
        assertEq(campaign.claimDeadline(), deadline + 400 days);
        assertFalse(campaign.paused());
        vm.prank(operator);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.resume();
        _claim(campaign, 1, athlete, ATHLETE_KEY, 1);
    }

    function testExpiredAwardsCanOnlyReturnToFixedTreasury() public {
        _active(campaign);
        _claim(campaign, 1, athlete, ATHLETE_KEY, 0);
        vm.warp(campaign.claimDeadline());
        vm.prank(operator);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.pause();
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.claim(bytes32(uint256(2)), athlete, 0, 0, 1, "", "");
        vm.startPrank(operator);
        campaign.close();
        campaign.returnToTreasury();
        assertEq(treasury.balance, 7 ether);
        assertEq(campaign.treasuryReturned(), 7 ether);
        vm.expectRevert(Campaign.NothingToReturn.selector);
        campaign.returnToTreasury();
        vm.stopPrank();
    }

    function testCancelledCampaignReturnsAccountedFundingAndSurplusSeparately() public {
        _stage(campaign);
        new ForceTestMon{value: 2 ether}(payable(address(campaign)));
        vm.startPrank(operator);
        campaign.cancel();
        campaign.returnSurplus();
        assertEq(treasury.balance, 2 ether);
        assertEq(campaign.treasuryReturned(), 0);
        assertEq(address(campaign).balance, 12 ether);
        campaign.returnToTreasury();
        assertEq(treasury.balance, 14 ether);
        assertEq(campaign.treasuryReturned(), 12 ether);
        bytes32 stagedDigest = campaign.allocationDigest();
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.activate(stagedDigest, SNAPSHOT);
        vm.stopPrank();
    }

    function testLeaguePotHasIndependentAccounting() public {
        Campaign league = _deploy(1);
        _active(league);
        _claim(league, 1, athlete, ATHLETE_KEY, 0);
        assertEq(league.budgets(0), 0);
        assertEq(league.allocated(0), 0);
        assertEq(league.paid(0), 0);
        assertEq(league.budgets(1), 12 ether);
        assertEq(league.allocated(1), 8 ether);
        assertEq(league.paid(1), 5 ether);
        assertEq(campaign.accountedFunding(), 0);
    }

    function testNonOperatorCannotGovernOrIssueApprovals() public {
        _active(campaign);
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.pause();
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.revokeAuthorization(bytes32(uint256(1)));
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.returnToTreasury();
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes32 approval, bytes32 receipt) = campaign.claimDigests(bytes32(uint256(1)), athlete, 0, issued, expires);
        bytes memory bad = _sign(SECOND_KEY, approval);
        bytes memory consent = _sign(ATHLETE_KEY, receipt);
        vm.expectRevert(Campaign.InvalidOperatorSignature.selector);
        campaign.claim(bytes32(uint256(1)), athlete, 0, issued, expires, bad, consent);
    }

    function testFuzzConservationAcrossPartialClaimsAndExpiry(
        uint96 firstRaw,
        uint96 secondRaw,
        uint96 unusedRaw,
        bool payFirst,
        bool paySecond
    ) public {
        uint256 firstAmount = uint256(firstRaw) + 1;
        uint256 secondAmount = uint256(secondRaw) + 1;
        uint256 budget = firstAmount + secondAmount + uint256(unusedRaw);
        vm.deal(operator, budget);
        vm.startPrank(operator);
        campaign.fund{value: budget}();
        campaign.closeFunding();
        Campaign.AwardInput[] memory items = _awards(0);
        items[0].amount = firstAmount;
        items[1].amount = secondAmount;
        campaign.uploadAwards(items);
        _stageAllocation(campaign, SNAPSHOT, campaign.uploadDigest(), 2, uint64(block.timestamp - 3 days));
        vm.warp(campaign.activationNotBefore());
        campaign.activate(campaign.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
        if (payFirst) _claim(campaign, 1, athlete, ATHLETE_KEY, 0);
        if (paySecond) _claim(campaign, 2, payable(vm.addr(SECOND_KEY)), SECOND_KEY, 0);
        uint256 expectedPaid = (payFirst ? firstAmount : 0) + (paySecond ? secondAmount : 0);
        assertEq(campaign.paid(0), expectedPaid);
        assertLe(campaign.paid(0), campaign.allocated(0));
        assertLe(campaign.allocated(0), campaign.budgets(0));
        assertEq(address(campaign).balance + expectedPaid, budget);
        vm.warp(campaign.claimDeadline());
        vm.startPrank(operator);
        campaign.close();
        if (budget > expectedPaid) campaign.returnToTreasury();
        vm.stopPrank();
        assertEq(campaign.treasuryReturned() + campaign.paid(0), budget);
        assertEq(address(campaign).balance, 0);
    }
}
