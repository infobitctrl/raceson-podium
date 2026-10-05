// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {RacesOnRewardProgrammeV3 as Programme} from "../src/RacesOnRewardProgrammeV3.sol";
import {RacesOnRewardCampaignV3 as Campaign} from "../src/RacesOnRewardCampaignV3.sol";
import {ProgrammeForceMon} from "./RacesOnRewardProgrammeV3.t.sol";

/// @dev Only synthetic local callers and balances. Models funding/refund state,
///      not sporting truth or recipient consent (covered by campaign tests).
contract ProgrammeFundingHandler is Test {
    Programme public immutable programme;
    address payable private immutable funder;
    address private immutable operator;
    uint256 public deposits;
    uint256 public routed;
    uint256 public refunds;
    uint256 public returnedFunding;
    uint256 public withdrawals;
    uint256 public forced;
    uint256 public surplusWithdrawn;
    bool[6] public sent;

    constructor(Programme p, address payable f, address o) {
        programme = p;
        funder = f;
        operator = o;
    }

    function deposit(uint96 raw) external {
        uint256 remaining = programme.budget() - deposits;
        if (programme.fundingAborted() || remaining == 0) return;
        uint256 amount = bound(uint256(raw), 1, remaining);
        vm.prank(funder);
        programme.deposit{value: amount}(deposits);
        deposits += amount;
    }

    function route(uint8 raw) external {
        uint8 slot = uint8(bound(raw, 0, 5));
        Campaign child = programme.campaigns(slot);
        uint256 amount = programme.caps(slot);
        if (
            programme.fundingAborted() || sent[slot] || deposits - routed - refunds < amount
                || child.state() != Campaign.State.Funding
        ) return;
        vm.prank(operator);
        programme.routePot(slot);
        sent[slot] = true;
        routed += amount;
    }

    function cancel(uint8 raw) external {
        Campaign child = programme.campaigns(uint8(bound(raw, 0, 5)));
        if (child.state() != Campaign.State.Funding) return;
        vm.prank(operator);
        child.cancel();
    }

    function returnPot(uint8 raw) external {
        Campaign child = programme.campaigns(uint8(bound(raw, 0, 5)));
        uint256 amount = child.accountedFunding() - child.treasuryReturned();
        if (child.state() != Campaign.State.Cancelled || amount == 0) return;
        vm.prank(operator);
        child.returnToTreasury();
        returnedFunding += amount;
    }

    function abort() external {
        if (programme.fundingAborted()) return;
        vm.prank(funder);
        programme.abortFunding();
    }

    function refund() external {
        uint256 amount = deposits - routed - refunds;
        if (!programme.fundingAborted() || amount == 0) return;
        vm.prank(funder);
        programme.refundUnrouted();
        refunds += amount;
    }

    function withdraw() external {
        uint256 amount = returnedFunding - withdrawals;
        if (amount == 0) return;
        vm.prank(funder);
        programme.withdrawReturns(returnedFunding);
        withdrawals += amount;
    }

    function force(uint96 raw) external {
        uint256 amount = bound(uint256(raw), 1, 1 ether);
        vm.deal(address(this), amount);
        new ProgrammeForceMon{value: amount}(payable(address(programme)));
        forced += amount;
    }

    function withdrawSurplus() external {
        if (!programme.fundingAborted() || forced == surplusWithdrawn) return;
        for (uint8 i; i < 6; i++) {
            if (programme.campaigns(i).state() != Campaign.State.Cancelled) return;
        }
        vm.prank(funder);
        programme.withdrawSurplus();
        surplusWithdrawn = forced;
    }
}

contract RacesOnRewardProgrammeV3InvariantTest is Test {
    Programme private programme;
    ProgrammeFundingHandler private handler;

    function setUp() public {
        if (block.chainid != 10143) vm.chainId(31337);
        address payable funder = payable(makeAddr("synthetic invariant funder"));
        address operator = makeAddr("synthetic invariant operator");
        bytes32[6] memory ids;
        uint64[6] memory periods;
        for (uint256 i; i < 6; i++) {
            ids[i] = bytes32(i + 1);
            periods[i] = 1 days;
        }
        programme =
            new Programme(funder, operator, bytes32(uint256(11)), bytes32(uint256(12)), 100_000 ether, ids, periods);
        vm.deal(funder, 100_000 ether);
        handler = new ProgrammeFundingHandler(programme, funder, operator);
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.route.selector;
        selectors[2] = handler.cancel.selector;
        selectors[3] = handler.returnPot.selector;
        selectors[4] = handler.abort.selector;
        selectors[5] = handler.refund.selector;
        selectors[6] = handler.withdraw.selector;
        selectors[7] = handler.force.selector;
        selectors[8] = handler.withdrawSurplus.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantEveryWeiIsPendingRoutedRefundedOrReturnedWithoutRefilling() public view {
        assertEq(programme.deposited(), handler.deposits());
        assertEq(programme.totalRouted(), handler.routed());
        assertEq(programme.unroutedRefunded(), handler.refunds());
        assertEq(programme.returned(), handler.returnedFunding());
        assertEq(programme.returnsWithdrawn(), handler.withdrawals());
        assertLe(programme.deposited(), programme.budget());
        assertEq(programme.pendingFunding(), handler.deposits() - handler.routed() - handler.refunds());
        assertEq(programme.pendingReturns(), handler.returnedFunding() - handler.withdrawals());
        assertEq(
            address(programme).balance,
            programme.pendingFunding() + programme.pendingReturns() + handler.forced() - handler.surplusWithdrawn()
        );
        uint256 routedSum;
        uint256 returnedSum;
        for (uint8 i; i < 6; i++) {
            Campaign child = programme.campaigns(i);
            assertEq(programme.routed(i), handler.sent(i));
            uint256 expected = handler.sent(i) ? programme.caps(i) : 0;
            assertEq(child.accountedFunding(), expected);
            assertEq(child.paid(0) + child.paid(1), 0);
            assertEq(child.entitlementCount(), 0);
            assertEq(programme.returnedByPot(i), child.treasuryReturned());
            assertEq(address(child).balance, expected - child.treasuryReturned());
            routedSum += expected;
            returnedSum += child.treasuryReturned();
        }
        assertEq(programme.totalRouted(), routedSum);
        assertEq(programme.returned(), returnedSum);
    }
}
