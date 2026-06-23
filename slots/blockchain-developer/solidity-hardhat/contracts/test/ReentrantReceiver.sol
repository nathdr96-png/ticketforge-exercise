// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ReentrantReceiver — a withdrawal recipient that calls back.
/// @notice A test fixture for this slot's own suite, not part of the
/// deployment: nothing in scripts/deploy.ts references it and it is never
/// registered in the sale. The slot's test registers an event whose organizer
/// is this contract and then asks the sale to pay it.
///
/// On being paid, `receive()` calls straight back into whatever payload it was
/// armed with — normally `withdrawOrganizerProceeds(eventId)` again — up to
/// `remaining` times, and counts how often it did in `reentries`. ONC-043 is
/// about what a withdrawal does when its recipient calls back, and a recipient
/// that really calls back is the only way to observe it.
contract ReentrantReceiver {
    address public immutable target;
    bytes public payload;
    uint8 public remaining;
    uint8 public reentries;

    constructor(address target_) {
        target = target_;
    }

    function arm(bytes calldata payload_, uint8 times) external {
        payload = payload_;
        remaining = times;
        reentries = 0;
    }

    /// @notice Make the first, legitimate call. Reverts if even that fails, so
    /// a test that cannot set the scene fails loudly instead of passing.
    function fire() external {
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    receive() external payable {
        if (remaining > 0) {
            remaining -= 1;
            reentries += 1;
            // Deliberately unchecked: whatever the inner call does, the
            // payment that triggered it completes.
            (bool ok,) = target.call(payload);
            ok;
        }
    }
}
