// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title TicketToken — one ERC-721 token per seat.
/// @notice ONC-010. The token id is `uint256(keccak256(seat_id))`, where
/// `seat_id` is the seat's id in `contract/seed/seats.json`. Hashing the
/// product's own seat id rather than handing out sequential numbers is what
/// makes the mapping checkable from outside: anybody holding the seed file can
/// recompute the id of a seat without asking this contract what it thinks a
/// seat is called.
///
/// The ERC-721 implementation is OpenZeppelin's. A ticket is going to be read
/// by wallets, indexers and marketplaces that already know the standard, and a
/// hand-rolled `transferFrom` is where the money goes missing.
contract TicketToken is ERC721 {
    /// @notice The only address allowed to mint. Set once, at construction.
    address public immutable sale;

    /// @notice Which event a minted seat belongs to, by token id.
    mapping(uint256 tokenId => bytes32 eventId) public eventOf;

    error ZeroAddress();
    error OnlySale();

    constructor(address sale_) ERC721("TicketForge Ticket", "TFT") {
        if (sale_ == address(0)) revert ZeroAddress();
        sale = sale_;
    }

    /// @notice Mint the ticket for one seat. ONC-010: primary sale only.
    /// @dev A second mint of the same seat reverts inside ERC721 with
    /// ERC721InvalidSender — which is ONC-011, and is the on-chain equivalent
    /// of the row lock that stops the same seat being sold twice off chain.
    function mint(address to, uint256 tokenId, bytes32 eventId) external {
        if (msg.sender != sale) revert OnlySale();
        eventOf[tokenId] = eventId;
        _safeMint(to, tokenId);
    }

    /// @notice Whether this seat has been minted. Used by the sale and by the
    /// conformance suite's invariants; `ownerOf` reverts for an unminted id,
    /// which is awkward to assert over a generated call sequence.
    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}
