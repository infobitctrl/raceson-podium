// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {RacesOnRewardCampaignV6 as Campaign} from "../src/RacesOnRewardCampaignV6.sol";
import {RacesOnWalletRegistryV2 as Registry} from "../src/RacesOnWalletRegistryV2.sol";
import {TestRecipient} from "./RacesOnRewardCampaign.t.sol";

contract RacesOnDirectClaimsV6Test is Test {
    // Synthetic local signers only; never used or funded on a public chain.
    uint256 private constant ISSUER_KEY = 0xA001;
    uint256 private constant ATHLETE_KEY = 0xB001;
    address private reviewer;
    address private athlete;
    address private second;
    Registry private registry;
    Campaign private campaign;
    bytes32 private constant FIRST = bytes32(uint256(1));
    bytes32 private constant SECOND = bytes32(uint256(2));
    bytes32 private constant PERSON = bytes32(uint256(101));
    bytes32 private constant OTHER = bytes32(uint256(102));
    bytes32 private constant SNAPSHOT = keccak256("synthetic approved distribution");

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        reviewer = vm.addr(0xC001);
        athlete = vm.addr(ATHLETE_KEY);
        second = vm.addr(0xB002);
        registry = new Registry(vm.addr(ISSUER_KEY));
        campaign = _new();
        vm.deal(reviewer, 10 ether);
        _publish(campaign);
    }

    function _new() private returns (Campaign) {
        return new Campaign(
            reviewer,
            payable(reviewer),
            keccak256("programme"),
            keccak256("campaign"),
            keccak256("rules"),
            0,
            0,
            365 days,
            reviewer,
            payable(reviewer),
            payable(reviewer),
            address(registry)
        );
    }

    function _publish(Campaign target) private {
        vm.startPrank(reviewer);
        target.fund{value: 3 ether}();
        target.closeFunding();
        Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](2);
        awards[0] = Campaign.AwardInput(FIRST, PERSON, 0, 1 ether, keccak256("first"), 0);
        awards[1] = Campaign.AwardInput(SECOND, OTHER, 0, 2 ether, keccak256("second"), 0);
        target.uploadAwards(awards);
        target.stageAllocation(
            SNAPSHOT,
            target.uploadDigest(),
            2,
            uint64(block.timestamp),
            uint64(block.timestamp),
            keccak256("publication")
        );
        target.activate(target.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
    }

    function _signature(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _binding(bytes32 person, address recipient, uint256 nonce) private view returns (Registry.Binding memory) {
        return Registry.Binding(
            person, recipient, 0, nonce, uint64(block.timestamp), uint64(block.timestamp + 1 hours), bytes32(0)
        );
    }

    function _register(bytes32 person, address recipient, uint256 nonce) private {
        Registry.Binding memory binding = _binding(person, recipient, nonce);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(binding));
        vm.prank(recipient);
        registry.register(binding, proof);
    }

    function testWalletlessAwardSurvivesPublicationAndLateRegistrationClaimsWithoutReviewer() public {
        assertEq(registry.recipientOf(PERSON, 0), address(0));
        assertEq(campaign.allocated(0), 3 ether);
        assertEq(campaign.paid(0), 0);
        vm.prank(athlete);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claimDirect(FIRST);
        vm.warp(block.timestamp + 90 days);
        _register(PERSON, athlete, 0);
        vm.prank(athlete);
        campaign.claimDirect(FIRST);
        assertEq(athlete.balance, 1 ether);
        assertEq(campaign.paid(0), 1 ether);
        assertEq(address(campaign).balance, 2 ether);
        vm.prank(athlete);
        vm.expectRevert(Campaign.UnknownOrPaidEntitlement.selector);
        campaign.claimDirect(FIRST);
    }

    function testOtherWalletCannotRegisterOrClaimAnAthletesAward() public {
        Registry.Binding memory binding = _binding(PERSON, athlete, 0);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(binding));
        vm.prank(second);
        vm.expectRevert(Registry.RecipientRequired.selector);
        registry.register(binding, proof);
        _register(PERSON, athlete, 0);
        vm.prank(second);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claimDirect(FIRST);
        assertEq(campaign.paid(0), 0);
    }

    function testExplicitClaimCanRegisterAndPayAtomicallyWithoutASecondAthleteTransaction() public {
        Registry.Binding memory b = _binding(PERSON, athlete, 0);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(b));
        vm.prank(athlete);
        registry.registerAndClaim(b, proof, address(campaign), FIRST);
        assertEq(athlete.balance, 1 ether);
        assertEq(registry.recipientOf(PERSON, 0), athlete);
        assertEq(campaign.paid(0), 1 ether);
    }

    function testCombinedClaimCannotTakeAnotherAwardOrSpoofTheRegistry() public {
        Registry.Binding memory b = _binding(PERSON, athlete, 0);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(b));
        vm.prank(athlete);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        registry.registerAndClaim(b, proof, address(campaign), SECOND);
        assertEq(registry.recipientOf(PERSON, 0), address(0));
        vm.prank(athlete);
        vm.expectRevert(Campaign.Unauthorized.selector);
        campaign.claimFromRegistry(FIRST, athlete);
        assertEq(campaign.paid(0), 0);
    }

    function testOnlyPlatformIdentityProofAndCurrentNonceAllowWalletBinding() public {
        Registry.Binding memory binding = _binding(PERSON, athlete, 0);
        bytes memory wrong = _signature(ATHLETE_KEY, registry.bindingDigest(binding));
        vm.prank(athlete);
        vm.expectRevert(Registry.InvalidIdentityProof.selector);
        registry.register(binding, wrong);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(binding));
        vm.prank(athlete);
        registry.register(binding, proof);
        vm.prank(athlete);
        vm.expectRevert(Registry.InvalidBinding.selector);
        registry.register(binding, proof);
        binding = _binding(PERSON, second, 1);
        proof = _signature(ISSUER_KEY, registry.bindingDigest(binding));
        vm.warp(binding.expiresAt);
        vm.prank(second);
        vm.expectRevert(Registry.InvalidBinding.selector);
        registry.register(binding, proof);
    }

    function testBindingCannotReplayAcrossRegistriesOrChains() public {
        Registry.Binding memory binding = _binding(PERSON, athlete, 0);
        bytes memory proof = _signature(ISSUER_KEY, registry.bindingDigest(binding));
        Registry other = new Registry(vm.addr(ISSUER_KEY));
        vm.prank(athlete);
        vm.expectRevert(Registry.InvalidIdentityProof.selector);
        other.register(binding, proof);
        vm.chainId(10143);
        vm.prank(athlete);
        vm.expectRevert(Registry.InvalidIdentityProof.selector);
        registry.register(binding, proof);
    }

    function testExplicitReplacementRetiresOldWalletWithoutChangingAward() public {
        _register(PERSON, athlete, 0);
        _register(PERSON, second, 1);
        vm.prank(athlete);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claimDirect(FIRST);
        vm.prank(second);
        campaign.claimDirect(FIRST);
        assertEq(second.balance, 1 ether);
    }

    function testRelayNeedsOnlyRecipientConsentAndPaysOnlyRegisteredWallet() public {
        _register(PERSON, athlete, 0);
        uint64 issued = uint64(block.timestamp);
        uint64 expiry = issued + 1 hours;
        bytes memory consent = _signature(ATHLETE_KEY, campaign.claimDigest(FIRST, 0, issued, expiry));
        vm.prank(second);
        campaign.claim(FIRST, 0, issued, expiry, consent);
        assertEq(athlete.balance, 1 ether);
        assertEq(second.balance, 0);
    }

    function testRecipientConsentCannotReplayAcrossCampaignsOrChangedDestination() public {
        _register(PERSON, athlete, 0);
        uint64 issued = uint64(block.timestamp);
        uint64 expiry = issued + 1 hours;
        bytes memory consent = _signature(ATHLETE_KEY, campaign.claimDigest(FIRST, 0, issued, expiry));
        Campaign other = _new();
        _publish(other);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        other.claim(FIRST, 0, issued, expiry, consent);
        _register(PERSON, second, 1);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        campaign.claim(FIRST, 0, issued, expiry, consent);
    }

    function testRejectingReceiverRollsBackAndDoesNotBlockAnotherAthlete() public {
        TestRecipient receiver = new TestRecipient(athlete);
        _register(PERSON, address(receiver), 0);
        _register(OTHER, second, 0);
        receiver.configure(true, false, address(0), "");
        vm.prank(address(receiver));
        vm.expectRevert(Campaign.TransferFailed.selector);
        campaign.claimDirect(FIRST);
        assertEq(campaign.paid(0), 0);
        vm.prank(second);
        campaign.claimDirect(SECOND);
        assertEq(second.balance, 2 ether);
        receiver.configure(false, false, address(campaign), abi.encodeCall(campaign.claimDirect, (FIRST)));
        vm.prank(address(receiver));
        campaign.claimDirect(FIRST);
        assertFalse(receiver.reentrySucceeded());
        assertEq(address(receiver).balance, 1 ether);
    }

    function testPausePreservesClaimTimeAndExpiryStillClosesClaims() public {
        _register(PERSON, athlete, 0);
        uint256 deadline = campaign.claimDeadline();
        vm.prank(reviewer);
        campaign.pause();
        vm.prank(athlete);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.claimDirect(FIRST);
        vm.warp(block.timestamp + 2 days);
        vm.prank(reviewer);
        campaign.resume();
        assertEq(campaign.claimDeadline(), deadline + 2 days);
        vm.warp(campaign.claimDeadline());
        vm.prank(athlete);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        campaign.claimDirect(FIRST);
    }
}
