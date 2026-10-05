// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {SafeRewardConsentTest} from "./SafeRewardConsent.t.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";
import {RacesOnRewardCampaignV2} from "../src/RacesOnRewardCampaignV2.sol";

contract SafeRewardConsentV2Test is SafeRewardConsentTest {
    function _deployCampaign(address operator) internal override returns (Campaign) {
        return Campaign(
            address(
                new RacesOnRewardCampaignV2(
                    operator,
                    payable(address(this)),
                    keccak256("test programme"),
                    keccak256("test league"),
                    keccak256("test rules"),
                    1
                )
            )
        );
    }
}
