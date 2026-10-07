// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {ISafeFixture} from "./SafeRewardConsent.t.sol";
import {RacesOnWalletRegistryV1 as Registry} from "../src/RacesOnWalletRegistryV1.sol";
import {RacesOnRewardCampaignV5 as Campaign} from "../src/RacesOnRewardCampaignV5.sol";

/// Original Safe 1.4.1 artifacts; all people and signatures are synthetic local fixtures.
contract SafeDirectClaimsV5Test is Test {
    uint256 private constant ISSUER = 0xA001;
    uint256 private constant FIRST = 0x1111;
    uint256 private constant SECOND = 0x2222;
    ISafeFixture private safe;
    Registry private registry;
    Campaign private campaign;
    bytes32 private constant CLUB = bytes32(uint256(101));
    bytes32 private constant AWARD = bytes32(uint256(1));

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        address singleton =
            deployCode("node_modules/@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json");
        address handler = deployCode(
            "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json"
        );
        safe = ISafeFixture(
            deployCode(
                "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json",
                abi.encode(singleton)
            )
        );
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(FIRST);
        owners[1] = vm.addr(SECOND);
        owners[2] = vm.addr(0x3333);
        safe.setup(owners, 2, address(0), "", handler, address(0), 0, payable(address(0)));
        assertEq(safe.VERSION(), "1.4.1");
        registry = new Registry(vm.addr(ISSUER));
        address reviewer = vm.addr(0xC001);
        campaign = new Campaign(
            reviewer,
            payable(reviewer),
            keccak256("programme"),
            keccak256("campaign"),
            keccak256("rules"),
            1,
            0,
            365 days,
            reviewer,
            payable(reviewer),
            payable(reviewer),
            address(registry)
        );
        vm.deal(reviewer, 1 ether);
        vm.startPrank(reviewer);
        campaign.fund{value: 1 ether}();
        campaign.closeFunding();
        Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](1);
        awards[0] = Campaign.AwardInput(AWARD, CLUB, 1, 1 ether, keccak256("club award"), 1);
        campaign.uploadAwards(awards);
        campaign.stageAllocation(
            keccak256("snapshot"),
            campaign.uploadDigest(),
            1,
            uint64(block.timestamp),
            uint64(block.timestamp),
            keccak256("publication")
        );
        campaign.activate(campaign.allocationDigest(), keccak256("snapshot"));
        vm.stopPrank();
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _two(bytes32 digest) private pure returns (bytes memory) {
        bytes memory a = _sign(FIRST, digest);
        bytes memory b = _sign(SECOND, digest);
        return vm.addr(FIRST) < vm.addr(SECOND) ? bytes.concat(a, b) : bytes.concat(b, a);
    }

    function _hash(address to, bytes memory data) private view returns (bytes32) {
        return safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
    }

    function _execute(address to, bytes memory data, bytes memory signatures) private returns (bool) {
        return safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
    }

    function _registration() private returns (bytes memory) {
        Registry.Binding memory b =
            Registry.Binding(CLUB, address(safe), 1, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours));
        return abi.encodeCall(registry.register, (b, _sign(ISSUER, registry.bindingDigest(b))));
    }

    function _register() private {
        bytes memory data = _registration();
        assertTrue(_execute(address(registry), data, _two(_hash(address(registry), data))));
    }

    function testTwoOwnersRegisterAndClaimWithoutReviewer() public {
        _register();
        bytes memory data = abi.encodeCall(campaign.claimDirect, (AWARD));
        assertTrue(_execute(address(campaign), data, _two(_hash(address(campaign), data))));
        assertEq(address(safe).balance, 1 ether);
        assertEq(campaign.paid(1), 1 ether);
    }

    function testOneOwnerCannotRegisterOrClaim() public {
        bytes memory data = _registration();
        bytes memory signature = _sign(FIRST, _hash(address(registry), data));
        vm.expectRevert();
        _execute(address(registry), data, signature);
        assertEq(registry.recipientOf(CLUB, 1), address(0));
        _register();
        data = abi.encodeCall(campaign.claimDirect, (AWARD));
        signature = _sign(FIRST, _hash(address(campaign), data));
        vm.expectRevert();
        _execute(address(campaign), data, signature);
        assertEq(campaign.paid(1), 0);
    }

    function testRecipientRelayUsesOnlyTwoOwnerConsent() public {
        _register();
        uint64 issued = uint64(block.timestamp);
        uint64 expiry = issued + 1 hours;
        bytes32 digest = campaign.claimDigest(AWARD, 0, issued, expiry);
        bytes memory consent = _two(safe.getMessageHash(abi.encode(digest)));
        campaign.claim(AWARD, 0, issued, expiry, consent);
        assertEq(address(safe).balance, 1 ether);
    }

    function testChangedThresholdAndEOATreasuriesAreRejected() public {
        _register();
        bytes memory data = abi.encodeCall(safe.changeThreshold, (1));
        assertTrue(_execute(address(safe), data, _two(_hash(address(safe), data))));
        vm.expectRevert(Campaign.InvalidClubTreasury.selector);
        campaign.claimDigest(AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours));
        Registry.Binding memory b =
            Registry.Binding(CLUB, vm.addr(FIRST), 1, 1, uint64(block.timestamp), uint64(block.timestamp + 1 hours));
        bytes memory proof = _sign(ISSUER, registry.bindingDigest(b));
        vm.prank(vm.addr(FIRST));
        registry.register(b, proof);
        vm.prank(vm.addr(FIRST));
        vm.expectRevert(Campaign.InvalidClubTreasury.selector);
        campaign.claimDirect(AWARD);
        assertEq(campaign.paid(1), 0);
    }
}
