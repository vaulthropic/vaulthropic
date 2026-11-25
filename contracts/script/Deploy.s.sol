// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {PolicyAnchor} from "../src/PolicyAnchor.sol";
import {GuardAccountFactory} from "../src/GuardAccountFactory.sol";

/// @notice Deploys the immutable anchor and the per-user account factory.
/// @dev Reads `DEPLOYER_PRIVATE_KEY` from the environment at runtime. No key is stored in this repository.
///      After deployment, publish the addresses in `contracts/deployments/` and verify the bytecode.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        PolicyAnchor anchor = new PolicyAnchor();
        new GuardAccountFactory(anchor);
        vm.stopBroadcast();
    }
}
