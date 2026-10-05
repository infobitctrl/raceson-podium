// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {RewardConservationInvariantTest} from "./RewardConservation.invariant.t.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";
import {RacesOnRewardCampaignV2} from "../src/RacesOnRewardCampaignV2.sol";

contract RewardConservationV2InvariantTest is RewardConservationInvariantTest {
    function _deployCampaign(address operator, address payable destination) internal override returns (Campaign) {
        return Campaign(
            address(
                new RacesOnRewardCampaignV2(
                    operator,
                    destination,
                    keccak256("test programme"),
                    keccak256("test campaign"),
                    keccak256("test rules"),
                    0
                )
            )
        );
    }
}
