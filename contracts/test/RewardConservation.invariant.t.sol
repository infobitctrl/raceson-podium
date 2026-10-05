// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";

contract InvariantForceTestMon {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

/// @dev Stateful local adversary. Ghost accounting follows observed successful actions,
///      never reads the contract's paid/returned counters to construct the expected totals.
contract RewardActionHandler is Test {
    Campaign public immutable campaign;
    address public immutable operator;
    uint256 private constant OPERATOR_KEY = 0xA11CE;
    uint256 private constant ATHLETE_KEY = 0xB0B;
    uint256 public ghostPaid;
    uint256 public ghostReturned;
    uint256 public ghostForced;
    uint256 public ghostSurplusReturned;

    constructor(Campaign campaign_) {
        campaign = campaign_;
        operator = vm.addr(OPERATOR_KEY);
    }

    function advanceTime(uint32 seconds_) external {
        vm.warp(block.timestamp + uint256(seconds_ % uint32(60 days)));
    }

    function togglePause() external {
        if (campaign.state() != Campaign.State.Active) return;
        bool isPaused = campaign.paused();
        if (!isPaused && block.timestamp >= campaign.claimDeadline()) return;
        vm.prank(operator);
        if (isPaused) campaign.resume();
        else campaign.pause();
    }

    function revoke(uint8 seed) external {
        bytes32 id = bytes32(uint256(seed % 2) + 1);
        (,,,,,, bool isPaid,) = campaign.entitlements(id);
        if (campaign.state() != Campaign.State.Active || isPaid) return;
        vm.prank(operator);
        campaign.revokeAuthorization(id);
    }

    function tryClaim(uint8 seed) external {
        bytes32 id = bytes32(uint256(seed % 2) + 1);
        (, uint256 amount,, uint256 nonce,,, bool isPaid,) = campaign.entitlements(id);
        bool expectedSuccess = campaign.state() == Campaign.State.Active && !campaign.paused()
            && block.timestamp < campaign.claimDeadline() && !isPaid;
        address payable recipient = payable(vm.addr(ATHLETE_KEY));
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes32 approvalHash, bytes32 receiptHash) = campaign.claimDigests(id, recipient, nonce, issued, expires);
        bytes memory first = _sign(OPERATOR_KEY, approvalHash);
        bytes memory second = _sign(ATHLETE_KEY, receiptHash);
        try campaign.claim(id, recipient, nonce, issued, expires, first, second) {
            require(expectedSuccess, "claim succeeded outside eligible state");
            ghostPaid += amount;
        } catch {
            require(!expectedSuccess, "valid claim failed");
        }
    }

    function tryCloseAndReturn() external {
        if (
            campaign.state() == Campaign.State.Active && !campaign.paused()
                && block.timestamp >= campaign.claimDeadline()
        ) {
            vm.prank(operator);
            campaign.close();
        }
        bool expectedSuccess = campaign.state() == Campaign.State.Closed && 12 ether > ghostPaid + ghostReturned;
        vm.prank(operator);
        try campaign.returnToTreasury() {
            require(expectedSuccess, "treasury consumed unexpired liability");
            ghostReturned += 12 ether - ghostPaid - ghostReturned;
        } catch {
            require(!expectedSuccess, "terminal return failed");
        }
    }

    function forceTokens(uint64 amount_) external {
        uint256 amount = uint256(amount_) + 1;
        vm.deal(address(this), amount);
        new InvariantForceTestMon{value: amount}(payable(address(campaign)));
        ghostForced += amount;
    }

    function trySurplusReturn() external {
        bool expectedSuccess = campaign.state() == Campaign.State.Closed && ghostForced > ghostSurplusReturned;
        vm.prank(operator);
        try campaign.returnSurplus() {
            require(expectedSuccess, "surplus returned outside terminal state");
            ghostSurplusReturned = ghostForced;
        } catch {
            require(!expectedSuccess, "surplus return failed");
        }
    }

    function _sign(uint256 key, bytes32 hash) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, hash);
        return abi.encodePacked(r, s, v);
    }
}

contract RewardConservationInvariantTest is Test {
    Campaign private campaign;
    RewardActionHandler private handler;
    address payable private treasury;

    function setUp() public {
        vm.chainId(10143);
        vm.warp(1_800_000_000);
        address operator = vm.addr(0xA11CE);
        treasury = payable(vm.addr(0x777));
        campaign = _deployCampaign(operator, treasury);
        vm.deal(operator, 12 ether);
        vm.startPrank(operator);
        campaign.fund{value: 12 ether}();
        campaign.closeFunding();
        Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](2);
        awards[0] = Campaign.AwardInput(bytes32(uint256(1)), bytes32(uint256(1001)), 0, 5 ether, keccak256("first"), 0);
        awards[1] = Campaign.AwardInput(bytes32(uint256(2)), bytes32(uint256(1002)), 0, 3 ether, keccak256("second"), 0);
        campaign.uploadAwards(awards);
        _stageAllocation(
            campaign, keccak256("test snapshot"), campaign.uploadDigest(), 2, uint64(block.timestamp - 3 days)
        );
        vm.warp(campaign.activationNotBefore());
        campaign.activate(campaign.allocationDigest(), keccak256("test snapshot"));
        vm.stopPrank();
        handler = new RewardActionHandler(campaign);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.advanceTime.selector;
        selectors[1] = handler.togglePause.selector;
        selectors[2] = handler.revoke.selector;
        selectors[3] = handler.tryClaim.selector;
        selectors[4] = handler.tryCloseAndReturn.selector;
        selectors[5] = handler.forceTokens.selector;
        selectors[6] = handler.trySurplusReturn.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Protocol-specific staging hook; production v1/v2 artifacts stay unchanged.
    function _stageAllocation(Campaign target, bytes32 snapshot, bytes32 upload, uint256 count, uint64 publication)
        internal
        virtual
    {
        target.stageAllocation(snapshot, upload, count, publication);
    }

    function _deployCampaign(address operator, address payable destination) internal virtual returns (Campaign) {
        return new Campaign(
            operator, destination, keccak256("test programme"), keccak256("test campaign"), keccak256("test rules"), 0
        );
    }

    function invariantPaidNeverExceedsReservedAndInactivePotStaysZero() public view {
        assertEq(campaign.accountedFunding(), 12 ether);
        assertEq(campaign.allocated(0), 8 ether);
        assertLe(campaign.paid(0), campaign.allocated(0));
        assertLe(campaign.allocated(0), campaign.budgets(0));
        assertEq(campaign.budgets(1), 0);
        assertEq(campaign.allocated(1), 0);
        assertEq(campaign.paid(1), 0);
    }

    function invariantEveryWeiMatchesIndependentActionAccounting() public view {
        assertEq(campaign.paid(0), handler.ghostPaid());
        assertEq(campaign.treasuryReturned(), handler.ghostReturned());
        assertEq(vm.addr(0xB0B).balance, handler.ghostPaid());
        assertEq(treasury.balance, handler.ghostReturned() + handler.ghostSurplusReturned());
        assertEq(
            address(campaign).balance + handler.ghostPaid() + handler.ghostReturned() + handler.ghostSurplusReturned(),
            12 ether + handler.ghostForced()
        );
        if (campaign.state() == Campaign.State.Active) {
            assertEq(campaign.treasuryReturned(), 0);
            assertGe(address(campaign).balance, campaign.allocated(0) - campaign.paid(0));
        }
    }
}
