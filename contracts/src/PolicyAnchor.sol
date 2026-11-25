// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPolicyAnchor} from "./IPolicyAnchor.sol";

/// @title PolicyAnchor
/// @notice Immutable, escrow-free spending policy for agent session keys.
/// @dev There is no owner, proxy, or token-transfer function. `msg.sender` is the
///      account whose funds are being constrained. Only that account can write its
///      policy or charge its epoch budget. Charging updates an accounting counter.
///      The user's tokens stay in the user's account.
contract PolicyAnchor is IPolicyAnchor {
    uint64 public constant MIN_EPOCH_SECONDS = 60;
    uint64 public constant MAX_EPOCH_SECONDS = 366 days;
    uint256 public constant MAX_RECIPIENTS = 64;

    error ZeroAddress();
    error InvalidPolicyHash();
    error InvalidExpiry();
    error InvalidEpoch();
    error InvalidCaps();
    error InvalidRecipients();
    error PolicyMissing();
    error Paused();
    error SessionRevoked();
    error SessionExpired();
    error AssetNotAllowed();
    error RecipientNotAllowed();
    error PerTxCapExceeded();
    error EpochCapExceeded();
    error StepUpRequired();

    struct Record {
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

    mapping(address account => Record record) private _records;
    mapping(address account => mapping(address recipient => bool allowed)) private _allowed;
    mapping(address account => address[] recipients) private _recipientList;

    event PolicyCommitted(
        address indexed account,
        bytes32 indexed policyHash,
        address sessionSigner,
        address asset,
        uint256 perTxCap,
        uint256 epochCap,
        uint256 stepUpAbove,
        uint64 validUntil
    );
    event SessionCleared(address indexed account);
    event PauseSet(address indexed account, bool paused);
    event SpendCharged(
        address indexed account, address indexed asset, address indexed recipient, uint256 amount, uint256 epochSpent
    );

    /// @notice Publish a new policy for the caller and reset the caller's epoch spend.
    /// @param validUntil Exclusive unix timestamp. A charge at this timestamp reverts.
    /// @param stepUpAbove Amounts greater than or equal to this value require the owner, not the session key.
    /// @param payees Fail-closed payee allowlist. An empty list is rejected.
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
        if (policyHash == bytes32(0)) revert InvalidPolicyHash();
        if (sessionSigner == address(0) || asset == address(0)) revert ZeroAddress();
        if (validUntil <= block.timestamp) revert InvalidExpiry();
        if (epochSeconds < MIN_EPOCH_SECONDS || epochSeconds > MAX_EPOCH_SECONDS) revert InvalidEpoch();
        if (perTxCap == 0 || epochCap < perTxCap || stepUpAbove == 0 || stepUpAbove > perTxCap) revert InvalidCaps();
        if (payees.length == 0 || payees.length > MAX_RECIPIENTS) revert InvalidRecipients();

        _clearRecipients(msg.sender);
        for (uint256 i = 0; i < payees.length; ++i) {
            address recipient = payees[i];
            if (recipient == address(0) || _allowed[msg.sender][recipient]) revert InvalidRecipients();
            _allowed[msg.sender][recipient] = true;
            _recipientList[msg.sender].push(recipient);
        }

        Record storage record = _records[msg.sender];
        record.policyHash = policyHash;
        record.sessionSigner = sessionSigner;
        record.asset = asset;
        record.validUntil = validUntil;
        record.epochSeconds = epochSeconds;
        record.perTxCap = perTxCap;
        record.epochCap = epochCap;
        record.stepUpAbove = stepUpAbove;
        record.epochSpent = 0;
        record.epochStartedAt = uint64(block.timestamp);
        record.paused = false;
        record.exists = true;

        emit PolicyCommitted(msg.sender, policyHash, sessionSigner, asset, perTxCap, epochCap, stepUpAbove, validUntil);
    }

    /// @notice Account for a session spend. Reverts when the spend is outside the committed policy.
    /// @dev The caller must be the account that owns the funds. This function does not transfer tokens.
    function charge(address asset, address recipient, uint256 amount) external {
        Record storage record = _records[msg.sender];
        if (!record.exists) revert PolicyMissing();
        if (record.paused) revert Paused();
        if (record.sessionSigner == address(0)) revert SessionRevoked();
        if (block.timestamp >= record.validUntil) revert SessionExpired();
        if (asset != record.asset) revert AssetNotAllowed();
        if (!_allowed[msg.sender][recipient]) revert RecipientNotAllowed();
        if (amount > record.perTxCap) revert PerTxCapExceeded();
        if (amount >= record.stepUpAbove) revert StepUpRequired();

        _rollEpoch(record);
        if (record.epochSpent + amount > record.epochCap) revert EpochCapExceeded();
        record.epochSpent += amount;

        emit SpendCharged(msg.sender, asset, recipient, amount, record.epochSpent);
    }

    /// @notice User kill switch for session spends. The owner can still move funds from their account.
    function setPaused(bool paused_) external {
        Record storage record = _records[msg.sender];
        if (!record.exists) revert PolicyMissing();
        record.paused = paused_;
        emit PauseSet(msg.sender, paused_);
    }

    /// @notice Remove the session signer. Session charges revert until a new policy is committed.
    function revokeSession() external {
        Record storage record = _records[msg.sender];
        if (!record.exists) revert PolicyMissing();
        record.sessionSigner = address(0);
        emit SessionCleared(msg.sender);
    }

    function getPolicy(address account) external view returns (PolicyView memory) {
        Record storage record = _records[account];
        return PolicyView({
            policyHash: record.policyHash,
            sessionSigner: record.sessionSigner,
            asset: record.asset,
            validUntil: record.validUntil,
            epochSeconds: record.epochSeconds,
            perTxCap: record.perTxCap,
            epochCap: record.epochCap,
            stepUpAbove: record.stepUpAbove,
            epochSpent: record.epochSpent,
            epochStartedAt: record.epochStartedAt,
            paused: record.paused,
            exists: record.exists
        });
    }

    function recipients(address account) external view returns (address[] memory) {
        return _recipientList[account];
    }

    function isRecipient(address account, address recipient) external view returns (bool) {
        return _allowed[account][recipient];
    }

    function _rollEpoch(Record storage record) private {
        uint64 started = record.epochStartedAt;
        uint64 length = record.epochSeconds;
        if (block.timestamp < uint256(started) + length) return;
        uint64 steps = uint64((block.timestamp - started) / length);
        record.epochStartedAt = started + steps * length;
        record.epochSpent = 0;
    }

    function _clearRecipients(address account) private {
        address[] storage list = _recipientList[account];
        uint256 length = list.length;
        for (uint256 i = 0; i < length; ++i) {
            _allowed[account][list[i]] = false;
        }
        delete _recipientList[account];
    }
}
