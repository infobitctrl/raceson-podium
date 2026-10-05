// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnRewardCampaignTest} from "./RacesOnRewardCampaign.t.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";
import {RacesOnRewardCampaignV2 as CampaignV2} from "../src/RacesOnRewardCampaignV2.sol";

/// @dev Run the entire existing funding/claim/receiver/replay/conservation suite
///      against the new artifact, without changing the historical v1 bytecode.
contract RacesOnRewardCampaignV2Test is RacesOnRewardCampaignTest {
    function _deploy(uint8 pot) internal override returns (Campaign) {
        return Campaign(
            address(
                new CampaignV2(
                    operator,
                    treasury,
                    keccak256("test programme"),
                    keccak256("test campaign"),
                    keccak256("test rules"),
                    pot
                )
            )
        );
    }

    function _signingVersion() internal pure override returns (string memory) {
        return "3";
    }

    function testReviewRequiresMatchingManifestAndBothTimeWindows() public override {
        _fund(campaign);
        vm.startPrank(operator);
        campaign.uploadAwards(_awards(0));
        bytes32 digest = campaign.uploadDigest();
        vm.expectRevert(Campaign.InvalidReview.selector);
        campaign.stageAllocation(SNAPSHOT, bytes32(0), 2, uint64(block.timestamp));
        vm.expectRevert(Campaign.InvalidReview.selector);
        campaign.stageAllocation(SNAPSHOT, digest, 1, uint64(block.timestamp));
        vm.expectRevert(Campaign.InvalidReview.selector);
        campaign.stageAllocation(SNAPSHOT, digest, 2, uint64(block.timestamp + 1));
        campaign.stageAllocation(SNAPSHOT, digest, 2, uint64(block.timestamp));
        assertEq(CampaignV2(address(campaign)).reviewStartedAt(), block.timestamp);
        assertEq(campaign.activationNotBefore(), block.timestamp + 1 days);
        bytes32 stagedDigest = campaign.allocationDigest();
        vm.warp(campaign.activationNotBefore() - 1);
        vm.expectRevert(Campaign.ReviewNotFinished.selector);
        campaign.activate(stagedDigest, SNAPSHOT);
        vm.warp(campaign.activationNotBefore());
        vm.expectRevert(Campaign.InvalidReview.selector);
        campaign.activate(stagedDigest, keccak256("changed sources"));
        campaign.activate(stagedDigest, SNAPSHOT);
        vm.stopPrank();
        assertEq(campaign.claimDeadline(), block.timestamp + 365 days);
    }

    function testHistoricalPublicationCannotBackdateTheNewProposalReview() public {
        _fund(campaign);
        vm.startPrank(operator);
        campaign.uploadAwards(_awards(0));
        campaign.stageAllocation(SNAPSHOT, campaign.uploadDigest(), 2, uint64(block.timestamp - 100 days));
        assertEq(CampaignV2(address(campaign)).reviewStartedAt(), block.timestamp);
        assertEq(campaign.activationNotBefore(), block.timestamp + 86400);
        bytes32 digest = campaign.allocationDigest();
        vm.expectRevert(Campaign.ReviewNotFinished.selector);
        campaign.activate(digest, SNAPSHOT);
        vm.stopPrank();
    }

    function testCorrectedProposalNeedsNewCommitmentAndFullWindow() public {
        _fund(campaign);
        vm.startPrank(operator);
        campaign.uploadAwards(_awards(0));
        campaign.stageAllocation(SNAPSHOT, campaign.uploadDigest(), 2, uint64(block.timestamp));
        uint256 firstDeadline = campaign.activationNotBefore();
        vm.warp(firstDeadline - 60);
        campaign.cancel();
        bytes32 digest = campaign.allocationDigest();
        vm.expectRevert(Campaign.WrongState.selector);
        campaign.activate(digest, SNAPSHOT);
        vm.stopPrank();
        Campaign corrected = _deploy(0);
        _fund(corrected);
        vm.startPrank(operator);
        corrected.uploadAwards(_awards(0));
        corrected.stageAllocation(
            keccak256("corrected synthetic source"), corrected.uploadDigest(), 2, uint64(block.timestamp)
        );
        assertEq(corrected.activationNotBefore(), firstDeadline - 60 + 86400);
        assertNotEq(corrected.allocationDigest(), campaign.allocationDigest());
        vm.stopPrank();
    }
}
