// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Public policy commitment for one non-custodial account.
/// @dev The anchor stores caps and allowlists. It never holds or moves tokens.
interface IPolicyAnchor {
    struct PolicyView {
        bytes32 policyHash;
        address sessionSigner;
        address asset;
        uint64 validUntil;
        uint64 epochSeconds;
        uint256 perTxCap;
        uint256 epochCap;
        uint256 stepUpAbove;
        uint256 epochSpent;
        uint64 epochStartedAt;
        bool paused;
        bool exists;
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
    ) external;

    function charge(address asset, address recipient, uint256 amount) external;

    function setPaused(bool paused_) external;

    function revokeSession() external;

    function getPolicy(address account) external view returns (PolicyView memory);

    function recipients(address account) external view returns (address[] memory);

    function isRecipient(address account, address recipient) external view returns (bool);
}
