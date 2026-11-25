// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPolicyAnchor} from "./IPolicyAnchor.sol";
import {SpendCall} from "./SpendCall.sol";

/// @title GuardAccount
/// @notice Reference account that keeps custody with the owner and binds the session key to PolicyAnchor.
/// @dev The owner can always move funds. The session key can only execute exact ERC-20 transfers that
///      `PolicyAnchor.charge` accepts. This account never delegatecalls and has no protocol admin.
contract GuardAccount {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    error ZeroAddress();
    error NotOwner();
    error NotSession();
    error EmptyCalls();
    error Reentered();
    error CallFailed();

    address public immutable owner;
    IPolicyAnchor public immutable anchor;

    bool private _entered;

    event SessionExecuted(address indexed sessionSigner, uint256 calls);
    event OwnerExecuted(address indexed owner, uint256 calls);

    constructor(address owner_, IPolicyAnchor anchor_) {
        if (owner_ == address(0) || address(anchor_) == address(0)) revert ZeroAddress();
        owner = owner_;
        anchor = anchor_;
    }

    modifier lock() {
        if (_entered) revert Reentered();
        _entered = true;
        _;
        _entered = false;
    }

    receive() external payable {}

    /// @notice Owner path. Does not charge the session budget. This is the user's sovereign exit.
    function execute(Call[] calldata calls) external payable lock {
        if (msg.sender != owner) revert NotOwner();
        _perform(calls, false);
        emit OwnerExecuted(owner, calls.length);
    }

    /// @notice Session path. Each call must be an allowlisted ERC-20 transfer inside the committed caps.
    function executeAsSession(Call[] calldata calls) external payable lock {
        if (msg.sender != anchor.getPolicy(address(this)).sessionSigner) revert NotSession();
        if (calls.length == 0) revert EmptyCalls();
        _perform(calls, true);
        emit SessionExecuted(msg.sender, calls.length);
    }

    function commitPolicy(
        bytes32 policyHash,
        address sessionSigner,
        address asset,
        uint64 validUntil,
        uint64 epochSeconds,
        uint256 perTxCap,
        uint256 epochCap,
        uint256 stepUpAbove,
        address[] calldata payees
    ) external {
        if (msg.sender != owner) revert NotOwner();
        anchor.commitPolicy(
            policyHash, sessionSigner, asset, validUntil, epochSeconds, perTxCap, epochCap, stepUpAbove, payees
        );
    }

    function setPaused(bool paused_) external {
        if (msg.sender != owner) revert NotOwner();
        anchor.setPaused(paused_);
    }

    function revokeSession() external {
        if (msg.sender != owner) revert NotOwner();
        anchor.revokeSession();
    }

    function _perform(Call[] calldata calls, bool session) private {
        uint256 length = calls.length;
        for (uint256 i = 0; i < length; ++i) {
            Call calldata call_ = calls[i];
            if (session) {
                (address asset, address recipient, uint256 amount) =
                    SpendCall.decodeTransfer(call_.target, call_.value, call_.data);
                anchor.charge(asset, recipient, amount);
            }
            (bool ok, bytes memory reason) = call_.target.call{value: call_.value}(call_.data);
            if (!ok) {
                if (reason.length > 0) {
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
                revert CallFailed();
            }
        }
    }
}
