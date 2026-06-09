// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ReentrantOrganizer — a withdrawal recipient that calls back.
/// @notice An event organizer that is a contract. When it is paid, `receive()`
/// calls straight back into its target with whatever payload it was armed
/// with, up to `remaining` times, and counts how often it did in `reentries`.
///
/// Its creation bytecode is vendored in ReentrantOrganizer.json, so deploying
/// it needs no Solidity compiler and no network.
contract ReentrantOrganizer {
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
