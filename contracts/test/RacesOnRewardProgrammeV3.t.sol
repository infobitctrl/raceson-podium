// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {RacesOnRewardProgrammeV3 as Programme} from "../src/RacesOnRewardProgrammeV3.sol";
import {RacesOnRewardCampaignV3 as Campaign} from "../src/RacesOnRewardCampaignV3.sol";

contract ProgrammeForceMon {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract ProgrammeRefundReceiver {
    Programme public programme;
    bool public rejecting;
    bool public reenter;
    bool public reentrySucceeded;

    function configure(Programme p, bool reject_, bool reenter_) external {
        programme = p;
        rejecting = reject_;
        reenter = reenter_;
    }

    receive() external payable {
        require(!rejecting, "synthetic receiver rejection");
        if (reenter) {
            (reentrySucceeded,) = address(programme).call(abi.encodeCall(programme.refundUnrouted, ()));
        }
    }
}

/// @dev Disposable synthetic signers and balances only; no public deployment or sporting results.
contract RacesOnRewardProgrammeV3Test is Test {
    uint256 private constant OPERATOR_KEY = 0xbef012;
    uint256 private constant RUNNER_KEY = 0xbef013;
    uint256 private constant BUDGET = 100_000 ether;
    bytes32 private constant PROGRAMME = keccak256("synthetic programme funding");
    bytes32 private constant MANIFEST = keccak256("synthetic frozen economic rules");
    bytes32 private constant SNAPSHOT = keccak256("synthetic final result snapshot");
    address payable private funder;
    address private operator;
    Programme private programme;

    function _ids() private pure returns (bytes32[6] memory ids) {
        for (uint256 i; i < 6; i++) {
            ids[i] = keccak256(abi.encode("synthetic opaque campaign", i));
        }
    }

    function _periods() private pure returns (uint64[6] memory periods) {
        for (uint256 i; i < 6; i++) {
            periods[i] = 1 days;
        }
    }

    function _new(address payable funder_, uint256 budget_) private returns (Programme) {
        return new Programme(funder_, operator, PROGRAMME, MANIFEST, budget_, _ids(), _periods());
    }

    function setUp() public {
        // The full suite also runs under Foundry's Monad network execution mode.
        if (block.chainid != 10143) vm.chainId(31337);
        vm.warp(1_789_000_000);
        funder = payable(makeAddr("synthetic programme funder"));
        operator = vm.addr(OPERATOR_KEY);
        vm.deal(funder, BUDGET * 2);
        vm.deal(operator, 1 ether);
        programme = _new(funder, BUDGET);
    }

    function _deposit(uint256 amount) private {
        uint256 expected = programme.deposited();
        vm.prank(funder);
        programme.deposit{value: amount}(expected);
    }

    function _route(uint8 slot) private returns (Campaign child) {
        vm.prank(operator);
        programme.routePot(slot);
        child = programme.campaigns(slot);
    }

    function testCreatesSixIndependentBoundCampaignsWithFiftyFiftyBudget() public view {
        assertEq(programme.budget(), BUDGET);
        assertEq(programme.funder(), funder);
        assertEq(programme.operator(), operator);
        assertEq(programme.programmeId(), PROGRAMME);
        assertEq(programme.programmeManifestHash(), MANIFEST);
        uint256 sum;
        for (uint8 i; i < 6; i++) {
            Campaign child = programme.campaigns(i);
            assertGt(address(child).code.length, 0);
            assertEq(child.treasury(), address(programme));
            assertEq(child.operator(), operator);
            assertEq(child.campaignId(), _ids()[i]);
            assertEq(child.programmeId(), PROGRAMME);
            assertEq(child.programmeManifestHash(), MANIFEST);
            assertEq(child.reviewPeriod(), 1 days);
            assertEq(child.enabledPot(), i == 5 ? 1 : 0);
            assertEq(programme.caps(i), i == 5 ? 50_000 ether : 10_000 ether);
            assertEq(child.accountedFunding(), 0);
            assertFalse(programme.routed(i));
            for (uint8 j; j < i; j++) {
                assertNotEq(address(child), address(programme.campaigns(j)));
            }
            sum += programme.caps(i);
        }
        assertEq(sum, BUDGET);
    }

    function testWholeProgrammeDepositRoutesExactSixPotsWithoutApprovingOrPaying() public {
        _deposit(BUDGET);
        for (uint8 i; i < 6; i++) {
            Campaign child = _route(i);
            uint256 cap = programme.caps(i);
            assertEq(child.accountedFunding(), cap);
            assertEq(address(child).balance, cap);
            assertEq(uint256(child.state()), uint256(Campaign.State.Funding));
            vm.prank(operator);
            child.completeFunding(cap, cap); // Explicit separate operator closure, no second deposit.
            assertEq(child.budgets(child.enabledPot()), cap);
            assertEq(uint256(child.state()), uint256(Campaign.State.Review));
            assertEq(child.entitlementCount(), 0);
            assertEq(child.paid(0) + child.paid(1), 0);
        }
        assertEq(programme.deposited(), BUDGET);
        assertEq(programme.totalRouted(), BUDGET);
        assertEq(programme.pendingFunding(), 0);
        assertEq(address(programme).balance, 0);
        vm.prank(funder);
        vm.expectRevert(Programme.InvalidDeposit.selector);
        programme.deposit{value: 1}(BUDGET);
    }

    function testPartialFundingAndStaleIntentDoNotUnderfundOrRepeatAPot() public {
        _deposit(5_000 ether);
        vm.prank(operator);
        vm.expectRevert(Programme.InsufficientEscrow.selector);
        programme.routePot(0);
        vm.prank(funder);
        vm.expectRevert(Programme.InvalidDeposit.selector);
        programme.deposit{value: 5_000 ether}(0);
        _deposit(5_000 ether);
        _route(3); // Pot order is explicit; another round does not steal a partial allocation.
        vm.prank(operator);
        vm.expectRevert(Programme.PotAlreadyRouted.selector);
        programme.routePot(3);
        assertEq(programme.totalRouted(), 10_000 ether);
        assertEq(programme.campaigns(0).accountedFunding(), 0);
        assertEq(programme.campaigns(5).accountedFunding(), 0);
    }

    function testRejectsUnapprovedCallersBareDepositsAndInvalidInputs() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.deposit{value: 1}(0);
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.routePot(0);
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.abortFunding();
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.refundUnrouted();
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.withdrawReturns(0);
        vm.expectRevert(Programme.Unauthorized.selector);
        programme.withdrawSurplus();
        vm.prank(funder);
        (bool ok,) = address(programme).call{value: 1}("");
        assertFalse(ok);
        vm.startPrank(funder);
        vm.expectRevert(Programme.InvalidDeposit.selector);
        programme.deposit(0);
        vm.expectRevert(Programme.InvalidDeposit.selector);
        programme.deposit{value: BUDGET + 1}(0);
        vm.expectRevert(Programme.InvalidPot.selector);
        programme.routePot(6);
        vm.expectRevert(Programme.FundingStopped.selector);
        programme.refundUnrouted();
        vm.stopPrank();
        assertEq(programme.deposited(), 0);
    }

    function testChildDriftStopsRoutingAndPreservesRefundableEscrow() public {
        _deposit(30_000 ether);
        Campaign first = programme.campaigns(0);
        Campaign second = programme.campaigns(1);
        vm.prank(operator);
        first.fund{value: 1}(); // V3 permits external operator funding, but the router never adopts it.
        vm.prank(operator);
        second.cancel();
        for (uint8 i; i < 2; i++) {
            vm.prank(operator);
            vm.expectRevert(Programme.ChildFundingChanged.selector);
            programme.routePot(i);
            assertFalse(programme.routed(i));
        }
        _route(2);
        assertEq(programme.pendingFunding(), 20_000 ether);
        vm.startPrank(funder);
        programme.abortFunding();
        programme.refundUnrouted();
        vm.stopPrank();
        assertEq(programme.unroutedRefunded(), 20_000 ether);
        assertEq(first.accountedFunding(), 1);
    }

    function testCancellationReturnsNeverRefillOrReopenProgrammePots() public {
        _deposit(BUDGET);
        Campaign child = _route(0);
        vm.prank(operator);
        child.cancel();
        vm.prank(operator);
        child.returnToTreasury();
        assertEq(programme.returnedByPot(0), 10_000 ether);
        assertEq(programme.pendingReturns(), 10_000 ether);
        assertEq(programme.pendingFunding(), 90_000 ether);
        assertEq(programme.totalRouted(), 10_000 ether);
        vm.startPrank(funder);
        vm.expectRevert(Programme.InvalidReturn.selector);
        programme.withdrawReturns(0);
        programme.withdrawReturns(10_000 ether);
        vm.expectRevert(Programme.NothingToReturn.selector);
        programme.withdrawReturns(10_000 ether);
        programme.abortFunding();
        programme.refundUnrouted();
        vm.expectRevert(Programme.NothingToReturn.selector);
        programme.refundUnrouted();
        vm.expectRevert(Programme.FundingStopped.selector);
        programme.routePot(1);
        vm.expectRevert(Programme.FundingStopped.selector);
        programme.deposit{value: 1}(BUDGET);
        vm.stopPrank();
        assertEq(funder.balance, BUDGET * 2);
        assertTrue(programme.routed(0));
        assertEq(address(programme).balance, 0);
    }

    function _activateWithTwoAwards(Campaign child) private {
        Campaign.AwardInput[] memory awards = new Campaign.AwardInput[](2);
        awards[0] = Campaign.AwardInput(bytes32(uint256(1)), bytes32(uint256(11)), 0, 100 ether, SNAPSHOT, 0);
        awards[1] = Campaign.AwardInput(bytes32(uint256(2)), bytes32(uint256(12)), 0, 9_000 ether, SNAPSHOT, 0);
        vm.startPrank(operator);
        child.completeFunding(10_000 ether, 10_000 ether);
        child.uploadAwards(awards);
        child.stageAllocation(
            SNAPSHOT, child.uploadDigest(), 2, uint64(block.timestamp - 1 days), uint64(block.timestamp), MANIFEST
        );
        child.activate(child.allocationDigest(), SNAPSHOT);
        vm.stopPrank();
    }

    function _signature(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function testFundedChildPaysOnceRetainsWalletlessShareAndReturnsOnlyAfterPausedExpiry() public {
        _deposit(10_000 ether);
        Campaign child = _route(0);
        _activateWithTwoAwards(child);
        address payable runner = payable(vm.addr(RUNNER_KEY));
        uint64 issued = uint64(block.timestamp);
        uint64 expires = issued + 1 hours;
        (bytes32 approval, bytes32 consent) = child.claimDigests(bytes32(uint256(1)), runner, 0, issued, expires);
        bytes memory operatorProof = _signature(OPERATOR_KEY, approval);
        bytes memory recipientProof = _signature(RUNNER_KEY, consent);
        child.claim(bytes32(uint256(1)), runner, 0, issued, expires, operatorProof, recipientProof);
        assertEq(runner.balance, 100 ether);
        vm.expectRevert(Campaign.UnknownOrPaidEntitlement.selector);
        child.claim(bytes32(uint256(1)), runner, 0, issued, expires, operatorProof, recipientProof);
        assertEq(address(child).balance, 9_900 ether);
        vm.startPrank(operator);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        child.returnToTreasury();
        child.pause();
        vm.warp(block.timestamp + 400 days);
        vm.expectRevert(Campaign.ClaimsUnavailable.selector);
        child.close();
        child.resume();
        vm.warp(child.claimDeadline());
        child.close();
        child.returnToTreasury();
        vm.stopPrank();
        assertEq(programme.pendingReturns(), 9_900 ether);
        assertEq(child.paid(0), 100 ether);
        vm.prank(funder);
        programme.withdrawReturns(9_900 ether);
        assertEq(funder.balance, BUDGET * 2 - 100 ether);
    }

    function testForcedMonNeverBecomesProgrammeBudgetOrWithdrawsReservedLiabilities() public {
        _deposit(20_000 ether);
        Campaign child = _route(0);
        vm.deal(address(this), 7 ether);
        new ProgrammeForceMon{value: 3 ether}(payable(address(programme)));
        new ProgrammeForceMon{value: 4 ether}(payable(address(child)));
        assertEq(programme.pendingFunding(), 10_000 ether);
        assertEq(programme.deposited(), 20_000 ether);
        vm.startPrank(operator);
        child.cancel();
        child.returnSurplus();
        child.returnToTreasury();
        vm.stopPrank();
        assertEq(programme.pendingReturns(), 10_004 ether);
        vm.startPrank(funder);
        programme.abortFunding();
        vm.expectRevert(Programme.CampaignsNotTerminal.selector);
        programme.withdrawSurplus();
        vm.stopPrank();
        for (uint8 i = 1; i < 6; i++) {
            Campaign other = programme.campaigns(i);
            vm.prank(operator);
            other.cancel();
        }
        vm.prank(funder);
        programme.withdrawSurplus();
        assertEq(address(programme).balance, 20_004 ether);
        assertEq(programme.pendingFunding(), 10_000 ether);
        assertEq(programme.pendingReturns(), 10_004 ether);
    }

    function testRejectingAndReentrantFunderCannotLoseOrDuplicateRefund() public {
        ProgrammeRefundReceiver receiver = new ProgrammeRefundReceiver();
        Programme p = _new(payable(address(receiver)), 100 ether);
        vm.deal(address(receiver), 100 ether);
        vm.prank(address(receiver));
        p.deposit{value: 100 ether}(0);
        vm.prank(address(receiver));
        p.abortFunding();
        receiver.configure(p, true, false);
        vm.prank(address(receiver));
        vm.expectRevert(Programme.TransferFailed.selector);
        p.refundUnrouted();
        assertEq(p.pendingFunding(), 100 ether);
        assertEq(p.unroutedRefunded(), 0);
        receiver.configure(p, false, true);
        vm.prank(address(receiver));
        p.refundUnrouted();
        assertFalse(receiver.reentrySucceeded());
        assertEq(p.unroutedRefunded(), 100 ether);
        assertEq(address(receiver).balance, 100 ether);
    }

    function testNewProgrammeHasNoSharedClaimsAccountingOrDestinations() public {
        Programme second = _new(funder, BUDGET);
        _deposit(10_000 ether);
        _route(0);
        assertEq(second.deposited(), 0);
        for (uint8 i; i < 6; i++) {
            assertNotEq(address(second.campaigns(i)), address(programme.campaigns(i)));
            assertEq(second.campaigns(i).entitlementCount(), 0);
            assertEq(second.campaigns(i).accountedFunding(), 0);
        }
    }

    function testOperatorTopUpAfterRoutingInvalidatesExactBudgetClosure() public {
        _deposit(10_000 ether);
        Campaign child = _route(0);
        vm.startPrank(operator);
        child.fund{value: 1}();
        vm.expectRevert(Campaign.InvalidFunding.selector);
        child.completeFunding(10_000 ether, 10_000 ether);
        vm.stopPrank();
        assertEq(programme.totalRouted(), 10_000 ether);
        assertEq(child.accountedFunding(), 10_000 ether + 1);
        assertEq(uint256(child.state()), uint256(Campaign.State.Funding));
        assertEq(child.entitlementCount(), 0);
    }

    function testFunderAbortCannotCancelOrWithdrawAnActiveChild() public {
        _deposit(20_000 ether);
        Campaign child = _route(0);
        _activateWithTwoAwards(child);
        vm.startPrank(funder);
        programme.abortFunding();
        programme.refundUnrouted();
        vm.expectRevert(Programme.NothingToReturn.selector);
        programme.withdrawReturns(0);
        vm.expectRevert(Programme.CampaignsNotTerminal.selector);
        programme.withdrawSurplus();
        vm.expectRevert(Campaign.Unauthorized.selector);
        child.cancel();
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(Campaign.WrongState.selector);
        child.cancel();
        assertEq(uint256(child.state()), uint256(Campaign.State.Active));
        assertEq(address(child).balance, 10_000 ether);
        assertEq(programme.unroutedRefunded(), 10_000 ether);
        assertEq(child.allocated(0), 9_100 ether);
    }

    function testRejectedReturnWithdrawalRollsBackAndAcceptsOnlyTerminalChildren() public {
        ProgrammeRefundReceiver receiver = new ProgrammeRefundReceiver();
        Programme p = _new(payable(address(receiver)), 100 ether);
        vm.deal(address(receiver), 100 ether);
        vm.prank(address(receiver));
        p.deposit{value: 100 ether}(0);
        vm.prank(operator);
        p.routePot(0);
        Campaign child = p.campaigns(0);
        vm.prank(address(child));
        (bool ok,) = address(p).call{value: 1}("");
        assertFalse(ok);
        assertEq(p.returned(), 0);
        vm.startPrank(operator);
        child.cancel();
        child.returnToTreasury();
        vm.stopPrank();
        receiver.configure(p, true, false);
        vm.prank(address(receiver));
        vm.expectRevert(Programme.TransferFailed.selector);
        p.withdrawReturns(10 ether);
        assertEq(p.returnsWithdrawn(), 0);
        assertEq(p.pendingReturns(), 10 ether);
        receiver.configure(p, false, true);
        vm.prank(address(receiver));
        p.withdrawReturns(10 ether);
        assertFalse(receiver.reentrySucceeded());
        assertEq(p.pendingFunding(), 90 ether);
        assertEq(p.pendingReturns(), 0);
        assertEq(address(receiver).balance, 10 ether);
    }

    function testRejectsInvalidProgrammeConfigurationAndMainnet() public {
        bytes32[6] memory ids = _ids();
        uint64[6] memory periods = _periods();
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        _new(funder, 0);
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        _new(funder, 11);
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        _new(payable(operator), BUDGET);
        ids[5] = ids[0];
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        new Programme(funder, operator, PROGRAMME, MANIFEST, BUDGET, ids, periods);
        ids = _ids();
        ids[0] = bytes32(0);
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        new Programme(funder, operator, PROGRAMME, MANIFEST, BUDGET, ids, periods);
        periods[0] = 30 days + 1;
        vm.expectRevert(Programme.InvalidConfiguration.selector);
        new Programme(funder, operator, PROGRAMME, MANIFEST, BUDGET, _ids(), periods);
        vm.chainId(143);
        vm.expectRevert(Programme.UnsupportedChain.selector);
        _new(funder, BUDGET);
    }

    function testFuzzPartialDepositConservation(uint96 amount, uint8 slot) public {
        uint256 deposit = bound(uint256(amount), 1, BUDGET);
        slot = uint8(bound(slot, 0, 5));
        _deposit(deposit);
        if (deposit >= programme.caps(slot)) _route(slot);
        assertEq(programme.deposited(), programme.totalRouted() + programme.pendingFunding());
        assertEq(address(programme).balance, programme.pendingFunding() + programme.pendingReturns());
        vm.startPrank(funder);
        programme.abortFunding();
        if (programme.pendingFunding() > 0) programme.refundUnrouted();
        vm.stopPrank();
        assertEq(programme.deposited(), programme.totalRouted() + programme.unroutedRefunded());
    }
}
