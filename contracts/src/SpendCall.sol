// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SpendCall
/// @notice Decodes the only session-key call the reference account allows: ERC-20 `transfer`.
/// @dev Native value, approvals, and any other selector are rejected so a session key cannot
///      open a pull allowance or route around the recipient allowlist.
library SpendCall {
    bytes4 internal constant ERC20_TRANSFER = 0xa9059cbb;

    error NativeValueBlocked();
    error UnsupportedCall();

    function decodeTransfer(address callTarget, uint256 callValue, bytes calldata data)
        internal
        pure
        returns (address asset, address recipient, uint256 amount)
    {
        if (callValue != 0) revert NativeValueBlocked();
        if (callTarget == address(0) || data.length != 68) revert UnsupportedCall();
        if (bytes4(data[0:4]) != ERC20_TRANSFER) revert UnsupportedCall();

        (recipient, amount) = abi.decode(data[4:], (address, uint256));
        if (recipient == address(0) || amount == 0) revert UnsupportedCall();
        asset = callTarget;
    }
}
