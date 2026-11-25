// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GuardAccount} from "./GuardAccount.sol";
import {IPolicyAnchor} from "./IPolicyAnchor.sol";

/// @title GuardAccountFactory
/// @notice Deploys per-user guard accounts. The factory does not own those accounts and cannot move their funds.
contract GuardAccountFactory {
    error ZeroAddress();

    IPolicyAnchor public immutable anchor;

    event AccountCreated(address indexed account, address indexed owner, bytes32 salt);

    constructor(IPolicyAnchor anchor_) {
        if (address(anchor_) == address(0)) revert ZeroAddress();
        anchor = anchor_;
    }

    function createAccount(address owner, bytes32 salt) external returns (GuardAccount account) {
        if (owner == address(0)) revert ZeroAddress();
        account = new GuardAccount{salt: salt}(owner, anchor);
        emit AccountCreated(address(account), owner, salt);
    }

    function predict(address owner, bytes32 salt) public view returns (address) {
        bytes32 bytecodeHash = keccak256(abi.encodePacked(type(GuardAccount).creationCode, abi.encode(owner, anchor)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)))));
    }
}
