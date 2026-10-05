// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RacesOnRewardCampaignV3 as Campaign} from "./RacesOnRewardCampaignV3.sol";

/// @notice One native-test-MON funding address for five race pots and one league pot.
/// @dev No wallet keys, upgrades, arbitrary calls or editable destinations. The
///      child operator remains the designated off-chain sporting/claim attestor.
///      The router caps ITS contributions; existing V3 permits separate operator
///      deposits. Those are not programme funding and must fail the off-chain
///      exact-budget check before upload/activation. Routing does not close
///      funding, approve results, activate a campaign or pay a recipient.
contract RacesOnRewardProgrammeV3 is ReentrancyGuard {
    uint256 public constant PROTOCOL_VERSION = 3;
    uint256 public constant POT_COUNT = 6;
    address payable public immutable funder;
    address public immutable operator;
    bytes32 public immutable programmeId;
    bytes32 public immutable programmeManifestHash;
    uint256 public immutable budget;
    Campaign[6] public campaigns;
    uint256[6] public caps;
    bool[6] public routed;
    uint256[6] public returnedByPot;
    mapping(address => uint256) private slotPlusOne;

    uint256 public deposited;
    uint256 public totalRouted;
    uint256 public unroutedRefunded;
    uint256 public returned;
    uint256 public returnsWithdrawn;
    bool public fundingAborted;

    error UnsupportedChain();
    error InvalidConfiguration();
    error Unauthorized();
    error InvalidDeposit();
    error FundingStopped();
    error InvalidPot();
    error PotAlreadyRouted();
    error InsufficientEscrow();
    error ChildFundingChanged();
    error InvalidReturn();
    error NothingToReturn();
    error TransferFailed();
    error CampaignsNotTerminal();

    event CampaignCreated(uint8 indexed slot, address indexed campaign, bytes32 campaignId, uint256 cap, uint64 review);
    event Deposited(address indexed funder, uint256 amount, uint256 total);
    event PotRouted(uint8 indexed slot, address indexed campaign, uint256 amount);
    event FundingAborted();
    event UnroutedRefunded(uint256 amount);
    event ReturnReceived(uint8 indexed slot, uint256 amount, uint256 total);
    event ReturnsWithdrawn(uint256 amount);
    event SurplusWithdrawn(uint256 amount);

    constructor(
        address payable funder_,
        address operator_,
        bytes32 programmeId_,
        bytes32 manifestHash_,
        uint256 budget_,
        bytes32[6] memory campaignIds,
        uint64[6] memory reviewPeriods
    ) {
        if (block.chainid != 10143 && block.chainid != 31337) revert UnsupportedChain();
        if (
            funder_ == address(0) || operator_ == address(0) || funder_ == operator_ || funder_ == address(this)
                || operator_ == address(this) || programmeId_ == bytes32(0) || manifestHash_ == bytes32(0)
                || budget_ == 0 || budget_ % 10 != 0
        ) revert InvalidConfiguration();
        // Validate the whole fixed scope before deploying any child. IDs are
        // opaque programme identifiers, never profile IDs or hashes of PII.
        for (uint256 i; i < POT_COUNT; i++) {
            if (campaignIds[i] == bytes32(0) || reviewPeriods[i] > 30 days) revert InvalidConfiguration();
            for (uint256 j; j < i; j++) {
                if (campaignIds[i] == campaignIds[j]) revert InvalidConfiguration();
            }
        }
        funder = funder_;
        operator = operator_;
        programmeId = programmeId_;
        programmeManifestHash = manifestHash_;
        budget = budget_;
        for (uint8 i; i < POT_COUNT; i++) {
            caps[i] = i == 5 ? budget_ / 2 : budget_ / 10;
            Campaign child = new Campaign(
                operator_,
                payable(address(this)),
                programmeId_,
                campaignIds[i],
                manifestHash_,
                i == 5 ? 1 : 0,
                reviewPeriods[i]
            );
            campaigns[i] = child;
            slotPlusOne[address(child)] = uint256(i) + 1;
            emit CampaignCreated(i, address(child), campaignIds[i], caps[i], reviewPeriods[i]);
        }
    }

    modifier onlyFunder() {
        if (msg.sender != funder) revert Unauthorized();
        _;
    }

    /// @notice Explicit, bounded deposits; expected total rejects stale duplicate intents.
    /// @dev Partial deposits stay in this escrow. A pot routes only at its FULL cap.
    function deposit(uint256 expectedDeposited) external payable nonReentrant onlyFunder {
        if (fundingAborted) revert FundingStopped();
        if (expectedDeposited != deposited || msg.value == 0 || msg.value > budget - deposited) {
            revert InvalidDeposit();
        }
        deposited += msg.value;
        emit Deposited(msg.sender, msg.value, deposited);
    }

    function pendingFunding() public view returns (uint256) {
        return deposited - totalRouted - unroutedRefunded;
    }

    function pendingReturns() public view returns (uint256) {
        return returned - returnsWithdrawn;
    }

    /// @notice Fund exactly one immutable destination once; never redirect a return.
    /// @dev Operator subsequently closes child funding using the existing V3
    ///      exact-budget workflow. A changed child pre-state leaves this pot in escrow.
    function routePot(uint8 slot) external nonReentrant {
        if (msg.sender != operator && msg.sender != funder) revert Unauthorized();
        if (fundingAborted) revert FundingStopped();
        if (slot >= POT_COUNT) revert InvalidPot();
        if (routed[slot]) revert PotAlreadyRouted();
        uint256 amount = caps[slot];
        if (pendingFunding() < amount) revert InsufficientEscrow();
        Campaign child = campaigns[slot];
        if (child.state() != Campaign.State.Funding || child.accountedFunding() != 0) revert ChildFundingChanged();
        routed[slot] = true;
        totalRouted += amount;
        child.fund{value: amount}();
        emit PotRouted(slot, address(child), amount);
    }

    /// @notice Permanently stop deposits/routing. Does not cancel funded child claims.
    function abortFunding() external nonReentrant onlyFunder {
        if (fundingAborted) revert FundingStopped();
        fundingAborted = true;
        emit FundingAborted();
    }

    function refundUnrouted() external nonReentrant onlyFunder {
        if (!fundingAborted) revert FundingStopped();
        uint256 amount = pendingFunding();
        if (amount == 0) revert NothingToReturn();
        unroutedRefunded += amount;
        emit UnroutedRefunded(amount);
        _transfer(amount);
    }

    /// @dev Only known children may return normally, and only in terminal state.
    ///      Both accounted returns and child surplus have the same immutable payee.
    receive() external payable nonReentrant {
        uint256 index = slotPlusOne[msg.sender];
        if (index == 0 || msg.value == 0) revert InvalidReturn();
        Campaign child = campaigns[index - 1];
        if (!_terminal(child) || child.paused()) revert InvalidReturn();
        returnedByPot[index - 1] += msg.value;
        returned += msg.value;
        emit ReturnReceived(uint8(index - 1), msg.value, returned);
    }

    function withdrawReturns(uint256 expectedReturned) external nonReentrant onlyFunder {
        if (expectedReturned != returned) revert InvalidReturn();
        uint256 amount = pendingReturns();
        if (amount == 0) revert NothingToReturn();
        returnsWithdrawn += amount;
        emit ReturnsWithdrawn(amount);
        _transfer(amount);
    }

    /// @notice Forced MON is never a deposit, a pot refill or a claim liability.
    function withdrawSurplus() external nonReentrant onlyFunder {
        if (!fundingAborted) revert FundingStopped();
        for (uint256 i; i < POT_COUNT; i++) {
            if (!_terminal(campaigns[i]) || campaigns[i].paused()) revert CampaignsNotTerminal();
        }
        uint256 amount = address(this).balance - pendingFunding() - pendingReturns();
        if (amount == 0) revert NothingToReturn();
        emit SurplusWithdrawn(amount);
        _transfer(amount);
    }

    function _terminal(Campaign child) private view returns (bool) {
        Campaign.State state = child.state();
        return state == Campaign.State.Cancelled || state == Campaign.State.Closed;
    }

    function _transfer(uint256 amount) private {
        (bool ok,) = funder.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
