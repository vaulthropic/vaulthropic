// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttemptModel} from "../src/AttemptModel.sol";

contract AttemptModelTest is Test {
    function test_createdLeaves() public pure {
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.CREATED, AttemptModel.Status.IN_FLIGHT_PENDING));
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.CREATED, AttemptModel.Status.EXPIRED_OR_DROPPED));
        assertFalse(AttemptModel.canTransition(AttemptModel.Status.CREATED, AttemptModel.Status.FINALIZED));
    }

    function test_inFlightAndReplacement() public pure {
        assertTrue(
            AttemptModel.canTransition(AttemptModel.Status.IN_FLIGHT_PENDING, AttemptModel.Status.INCLUDED_UNFINALIZED)
        );
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.IN_FLIGHT_PENDING, AttemptModel.Status.REPLACED));
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.REPLACED, AttemptModel.Status.IN_FLIGHT_PENDING));
        assertFalse(AttemptModel.canTransition(AttemptModel.Status.REPLACED, AttemptModel.Status.FINALIZED));
    }

    function test_inclusionAndTerminals() public pure {
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.INCLUDED_UNFINALIZED, AttemptModel.Status.FINALIZED));
        assertTrue(AttemptModel.canTransition(AttemptModel.Status.INCLUDED_UNFINALIZED, AttemptModel.Status.REVERTED));
        assertFalse(AttemptModel.canTransition(AttemptModel.Status.FINALIZED, AttemptModel.Status.REVERTED));
        assertFalse(AttemptModel.canTransition(AttemptModel.Status.DROPPED, AttemptModel.Status.CREATED));
        assertFalse(AttemptModel.canTransition(AttemptModel.Status.FAILED, AttemptModel.Status.IN_FLIGHT_PENDING));
    }
}
