// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RacesOnRewardCampaignV6 as Campaign} from "./RacesOnRewardCampaignV6.sol";

/// @notice Sponsor-funded, immutable six-slot programme. Slot 0 is league;
/// slots 1..5 are rounds. Zero-budget slots have no child and receive no funds.
/// @dev Exact wei caps bind the setup's integer rounding. No keys, proxies,
/// approvals of sporting results, or recipient payments are created here.
contract RacesOnRewardProgrammeV6 is ReentrancyGuard {
    uint256 public constant PROTOCOL_VERSION = 6;
    address payable public immutable funder;
    address public immutable operator;
    address public immutable walletRegistry;
    address payable public immutable unallocatedTreasury;
    address payable public immutable expiredTreasury;
    bytes32 public immutable programmeId;
    bytes32 public immutable programmeManifestHash;
    uint256 public immutable budget;
    uint64 public immutable claimLifetime;
    Campaign[6] public campaigns;
    uint256[6] public caps;
    bool public funded;
    bool public cancelled;

    struct Configuration {
        address payable funder;
        address operator;
        address walletRegistry;
        address payable unallocatedTreasury;
        address payable expiredTreasury;
        bytes32 programmeId;
        bytes32 manifestHash;
        uint256 budget;
        uint64 claimLifetime;
        uint256[6] caps;
        bytes32[6] campaignIds;
        uint64[6] reviewPeriods;
    }

    error InvalidConfiguration();
    error UnsupportedChain();
    error Unauthorized();
    error FundingUnavailable();
    error TransferFailed();
    error NothingToReturn();
    event CampaignCreated(uint8 indexed slot, address indexed campaign, bytes32 campaignId, uint256 cap);
    event ProgrammeFunded(address indexed funder, uint256 amount);
    event FundingCancelled();
    event SurplusReturned(uint256 amount);

    constructor(Configuration memory c) {
        if (block.chainid != 10143 && block.chainid != 31337) revert UnsupportedChain();
        if (
            c.walletRegistry.code.length == 0 || c.funder == address(0) || c.operator == address(0)
                || c.funder == c.operator || c.unallocatedTreasury == address(0) || c.expiredTreasury == address(0)
                || c.funder == address(this) || c.operator == address(this) || c.unallocatedTreasury == address(this)
                || c.expiredTreasury == address(this) || c.programmeId == bytes32(0) || c.manifestHash == bytes32(0)
                || c.budget == 0 || c.claimLifetime < 1 days || c.claimLifetime > 3650 days
        ) revert InvalidConfiguration();
        uint256 sum;
        for (uint8 i; i < 6; i++) {
            sum += c.caps[i];
            if (c.campaignIds[i] == bytes32(0) || c.reviewPeriods[i] > 30 days) revert InvalidConfiguration();
            for (uint8 j; j < i; j++) {
                if (c.campaignIds[i] == c.campaignIds[j]) revert InvalidConfiguration();
            }
        }
        if (sum != c.budget) revert InvalidConfiguration();
        funder = c.funder;
        operator = c.operator;
        walletRegistry = c.walletRegistry;
        unallocatedTreasury = c.unallocatedTreasury;
        expiredTreasury = c.expiredTreasury;
        programmeId = c.programmeId;
        programmeManifestHash = c.manifestHash;
        budget = c.budget;
        claimLifetime = c.claimLifetime;
        caps = c.caps;
        for (uint8 i; i < 6; i++) {
            if (c.caps[i] == 0) continue;
            Campaign child = new Campaign(
                c.operator,
                c.unallocatedTreasury,
                c.programmeId,
                c.campaignIds[i],
                c.manifestHash,
                i == 0 ? 1 : 0,
                c.reviewPeriods[i],
                c.claimLifetime,
                address(this),
                c.expiredTreasury,
                c.funder,
                c.walletRegistry
            );
            campaigns[i] = child;
            emit CampaignCreated(i, address(child), c.campaignIds[i], c.caps[i]);
        }
    }

    /// @notice One exact sponsor deposit funds every selected pot atomically.
    /// @dev Repeated/stale submissions revert; a failed child rolls everything back.
    /// Funding ends at Review, not Staged or Active. Only the operator can approve results.
    function fundProgramme() external payable nonReentrant {
        if (msg.sender != funder) revert Unauthorized();
        if (funded || cancelled || msg.value != budget) revert FundingUnavailable();
        funded = true;
        for (uint8 i; i < 6; i++) {
            if (caps[i] != 0) campaigns[i].completeFunding{value: caps[i]}(0, caps[i]);
        }
        emit ProgrammeFunded(msg.sender, msg.value);
    }

    function cancelFunding() external nonReentrant {
        if (msg.sender != funder) revert Unauthorized();
        if (funded || cancelled) revert FundingUnavailable();
        cancelled = true;
        emit FundingCancelled();
    }

    /// @notice Only forced surplus remains in the parent; child liabilities never enter it.
    function returnSurplus() external nonReentrant {
        if (msg.sender != funder) revert Unauthorized();
        if (!funded && !cancelled) revert FundingUnavailable();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToReturn();
        emit SurplusReturned(amount);
        (bool ok,) = funder.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
