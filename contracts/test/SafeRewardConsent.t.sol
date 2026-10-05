// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";

interface ISafeFixture {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address handler,
        address token,
        uint256 payment,
        address payable receiver
    ) external;
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function VERSION() external view returns (string memory);
    function getMessageHash(bytes calldata data) external view returns (bytes32);
    function nonce() external view returns (uint256);
    function changeThreshold(uint256 threshold) external;
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce_
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool);
}

/// @dev Deploys original npm-package Safe 1.4.1 artifacts, not a simplified threshold mock.
///      Local compatibility evidence only: testnet deployment identity and browser UX remain gates.
contract SafeRewardConsentTest is Test {
    uint256 private constant OPERATOR_KEY = 0xA11CE;
    uint256 private constant FIRST_KEY = 0x1111;
    uint256 private constant SECOND_KEY = 0x2222;
    uint256 private constant THIRD_KEY = 0x3333;
    Campaign private campaign;
    ISafeFixture private safe;
    bytes private operatorProof;
    bytes32 private recipientHash;
    uint64 private issued;
    uint64 private expires;

    function setUp() public {
        vm.chainId(10143);
        vm.warp(1_800_000_000);
        address singleton =
            deployCode("node_modules/@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json");
        address handler = deployCode(
            "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json"
        );
        address proxy = deployCode(
            "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json",
            abi.encode(singleton)
        );
        safe = ISafeFixture(proxy);
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(FIRST_KEY);
        owners[1] = vm.addr(SECOND_KEY);
        owners[2] = vm.addr(THIRD_KEY);
        safe.setup(owners, 2, address(0), "", handler, address(0), 0, payable(address(0)));
        assertEq(safe.VERSION(), "1.4.1");
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        address operator = vm.addr(OPERATOR_KEY);
        campaign = _deployCampaign(operator);
        vm.deal(operator, 10 ether);
        Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](1);
        awards[0] = Campaign.AwardInput(
            bytes32(uint256(1)), bytes32(uint256(1001)), 1, 7 ether, keccak256("club breakdown"), 1
        );
        vm.startPrank(operator);
        campaign.fund{value: 10 ether}();
        campaign.closeFunding();
        campaign.uploadAwards(awards);
        _stageAllocation(
            campaign, keccak256("test snapshot"), campaign.uploadDigest(), 1, uint64(block.timestamp - 3 days)
        );
        vm.warp(campaign.activationNotBefore());
        campaign.activate(campaign.allocationDigest(), keccak256("test snapshot"));
        vm.stopPrank();
        issued = uint64(block.timestamp);
        expires = issued + 1 hours;
        (bytes32 approval, bytes32 receipt) =
            campaign.claimDigests(bytes32(uint256(1)), address(safe), 0, issued, expires);
        operatorProof = _sign(OPERATOR_KEY, approval);
        recipientHash = receipt;
    }

    /// @dev Protocol-specific staging hook; production v1/v2 artifacts stay unchanged.
    function _stageAllocation(Campaign target, bytes32 snapshot, bytes32 upload, uint256 count, uint64 publication)
        internal
        virtual
    {
        target.stageAllocation(snapshot, upload, count, publication);
    }

    function _deployCampaign(address operator) internal virtual returns (Campaign) {
        return new Campaign(
            operator,
            payable(address(this)),
            keccak256("test programme"),
            keccak256("test league"),
            keccak256("test rules"),
            1
        );
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _twoSignatures(bytes32 hash) private pure returns (bytes memory) {
        bytes memory first = _sign(FIRST_KEY, hash);
        bytes memory second = _sign(SECOND_KEY, hash);
        return vm.addr(FIRST_KEY) < vm.addr(SECOND_KEY) ? bytes.concat(first, second) : bytes.concat(second, first);
    }

    function _claim(bytes memory consent) private {
        campaign.claim(bytes32(uint256(1)), payable(address(safe)), 0, issued, expires, operatorProof, consent);
    }

    function _safeMessageHash() private view returns (bytes32) {
        // Safe's exact fallback handler wraps the application digest in SafeMessage(bytes message).
        return safe.getMessageHash(abi.encode(recipientHash));
    }

    function testOriginalSafeArtifactsReceiveWithTwoOfThreeOwners() public {
        bytes memory consent = _twoSignatures(_safeMessageHash());
        assertEq(IERC1271(address(safe)).isValidSignature(recipientHash, consent), IERC1271.isValidSignature.selector);
        _claim(consent);
        assertEq(address(safe).balance, 7 ether);
        assertEq(campaign.paid(1), 7 ether);
    }

    function testSingleOwnerAndRawApplicationSignaturesDoNotAuthorizeClubReceipt() public {
        bytes memory single = _sign(FIRST_KEY, _safeMessageHash());
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        _claim(single);
        bytes memory raw = _twoSignatures(recipientHash);
        vm.expectRevert(Campaign.InvalidRecipientSignature.selector);
        _claim(raw);
        assertEq(address(safe).balance, 0);
    }

    function testWeakeningAnApprovedSafeThresholdBlocksPayout() public {
        bytes memory consent = _twoSignatures(_safeMessageHash());
        bytes memory change = abi.encodeCall(safe.changeThreshold, (1));
        bytes32 txHash =
            safe.getTransactionHash(address(safe), 0, change, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        assertTrue(
            safe.execTransaction(
                address(safe), 0, change, 0, 0, 0, 0, address(0), payable(address(0)), _twoSignatures(txHash)
            )
        );
        assertEq(safe.getThreshold(), 1);
        vm.expectRevert(Campaign.InvalidClubTreasury.selector);
        _claim(consent);
        assertEq(campaign.paid(1), 0);
    }

    function testClubEntitlementCannotBeDirectedToAnEOA() public {
        address payable eoa = payable(vm.addr(FIRST_KEY));
        (bytes32 approval, bytes32 receipt) = campaign.claimDigests(bytes32(uint256(1)), eoa, 0, issued, expires);
        bytes memory first = _sign(OPERATOR_KEY, approval);
        bytes memory second = _sign(FIRST_KEY, receipt);
        vm.expectRevert(Campaign.InvalidClubTreasury.selector);
        campaign.claim(bytes32(uint256(1)), eoa, 0, issued, expires, first, second);
    }
}
