// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnWalletRegistryV1 as Registry} from "../src/RacesOnWalletRegistryV1.sol";
import {Test} from "forge-std/Test.sol";
import {RacesOnRewardProgrammeV5 as Programme} from "../src/RacesOnRewardProgrammeV5.sol";
import {RacesOnRewardCampaignV5 as Campaign} from "../src/RacesOnRewardCampaignV5.sol";

contract V5RejectReturn {
    receive() external payable {
        revert("synthetic rejection");
    }
}

contract RacesOnRewardProgrammeV5Test is Test {
    address payable private funder;
    address private operator;
    address payable private treasury;
    Programme.Configuration private config;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        funder = payable(makeAddr("synthetic sponsor"));
        operator = makeAddr("synthetic attestor");
        treasury = payable(makeAddr("synthetic unallocated treasury"));
        config.funder = funder;
        config.operator = operator;
        config.walletRegistry = address(new Registry(makeAddr("synthetic platform identity")));
        config.unallocatedTreasury = treasury;
        config.expiredTreasury = funder;
        config.programmeId = keccak256("synthetic V5 programme");
        config.manifestHash = keccak256("synthetic immutable setup");
        config.budget = 101;
        config.claimLifetime = 7 days;
        config.caps = [uint256(31), 0, 13, 17, 20, 20];
        for (uint8 i; i < 6; i++) {
            config.campaignIds[i] = keccak256(abi.encode("synthetic pot", i));
        }
        vm.deal(funder, 1000 ether);
        vm.deal(operator, 1 ether);
    }

    function _fund(Programme p) private {
        uint256 amount = p.budget();
        vm.prank(funder);
        p.fundProgramme{value: amount}();
    }

    function testExactFlexibleFundingAndZeroPotCannotReceiveFunds() public {
        Programme p = new Programme(config);
        assertEq(address(p.campaigns(1)), address(0));
        Campaign league = p.campaigns(0);
        vm.prank(operator);
        vm.expectRevert(Campaign.Unauthorized.selector);
        league.fund{value: 1}();
        _fund(p);
        assertTrue(p.funded());
        assertEq(address(p).balance, 0);
        uint256 sum;
        for (uint8 i; i < 6; i++) {
            sum += p.caps(i);
            if (p.caps(i) == 0) continue;
            Campaign child = p.campaigns(i);
            assertEq(child.accountedFunding(), p.caps(i));
            assertEq(uint256(child.state()), uint256(Campaign.State.Review));
            assertEq(child.enabledPot(), i == 0 ? 1 : 0);
            assertEq(child.CLAIM_LIFETIME(), 7 days);
            assertEq(child.fundingSource(), address(p));
            assertEq(child.expiredTreasury(), funder);
            assertEq(child.treasury(), treasury);
        }
        assertEq(sum, 101);
        vm.prank(funder);
        vm.expectRevert(Programme.FundingUnavailable.selector);
        p.fundProgramme{value: 101}();
    }

    function _activate(Campaign child, uint256 allocated) private {
        vm.startPrank(operator);
        if (allocated != 0) {
            Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](1);
            awards[0] = Campaign.AwardInput(
                bytes32(uint256(1)),
                keccak256("synthetic beneficiary"),
                child.enabledPot(),
                allocated,
                keccak256("synthetic award"),
                0
            );
            child.uploadAwards(awards);
        }
        bytes32 snapshot = keccak256("synthetic sporting snapshot");
        child.stageAllocation(
            snapshot,
            child.uploadDigest(),
            child.entitlementCount(),
            uint64(block.timestamp),
            uint64(block.timestamp),
            keccak256("synthetic final publication")
        );
        child.activate(child.allocationDigest(), snapshot);
        vm.stopPrank();
    }

    function testSeparateExpiredAndUnallocatedReturnsPreserveReservedAwardsAndPauseTime() public {
        Programme p = new Programme(config);
        _fund(p);
        Campaign child = p.campaigns(0);
        _activate(child, 21);
        vm.startPrank(operator);
        vm.expectRevert(Campaign.WrongState.selector);
        child.returnUnallocated();
        child.pause();
        vm.warp(block.timestamp + 2 days);
        child.resume();
        assertEq(child.claimDeadline(), block.timestamp + 7 days);
        vm.warp(child.claimDeadline());
        child.close();
        uint256 before = funder.balance;
        child.returnUnallocated();
        assertEq(treasury.balance, 10);
        assertEq(address(child).balance, 21);
        child.returnExpired();
        assertEq(funder.balance - before, 21);
        assertEq(child.treasuryReturned(), 31);
        vm.expectRevert(Campaign.NothingToReturn.selector);
        child.returnToTreasury();
        vm.stopPrank();
    }

    function testRejectedTreasuryDoesNotBlockIndependentExpiredReturn() public {
        config.unallocatedTreasury = payable(address(new V5RejectReturn()));
        Programme p = new Programme(config);
        _fund(p);
        Campaign child = p.campaigns(0);
        _activate(child, 21);
        vm.warp(child.claimDeadline());
        vm.startPrank(operator);
        child.close();
        vm.expectRevert(Campaign.TransferFailed.selector);
        child.returnUnallocated();
        assertEq(child.unallocatedReturned(), 0);
        child.returnExpired();
        assertEq(child.expiredReturned(), 21);
        assertEq(address(child).balance, 10);
        vm.stopPrank();
    }

    function testCancelledPotReturnsToSponsorNotExpiredTreasury() public {
        config.expiredTreasury = treasury;
        Programme p = new Programme(config);
        _fund(p);
        uint256 before = funder.balance;
        vm.startPrank(operator);
        p.campaigns(0).cancel();
        p.campaigns(0).returnToTreasury();
        vm.stopPrank();
        assertEq(funder.balance - before, 31);
        assertEq(treasury.balance, 0);
    }

    function testUnauthorizedWrongAmountAndCancellation() public {
        Programme p = new Programme(config);
        vm.expectRevert(Programme.Unauthorized.selector);
        p.fundProgramme();
        vm.startPrank(funder);
        vm.expectRevert(Programme.FundingUnavailable.selector);
        p.fundProgramme{value: 100}();
        p.cancelFunding();
        vm.expectRevert(Programme.FundingUnavailable.selector);
        p.fundProgramme{value: 101}();
        vm.stopPrank();
        assertFalse(p.funded());
        assertEq(p.campaigns(0).accountedFunding(), 0);
    }

    function testRejectsMainnetAndInconsistentEconomics() public {
        vm.chainId(1);
        vm.expectRevert(Programme.UnsupportedChain.selector);
        new Programme(config);
        vm.chainId(31337);
        config.caps[0]++;
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        new Programme(config);
        config.caps[0]--;
        config.claimLifetime = 3651 days;
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        new Programme(config);
    }

    function testFuzzConservationAcrossFlexibleCaps(uint96 total, uint16 share) public {
        total = uint96(bound(total, 1, 1_000_000 ether));
        share = uint16(bound(share, 0, 10000));
        config.budget = total;
        config.caps =
            [uint256(total) * share / 10000, uint256(0), 0, 0, 0, uint256(total) - uint256(total) * share / 10000];
        Programme p = new Programme(config);
        vm.deal(funder, total);
        _fund(p);
        assertEq(address(p.campaigns(0)).balance + address(p.campaigns(5)).balance, total);
        assertEq(address(p).balance, 0);
    }
}
