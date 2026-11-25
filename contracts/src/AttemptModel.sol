// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AttemptModel
/// @notice Status vocabulary for an agent payment attempt.
///         The executable reserve, release, and idempotency ledger lives off chain.
///         PolicyAnchor still accounts a guarded transfer when that transfer executes.
///         shortcut: reservation is off chain, upgrade when a reservation-aware anchor is specified.
library AttemptModel {
    enum Status {
        CREATED,
        IN_FLIGHT_PENDING,
        INCLUDED_UNFINALIZED,
        FINALIZED,
        DROPPED,
        REPLACED,
        REVERTED,
        EXPIRED_OR_DROPPED,
        FAILED
    }

    /// @dev FINALIZED and the released terminals have no outbound transition.
    ///      A retry after release is a new reservation under the same idempotency key, not an observation.
    function canTransition(Status fromStatus, Status toStatus) internal pure returns (bool) {
        if (fromStatus == toStatus) return false;
        if (fromStatus == Status.CREATED) {
            return
                toStatus == Status.IN_FLIGHT_PENDING || toStatus == Status.FAILED
                    || toStatus == Status.EXPIRED_OR_DROPPED;
        }
        if (fromStatus == Status.IN_FLIGHT_PENDING) {
            return toStatus == Status.INCLUDED_UNFINALIZED || toStatus == Status.DROPPED || toStatus == Status.REPLACED
                || toStatus == Status.REVERTED || toStatus == Status.EXPIRED_OR_DROPPED || toStatus == Status.FAILED;
        }
        if (fromStatus == Status.REPLACED) {
            return toStatus == Status.IN_FLIGHT_PENDING || toStatus == Status.DROPPED
                || toStatus == Status.EXPIRED_OR_DROPPED || toStatus == Status.FAILED || toStatus == Status.REVERTED;
        }
        if (fromStatus == Status.INCLUDED_UNFINALIZED) {
            return toStatus == Status.FINALIZED || toStatus == Status.REVERTED || toStatus == Status.DROPPED
                || toStatus == Status.FAILED || toStatus == Status.EXPIRED_OR_DROPPED;
        }
        return false;
    }
}
