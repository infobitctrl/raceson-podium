// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RacesOnRewardProgrammeV7 as Programme} from "./RacesOnRewardProgrammeV7.sol";

/// @notice Permissionless, immutable creation only. Cannot call existing programmes,
/// approve allocations, receive sponsor deposits or sign on behalf of a controller.
contract RacesOnSponsorFactoryV7 {
    error UnsupportedChain();
    event ProgrammeCreated(bytes32 indexed configurationHash, address indexed programme);

    constructor() {
        if (block.chainid != 10143 && block.chainid != 31337) revert UnsupportedChain();
    }

    /// @dev Exact configuration determines CREATE2 address, so duplicate requests
    /// cannot deploy another copy. No caller-selected bytecode or call target.
    function deploy(Programme.Configuration calldata c) external returns (address programme) {
        bytes32 salt = keccak256(abi.encode(c));
        bytes32 initHash = keccak256(abi.encodePacked(type(Programme).creationCode, abi.encode(c)));
        programme = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
        if (programme.code.length == 0) programme = address(new Programme{salt: salt}(c));
        emit ProgrammeCreated(salt, programme);
    }
}
