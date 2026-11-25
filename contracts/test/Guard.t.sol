// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyAnchor} from "../src/PolicyAnchor.sol";
import {GuardAccount} from "../src/GuardAccount.sol";
import {GuardAccountFactory} from "../src/GuardAccountFactory.sol";
import {SpendCall} from "../src/SpendCall.sol";
import {MockERC20} from "./MockERC20.sol";

contract GuardTest is Test {
    uint256 internal constant ONE = 1e6;

    PolicyAnchor internal anchor;
    GuardAccountFactory internal factory;
    GuardAccount internal account;
    MockERC20 internal usdc;
    MockERC20 internal other;

    address internal owner;
    address internal session;
    address internal merchant;
    address internal stranger;

    function setUp() public {
        owner = makeAddr("owner");
        session = makeAddr("session");
        merchant = makeAddr("merchant");
        stranger = makeAddr("stranger");

        anchor = new PolicyAnchor();
        factory = new GuardAccountFactory(anchor);
        usdc = new MockERC20();
        other = new MockERC20();

        bytes32 salt = keccak256("vaulthropic-test-account");
        account = factory.createAccount(owner, salt);
        assertEq(factory.predict(owner, salt), address(account));

        usdc.mint(address(account), 1000 * ONE);
        other.mint(address(account), 1000 * ONE);

        _commit(merchant);
    }

    function test_ownerRetainsFundsAndAnchorHoldsNone() public {
        assertEq(usdc.balanceOf(address(account)), 1000 * ONE);
        assertEq(usdc.balanceOf(address(anchor)), 0);
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(account.owner(), owner);

        vm.prank(owner);
        account.execute(_single(_transfer(address(usdc), owner, 1000 * ONE)));

        assertEq(usdc.balanceOf(owner), 1000 * ONE);
        assertEq(usdc.balanceOf(address(account)), 0);
        assertEq(anchor.getPolicy(address(account)).epochSpent, 0);
    }

    function test_sessionTransferWithinCapChargesEpoch() public {
        vm.prank(session);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 50 * ONE)));

        assertEq(usdc.balanceOf(merchant), 50 * ONE);
        assertEq(anchor.getPolicy(address(account)).epochSpent, 50 * ONE);
    }

    function test_sessionCannotExceedPerTransactionCap() public {
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.PerTxCapExceeded.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 101 * ONE)));
        assertEq(usdc.balanceOf(merchant), 0);
    }

    function test_sessionCannotExceedEpochCap() public {
        GuardAccount.Call[] memory calls = new GuardAccount.Call[](1);
        calls[0] = _transfer(address(usdc), merchant, 50 * ONE);

        vm.startPrank(session);
        account.executeAsSession(calls);
        account.executeAsSession(calls);
        account.executeAsSession(calls);
        account.executeAsSession(calls);
        account.executeAsSession(calls);
        vm.expectRevert(PolicyAnchor.EpochCapExceeded.selector);
        account.executeAsSession(calls);
        vm.stopPrank();

        assertEq(usdc.balanceOf(merchant), 250 * ONE);
        assertEq(anchor.getPolicy(address(account)).epochSpent, 250 * ONE);
    }

    function test_epochWindowRollsSpentBack() public {
        vm.prank(session);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 50 * ONE)));

        vm.warp(block.timestamp + 1 days);
        vm.prank(session);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 50 * ONE)));

        assertEq(anchor.getPolicy(address(account)).epochSpent, 50 * ONE);
        assertEq(usdc.balanceOf(merchant), 100 * ONE);
    }

    function test_stepUpAmountRequiresOwner() public {
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.StepUpRequired.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 80 * ONE)));

        vm.prank(owner);
        account.execute(_single(_transfer(address(usdc), merchant, 80 * ONE)));
        assertEq(usdc.balanceOf(merchant), 80 * ONE);
        assertEq(anchor.getPolicy(address(account)).epochSpent, 0);
    }

    function test_unknownRecipientIsBlocked() public {
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.RecipientNotAllowed.selector);
        account.executeAsSession(_single(_transfer(address(usdc), stranger, 1 * ONE)));
        assertEq(usdc.balanceOf(address(account)), 1000 * ONE);
    }

    function test_wrongAssetIsBlocked() public {
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.AssetNotAllowed.selector);
        account.executeAsSession(_single(_transfer(address(other), merchant, 1 * ONE)));
        assertEq(other.balanceOf(address(account)), 1000 * ONE);
    }

    function test_approvalSelectorIsBlocked() public {
        bytes memory data = abi.encodeWithSelector(MockERC20.approve.selector, stranger, 1000 * ONE);
        vm.prank(session);
        vm.expectRevert(SpendCall.UnsupportedCall.selector);
        account.executeAsSession(_single(GuardAccount.Call({target: address(usdc), value: 0, data: data})));
        assertEq(usdc.allowance(address(account), stranger), 0);
    }

    function test_nativeValueOnSessionCallIsBlocked() public {
        vm.deal(address(account), 1 ether);
        GuardAccount.Call memory call_ = GuardAccount.Call({
            target: merchant, value: 0.1 ether, data: abi.encodeWithSelector(MockERC20.transfer.selector, merchant, 1)
        });
        vm.prank(session);
        vm.expectRevert(SpendCall.NativeValueBlocked.selector);
        account.executeAsSession(_single(call_));
        assertEq(merchant.balance, 0);
    }

    function test_pauseStopsSessionAndOwnerCanStillExit() public {
        vm.prank(owner);
        account.setPaused(true);

        vm.prank(session);
        vm.expectRevert(PolicyAnchor.Paused.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 1 * ONE)));

        vm.prank(owner);
        account.execute(_single(_transfer(address(usdc), owner, 10 * ONE)));
        assertEq(usdc.balanceOf(owner), 10 * ONE);
    }

    function test_revokeSessionBlocksFurtherAgentSpend() public {
        vm.prank(owner);
        account.revokeSession();

        vm.prank(session);
        vm.expectRevert(GuardAccount.NotSession.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 1 * ONE)));
    }

    function test_expiredSessionReverts() public {
        vm.warp(block.timestamp + 7 days);
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.SessionExpired.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 1 * ONE)));
    }

    function test_strangerCannotExecuteEitherPath() public {
        vm.prank(stranger);
        vm.expectRevert(GuardAccount.NotOwner.selector);
        account.execute(_single(_transfer(address(usdc), stranger, 1 * ONE)));

        vm.prank(stranger);
        vm.expectRevert(GuardAccount.NotSession.selector);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 1 * ONE)));
    }

    function test_sessionCannotRewritePolicy() public {
        bytes memory data = abi.encodeWithSelector(GuardAccount.commitPolicy.selector, bytes32("hijack"));
        vm.prank(session);
        vm.expectRevert(SpendCall.UnsupportedCall.selector);
        account.executeAsSession(_single(GuardAccount.Call({target: address(account), value: 0, data: data})));
        assertEq(anchor.getPolicy(address(account)).policyHash, keccak256("policy-v1"));
    }

    function test_recommitReplacesRecipientsAndResetsSpend() public {
        vm.prank(session);
        account.executeAsSession(_single(_transfer(address(usdc), merchant, 20 * ONE)));

        vm.prank(owner);
        account.commitPolicy(
            keccak256("policy-v2"),
            session,
            address(usdc),
            uint64(block.timestamp + 7 days),
            1 days,
            100 * ONE,
            250 * ONE,
            80 * ONE,
            _one(stranger)
        );

        assertEq(anchor.getPolicy(address(account)).epochSpent, 0);
        assertFalse(anchor.isRecipient(address(account), merchant));
        assertTrue(anchor.isRecipient(address(account), stranger));

        vm.prank(session);
        account.executeAsSession(_single(_transfer(address(usdc), stranger, 20 * ONE)));
        assertEq(usdc.balanceOf(stranger), 20 * ONE);
    }

    function test_anchorRejectsDirectEtherAndEmptyRecipientList() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(anchor).call{value: 1 ether}("");
        assertFalse(ok);

        vm.prank(owner);
        vm.expectRevert(PolicyAnchor.InvalidRecipients.selector);
        account.commitPolicy(
            keccak256("empty"),
            session,
            address(usdc),
            uint64(block.timestamp + 1 days),
            1 days,
            1 * ONE,
            1 * ONE,
            1 * ONE,
            new address[](0)
        );
    }

    function test_onlyTheAccountCanChargeItsOwnBudget() public {
        vm.prank(session);
        vm.expectRevert(PolicyAnchor.PolicyMissing.selector);
        anchor.charge(address(usdc), merchant, 1 * ONE);
        assertEq(anchor.getPolicy(address(account)).epochSpent, 0);
    }

    function test_canonicalFixtureHash() public view {
        bytes memory raw =
            bytes(vm.readFile(string.concat(vm.projectRoot(), "/contracts/test/fixtures/policy.canonical.json")));
        if (raw.length > 0 && raw[raw.length - 1] == 0x0a) {
            bytes memory trimmed = new bytes(raw.length - 1);
            for (uint256 i = 0; i < trimmed.length; ++i) {
                trimmed[i] = raw[i];
            }
            raw = trimmed;
        }
        assertEq(keccak256(raw), hex"014cbd37e6883a82f6719e697799e2c33eba6a68b9a02740a540b8e923f21391");
    }

    function _commit(address recipient) internal {
        vm.prank(owner);
        account.commitPolicy(
            keccak256("policy-v1"),
            session,
            address(usdc),
            uint64(block.timestamp + 7 days),
            1 days,
            100 * ONE,
            250 * ONE,
            80 * ONE,
            _one(recipient)
        );
    }

    function _one(address recipient) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = recipient;
    }

    function _transfer(address asset, address to, uint256 amount) internal pure returns (GuardAccount.Call memory) {
        return GuardAccount.Call({
            target: asset, value: 0, data: abi.encodeWithSelector(MockERC20.transfer.selector, to, amount)
        });
    }

    function _single(GuardAccount.Call memory call_) internal pure returns (GuardAccount.Call[] memory calls) {
        calls = new GuardAccount.Call[](1);
        calls[0] = call_;
    }
}
