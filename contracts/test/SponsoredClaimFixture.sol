// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @dev Disposable integration fixture, NOT a production wallet implementation.
/// A synthetic athlete delegates to this on an owned local chain only.
contract SponsoredClaimFixture {
    address private immutable payer;

    constructor(address payer_) {
        payer = payer_;
    }

    function execute(address target, bytes calldata data) external {
        require(msg.sender == payer, "fixture payer only");
        (bool success, bytes memory result) = target.call(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {}
}
