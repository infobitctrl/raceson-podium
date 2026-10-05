// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {SafeRewardConsentTest} from "./SafeRewardConsent.t.sol";
import {RacesOnRewardCampaign as Campaign} from "../src/RacesOnRewardCampaign.sol";
import {RacesOnRewardCampaignV4 as V4} from "../src/RacesOnRewardCampaignV4.sol";

contract SafeRewardConsentV4Test is SafeRewardConsentTest {
    function _deployCampaign(address operator) internal override returns (Campaign) {
        return Campaign(
            address(
                new V4(
                    operator,
                    payable(address(this)),
                    keccak256("test programme"),
                    keccak256("test campaign"),
                    keccak256("test rules"),
                    1,
                    1 days,
                    365 days,
                    operator,
                    payable(address(this)),
                    payable(address(this))
                )
            )
        );
    }

    function _stageAllocation(Campaign target, bytes32 snapshot, bytes32 upload, uint256 count, uint64 publication)
        internal
        override
    {
        V4(address(target))
            .stageAllocation(
                snapshot,
                upload,
                count,
                publication - 1 days,
                publication,
                keccak256("synthetic final publication evidence")
            );
    }
}
