// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ClubSignaturePolicyV1} from "../src/ClubSignaturePolicyV1.sol";

import {Test} from "forge-std/Test.sol";
import {ISafeFixture} from "./SafeRewardConsent.t.sol";
import {RacesOnWalletRegistryV3 as Registry} from "../src/RacesOnWalletRegistryV3.sol";
import {RacesOnRewardCampaignV7 as Campaign} from "../src/RacesOnRewardCampaignV7.sol";

/// Original Safe 1.4.1 artifacts; all people and signatures are synthetic local fixtures.
contract SafeClubSignaturesV7Test is Test {
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
        Registry.Binding memory b = Registry.Binding(
            CLUB,
            address(safe),
            1,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        return abi.encodeCall(registry.register, (b, _sign(ISSUER, registry.bindingDigest(b))));
    }

    function _register() private {
        bytes memory data = _registration();
        assertTrue(_execute(address(registry), data, _two(_hash(address(registry), data))));
    }

    function _claim(bytes memory signatures) private {
        campaign.claimClub(AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours), signatures);
    }

    function _digest() private view returns (bytes32) {
        return campaign.clubClaimDigest(AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours));
    }

    function testTwoFreshOwnersPayExactlyOnceToTreasuryWithUntrustedGasPayer() public {
        _register();
        bytes memory signatures = _two(_digest());
        vm.prank(vm.addr(0x9999));
        _claim(signatures);
        assertEq(address(safe).balance, 1 ether);
        assertEq(campaign.paid(1), 1 ether);
        vm.expectRevert(Campaign.UnknownOrPaidEntitlement.selector);
        _claim(signatures);
    }

    function testSingleDuplicateOutsiderUnsortedAndSafeApprovedHashSignaturesFail() public {
        _register();
        bytes32 digest = _digest();
        bytes memory a = _sign(FIRST, digest);
        bytes memory b = _sign(SECOND, digest);
        bytes[] memory invalid = new bytes[](7);
        invalid[0] = a;
        invalid[1] = bytes.concat(a, a);
        invalid[2] = bytes.concat(a, _sign(0x9999, digest));
        invalid[3] = vm.addr(FIRST) < vm.addr(SECOND) ? bytes.concat(b, a) : bytes.concat(a, b);
        invalid[4] = bytes.concat(
            abi.encodePacked(uint256(uint160(vm.addr(FIRST))), bytes32(0), uint8(1)),
            abi.encodePacked(uint256(uint160(vm.addr(SECOND))), bytes32(0), uint8(1))
        );
        invalid[5] = _two(safe.getMessageHash(abi.encode(digest))); // EIP-1271 Safe wrapper is not owner typed consent.
        invalid[6] = bytes.concat(_two(digest), hex"00");
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(ClubSignaturePolicyV1.TwoFreshOwnerSignaturesRequired.selector);
            _claim(invalid[i]);
        }
        assertEq(address(campaign).balance, 1 ether);
        assertEq(campaign.paid(1), 0);
        _claim(_two(digest));
    }

    function testModuleCannotUseDirectRegistryOrRecipientRelayPaths() public {
        _register();
        ClaimModuleV7 module = new ClaimModuleV7();
        bytes memory enable = abi.encodeWithSignature("enableModule(address)", address(module));
        assertTrue(_execute(address(safe), enable, _two(_hash(address(safe), enable))));
        assertFalse(module.execute(address(safe), address(campaign), abi.encodeCall(campaign.claimDirect, (AWARD))));
        bytes memory relay = abi.encodeCall(
            campaign.claim, (AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours), bytes(""))
        );
        assertFalse(module.execute(address(safe), address(campaign), relay));
        Registry.Binding memory b = Registry.Binding(
            CLUB,
            address(safe),
            1,
            1,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        bytes memory forwarded = abi.encodeCall(
            registry.registerAndClaim, (b, _sign(ISSUER, registry.bindingDigest(b)), address(campaign), AWARD)
        );
        assertFalse(module.execute(address(safe), address(registry), forwarded));
        (, uint256 generation) = registry.clubPolicyOf(CLUB);
        assertEq(generation, 1); // Failed forwarding also rolls back registration.
        vm.prank(address(registry));
        vm.expectRevert(Campaign.ClubOwnerSignaturesRequired.selector);
        campaign.claimFromRegistry(AWARD, address(safe));
        assertEq(campaign.paid(1), 0);
        // Even an enabled module may submit genuine fresh consent, but cannot replace it.
        bytes memory consent = abi.encodeCall(
            campaign.claimClub, (AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours), _two(_digest()))
        );
        assertTrue(module.execute(address(safe), address(campaign), consent));
        assertEq(address(safe).balance, 1 ether);
    }

    function testOwnerSwapCannotReplaceIssuerPinnedOwners() public {
        _register();
        bytes memory signatures = _two(_digest());
        address[] memory owners = safe.getOwners();
        bytes memory swap =
            abi.encodeWithSignature("swapOwner(address,address,address)", address(1), owners[0], vm.addr(0x9999));
        assertTrue(_execute(address(safe), swap, _two(_hash(address(safe), swap))));
        vm.expectRevert(Campaign.InvalidClubTreasury.selector);
        _claim(signatures);
        assertEq(campaign.paid(1), 0);
    }

    function testChangedThresholdFailsClosed() public {
        _register();
        bytes memory signatures = _two(_digest());
        bytes memory data = abi.encodeCall(safe.changeThreshold, (1));
        assertTrue(_execute(address(safe), data, _two(_hash(address(safe), data))));
        vm.expectRevert(ClubSignaturePolicyV1.InvalidClubPolicy.selector);
        _claim(signatures);
    }

    function testSameTreasuryRebindingRetiresPreviouslySignedClaim() public {
        _register();
        bytes memory signatures = _two(_digest());
        Registry.Binding memory b = Registry.Binding(
            CLUB,
            address(safe),
            1,
            1,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        bytes memory data = abi.encodeCall(registry.register, (b, _sign(ISSUER, registry.bindingDigest(b))));
        assertTrue(_execute(address(registry), data, _two(_hash(address(registry), data))));
        vm.expectRevert(ClubSignaturePolicyV1.TwoFreshOwnerSignaturesRequired.selector);
        _claim(signatures);
        _claim(_two(_digest()));
    }

    function testClaimExpiryFutureTimeLifetimeNonceAndCrossChainReplay() public {
        _register();
        uint64 issued = uint64(block.timestamp);
        uint64 expiry = issued + 1 hours;
        bytes memory signatures = _two(_digest());
        vm.chainId(10143);
        vm.expectRevert(ClubSignaturePolicyV1.TwoFreshOwnerSignaturesRequired.selector);
        _claim(signatures);
        vm.chainId(31337);
        vm.expectRevert(Campaign.InvalidNonce.selector);
        campaign.claimClub(AWARD, 1, issued, expiry, signatures);
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claimClub(AWARD, 0, issued + 1, expiry, signatures);
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claimClub(AWARD, 0, issued, issued + 2 days + 1, signatures);
        vm.warp(expiry);
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claimClub(AWARD, 0, issued, expiry, signatures);
        assertEq(campaign.paid(1), 0);
    }

    function testRevocationRetiresUnusedClubConsent() public {
        _register();
        bytes memory signatures = _two(_digest());
        vm.prank(campaign.operator());
        campaign.revokeAuthorization(AWARD);
        vm.expectRevert(Campaign.InvalidNonce.selector);
        _claim(signatures);
        uint64 issued = uint64(block.timestamp);
        uint64 expiry = issued + 1 hours;
        campaign.claimClub(AWARD, 1, issued, expiry, _two(campaign.clubClaimDigest(AWARD, 1, issued, expiry)));
        assertEq(address(safe).balance, 1 ether);
    }

    function testRejectingClubReceiverRollsBackNonceAndReentryCannotPayTwice() public {
        address[] memory members = safe.getOwners();
        SmallClubTreasuryV7 receiver = new SmallClubTreasuryV7(members, 2);
        Registry.Binding memory b = Registry.Binding(
            CLUB,
            address(receiver),
            1,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            ClubSignaturePolicyV1.ownersHash(address(receiver))
        );
        bytes memory proof = _sign(ISSUER, registry.bindingDigest(b));
        vm.prank(address(receiver));
        registry.register(b, proof);
        bytes memory signatures = _two(_digest());
        receiver.configure(true, address(0), "");
        vm.expectRevert(Campaign.TransferFailed.selector);
        _claim(signatures);
        (,,, uint256 nonce,,, bool paid,) = campaign.entitlements(AWARD);
        assertEq(nonce, 0);
        assertFalse(paid);
        assertEq(campaign.paid(1), 0);
        bytes memory reentry = abi.encodeCall(
            campaign.claimClub, (AWARD, 0, uint64(block.timestamp), uint64(block.timestamp + 1 hours), signatures)
        );
        receiver.configure(false, address(campaign), reentry);
        _claim(signatures);
        assertFalse(receiver.reentrySucceeded());
        assertEq(address(receiver).balance, 1 ether);
        assertEq(campaign.paid(1), 1 ether);
    }

    function testIssuerProofCannotBeEditedToPinAnotherOwnerSet() public {
        Registry.Binding memory b = Registry.Binding(
            CLUB,
            address(safe),
            1,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        bytes memory proof = _sign(ISSUER, registry.bindingDigest(b));
        b.clubOwnersHash = keccak256("different owners");
        vm.prank(address(safe));
        vm.expectRevert(Registry.InvalidIdentityProof.selector);
        registry.register(b, proof);
        assertEq(registry.recipientOf(CLUB, 1), address(0));
    }

    function testOneAndTwoMemberClubsKeepAwardsWithoutInventingThirdOwner() public {
        // Synthetic one- and two-member treasuries cannot satisfy the 2-of-3 policy.
        for (uint256 count = 1; count <= 2; ++count) {
            address[] memory members = new address[](count);
            members[0] = vm.addr(FIRST);
            if (count == 2) members[1] = vm.addr(SECOND);
            SmallClubTreasuryV7 small = new SmallClubTreasuryV7(members, count);
            Registry.Binding memory b = Registry.Binding(
                CLUB,
                address(small),
                1,
                0,
                uint64(block.timestamp),
                uint64(block.timestamp + 1 hours),
                keccak256(abi.encode(members))
            );
            bytes memory proof = _sign(ISSUER, registry.bindingDigest(b));
            vm.prank(address(small));
            vm.expectRevert(ClubSignaturePolicyV1.InvalidClubPolicy.selector);
            registry.register(b, proof);
            assertEq(registry.recipientOf(CLUB, 1), address(0));
            assertEq(campaign.allocated(1), 1 ether);
            assertEq(campaign.paid(1), 0);
            assertEq(address(campaign).balance, 1 ether);
        }
        vm.warp(block.timestamp + 30 days);
        _register(); // Three synthetic members now ready; original award is unchanged.
        _claim(_two(_digest()));
        assertEq(address(safe).balance, 1 ether);
    }

    function testClubApprovalsRemainExecutableAfterTenMinutesWithin48Hours() public {
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 48 hours;
        Registry.Binding memory b = Registry.Binding(
            CLUB, address(safe), 1, 0, issued, expires, ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        bytes memory data = abi.encodeCall(registry.register, (b, _sign(ISSUER, registry.bindingDigest(b))));
        bytes memory signatures = _two(_hash(address(registry), data));
        vm.warp(uint256(issued) + 47 hours);
        assertTrue(_execute(address(registry), data, signatures));
        issued = uint64(block.timestamp);
        expires = issued + 48 hours;
        signatures = _two(campaign.clubClaimDigest(AWARD, 0, issued, expires));
        vm.warp(uint256(issued) + 47 hours);
        campaign.claimClub(AWARD, 0, issued, expires, signatures);
        assertEq(campaign.paid(1), 1 ether);
        assertEq(address(safe).balance, 1 ether);
    }

    function testClubAuthorizationLongerThan48HoursIsRejected() public {
        uint64 issued = uint64(block.timestamp);
        Registry.Binding memory b = Registry.Binding(
            CLUB, address(safe), 1, 0, issued, issued + 48 hours + 1, ClubSignaturePolicyV1.ownersHash(address(safe))
        );
        bytes memory proof = _sign(ISSUER, registry.bindingDigest(b));
        vm.prank(address(safe));
        vm.expectRevert(Registry.InvalidBinding.selector);
        registry.register(b, proof);
        _register();
        bytes memory signatures = _two(campaign.clubClaimDigest(AWARD, 0, issued, issued + 48 hours + 1));
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claimClub(AWARD, 0, issued, issued + 48 hours + 1, signatures);
    }

    function testClubClaimRejectsExact48HourExpiry() public {
        _register();
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 48 hours;
        bytes memory signatures = _two(campaign.clubClaimDigest(AWARD, 0, issued, expires));
        vm.warp(expires);
        vm.expectRevert(Campaign.InvalidAuthorizationTime.selector);
        campaign.claimClub(AWARD, 0, issued, expires, signatures);
        assertEq(campaign.paid(1), 0);
    }
}

interface IModuleSafeV7 {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool);
}

contract ClaimModuleV7 {
    function execute(address safe, address to, bytes memory data) external returns (bool) {
        return IModuleSafeV7(safe).execTransactionFromModule(to, 0, data, 0);
    }
}

contract SmallClubTreasuryV7 {
    address[] private members;
    uint256 private threshold;
    bool private rejectPayment;
    address private reentryTarget;
    bytes private reentryData;
    bool public reentrySucceeded;

    function configure(bool reject_, address target_, bytes memory data_) external {
        rejectPayment = reject_;
        reentryTarget = target_;
        reentryData = data_;
    }

    receive() external payable {
        require(!rejectPayment, "synthetic receiver rejection");
        if (reentryTarget != address(0)) (reentrySucceeded,) = reentryTarget.call(reentryData);
    }

    constructor(address[] memory members_, uint256 threshold_) {
        members = members_;
        threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return members;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}
