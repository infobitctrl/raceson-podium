// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnRewardCampaignTest} from "./RacesOnRewardCampaign.t.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";
import {RacesOnRewardCampaignV4 as V4} from "../src/RacesOnRewardCampaignV4.sol";

/// @dev Inherits the full original funding, payout, replay, receiver and expiry suite.
contract RacesOnRewardCampaignV4Test is RacesOnRewardCampaignTest {
    bytes32 internal constant EVIDENCE = keccak256("synthetic final publication evidence");

    function _new(uint8 pot, uint64 period) private returns (V4) {
        return new V4(
            operator,
            treasury,
            keccak256("test programme"),
            keccak256("test campaign"),
            keccak256("test rules"),
            pot,
            period,
            365 days,
            operator,
            treasury,
            treasury
        );
    }

    function _deploy(uint8 pot) internal override returns (Campaign) {
        return Campaign(address(_new(pot, 1 days)));
    }

    function _signingVersion() internal pure override returns (string memory) {
        return "5";
    }

    function _stageAllocation(Campaign target, bytes32 snapshot, bytes32 upload, uint256 count, uint64 publication)
        internal
        override
    {
        V4 v3 = V4(address(target));
        v3.stageAllocation(snapshot, upload, count, uint64(publication - v3.reviewPeriod()), publication, EVIDENCE);
    }

    function _uploaded(V4 target) private {
        _fund(Campaign(address(target)));
        vm.prank(operator);
        Campaign(address(target)).uploadAwards(_awards(0));
    }

    function testReviewRequiresMatchingManifestAndBothTimeWindows() public override {
        V4 target = V4(address(campaign));
        _uploaded(target);
        bytes32 digest = target.uploadDigest();
        uint64 now_ = uint64(block.timestamp);
        vm.startPrank(operator);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, bytes32(0), 2, now_ - 1 days, now_, EVIDENCE);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 1, now_ - 1 days, now_, EVIDENCE);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - 1 days + 1, now_, EVIDENCE);
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - 1 days, now_, EVIDENCE);
        assertEq(target.reviewStartedAt(), now_ - 1 days);
        assertEq(target.officialPublishedAt(), now_);
        assertEq(target.activationNotBefore(), now_);
        bytes32 staged = target.allocationDigest();
        vm.expectRevert(V4.InvalidReview.selector);
        target.activate(staged, keccak256("changed sources"));
        target.activate(staged, SNAPSHOT); // No second wait or vm.warp.
        vm.stopPrank();
        assertEq(target.claimDeadline(), now_ + 365 days);
    }

    function testZeroReviewRequiresExplicitFinalPublicationAndNewRewardApproval() public {
        V4 target = _new(0, 0);
        _uploaded(target);
        bytes32 digest = target.uploadDigest();
        vm.startPrank(operator);
        vm.expectRevert(V4.WrongState.selector);
        target.activate(bytes32(0), SNAPSHOT);
        target.stageAllocation(SNAPSHOT, digest, 2, uint64(block.timestamp), uint64(block.timestamp), EVIDENCE);
        target.activate(target.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
        assertEq(target.PROTOCOL_VERSION(), 4);
        assertEq(target.reviewPeriod(), 0);
        assertEq(uint256(target.state()), uint256(V4.State.Active));
        assertEq(target.paid(0), 0); // Publication/activation never sends a prize.
        assertEq(address(target).balance, 12 ether);
    }

    function testHistoricalFinalsHaveNoNewDelayButApprovalIsNow() public {
        V4 target = V4(address(campaign));
        _uploaded(target);
        vm.startPrank(operator);
        target.stageAllocation(
            SNAPSHOT,
            target.uploadDigest(),
            2,
            uint64(block.timestamp - 101 days),
            uint64(block.timestamp - 100 days),
            EVIDENCE
        );
        assertEq(target.activationNotBefore(), block.timestamp);
        target.activate(target.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
        assertEq(target.claimDeadline(), block.timestamp + 365 days);
    }

    function testMissingFutureAndInconsistentPublicationEvidenceFails() public {
        V4 target = V4(address(campaign));
        _uploaded(target);
        bytes32 digest = target.uploadDigest();
        uint64 now_ = uint64(block.timestamp);
        vm.startPrank(operator);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, 0, now_, EVIDENCE);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - 1 days, now_ + 1, EVIDENCE);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - 1 days, now_, bytes32(0));
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(bytes32(0), digest, 2, now_ - 1 days, now_, EVIDENCE);
        vm.expectRevert(V4.InvalidReview.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, type(uint64).max, now_, EVIDENCE);
        vm.stopPrank();
        vm.expectRevert(V4.Unauthorized.selector);
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - 1 days, now_, EVIDENCE);
    }

    function testLegacyStagingSelectorCannotApproveV4() public {
        _uploaded(V4(address(campaign)));
        bytes memory data =
            abi.encodeCall(campaign.stageAllocation, (SNAPSHOT, campaign.uploadDigest(), 2, uint64(block.timestamp)));
        vm.prank(operator);
        (bool ok,) = address(campaign).call(data);
        assertFalse(ok);
        assertEq(uint256(campaign.state()), uint256(Campaign.State.Review));
    }

    function testCorrectedUnpaidVersionCancelsAndCannotReplaceApprovedAwards() public {
        V4 target = V4(address(campaign));
        _uploaded(target);
        vm.startPrank(operator);
        target.stageAllocation(
            SNAPSHOT, target.uploadDigest(), 2, uint64(block.timestamp - 1 days), uint64(block.timestamp), EVIDENCE
        );
        bytes32 staged = target.allocationDigest();
        bytes32 uploaded = target.uploadDigest();
        vm.expectRevert(V4.WrongState.selector);
        target.stageAllocation(
            keccak256("corrected"), uploaded, 2, uint64(block.timestamp - 1 days), uint64(block.timestamp), EVIDENCE
        );
        target.cancel();
        vm.expectRevert(V4.WrongState.selector);
        target.activate(staged, SNAPSHOT);
        vm.stopPrank();
        assertEq(target.paid(0), 0);
    }

    function testFuzzConfiguredReviewBoundary(uint32 duration) public {
        // Each campaign's period is immutable, including explicit no-timer (zero).
        uint64 period = uint64(bound(duration, 0, 365 days));
        V4 target = _new(0, period);
        _uploaded(target);
        uint64 now_ = uint64(block.timestamp);
        bytes32 digest = target.uploadDigest();
        vm.startPrank(operator);
        if (period > 0) {
            vm.expectRevert(V4.InvalidReview.selector);
            target.stageAllocation(SNAPSHOT, digest, 2, now_ - period + 1, now_, EVIDENCE);
        }
        target.stageAllocation(SNAPSHOT, digest, 2, now_ - period, now_, EVIDENCE);
        target.activate(target.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
        assertEq(target.reviewPeriod(), period);
        assertEq(target.activationNotBefore(), now_);
    }
}
