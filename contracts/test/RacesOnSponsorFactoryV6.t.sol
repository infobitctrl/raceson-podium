// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnWalletRegistryV2 as Registry} from "../src/RacesOnWalletRegistryV2.sol";
import {Test} from "forge-std/Test.sol";
import {RacesOnSponsorFactoryV6 as Factory} from "../src/RacesOnSponsorFactoryV6.sol";
import {RacesOnRewardProgrammeV6 as Programme} from "../src/RacesOnRewardProgrammeV6.sol";
import {RacesOnRewardCampaignV6 as Campaign} from "../src/RacesOnRewardCampaignV6.sol";

contract RacesOnSponsorFactoryV6Test is Test {
    function testPermissionlessIdempotentCreationPreservesSponsorAndController() public {
        vm.chainId(10143);
        Factory f = new Factory();
        Programme.Configuration memory c;
        c.funder = payable(makeAddr("sponsor"));
        c.operator = makeAddr("controller");
        c.walletRegistry = address(new Registry(makeAddr("identity issuer")));
        c.unallocatedTreasury = payable(makeAddr("treasury"));
        c.expiredTreasury = c.funder;
        c.programmeId = keccak256("programme");
        c.manifestHash = keccak256("manifest");
        c.budget = 100 ether;
        c.claimLifetime = 365 days;
        c.caps[0] = c.budget;
        for (uint8 i; i < 6; i++) {
            c.campaignIds[i] = keccak256(abi.encode(i));
        }
        vm.deal(c.funder, c.budget);
        vm.prank(c.operator);
        address a = f.deploy(c);
        vm.prank(makeAddr("any other sponsor"));
        assertEq(f.deploy(c), a);
        assertEq(c.funder.balance, c.budget);
        Programme p = Programme(a);
        assertEq(p.funder(), c.funder);
        assertEq(p.operator(), c.operator);
        assertFalse(p.funded());
        vm.prank(c.funder);
        p.fundProgramme{value: c.budget}();
        Campaign child = p.campaigns(0);
        assertEq(child.accountedFunding(), c.budget);
        assertEq(uint256(child.state()), uint256(Campaign.State.Review));
        vm.prank(address(f));
        vm.expectRevert(Campaign.Unauthorized.selector);
        child.pause();
        (bool valueAccepted,) = address(f).call{value: 1}(abi.encodeCall(f.deploy, (c)));
        assertFalse(valueAccepted);
        (bool forwarded,) = address(f)
            .call(abi.encodeWithSignature("execute(address,bytes)", address(child), abi.encodeCall(child.pause, ())));
        assertFalse(forwarded);
        assertEq(address(f).balance, 0);
        c.manifestHash = keccak256("different manifest");
        assertTrue(f.deploy(c) != a);
    }

    function testMainnetRefused() public {
        vm.chainId(143);
        vm.expectRevert(Factory.UnsupportedChain.selector);
        new Factory();
    }
}
