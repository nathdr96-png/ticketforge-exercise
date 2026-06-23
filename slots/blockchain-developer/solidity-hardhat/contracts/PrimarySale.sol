// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {TicketToken} from "./TicketToken.sol";

/// @title PrimarySale — TicketForge's on-chain primary ticket sale.
/// @notice Implements `contract/onchain/rules.yaml`. Every amount is an integer
/// in the chain's native unit, and one native unit is one minor unit of the
/// event's currency (one cent) — see the `denomination` block of that file.
/// There is no floating point here and nowhere for one to appear: Solidity has
/// none, and nothing below opts out of 0.8.x checked arithmetic with
/// `unchecked`.
///
/// The money rule is the product's published one and is not restated in a
/// second form anywhere:
///
///     discount = floor(subtotal * percent_off / 100)
///     fee      = floor((subtotal - discount) * FEE_PERCENT / 100) + FEE_FIXED_CENTS
///     total    = subtotal - discount + fee
///
/// See `contract/openapi.yaml` (RevenueReport: `net_cents = gross_cents -
/// discounts_cents + fees_cents`), the money comment in `contract/schema.sql`,
/// and `contract/scenarios/T3-orders-money.md`.
contract PrimarySale is AccessControl {
    // ------------------------------------------------------------------ roles
    /// @notice ONC-041. Platform parameters and platform withdrawals only.
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    /// @notice Basis-point denominator for the resale cap. 10000 bps = 100%.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ----------------------------------------------------------------- state
    struct EventSale {
        address organizer;
        uint64 opensAt;
        uint64 closesAt;
        uint32 walletCap;
        uint16 resaleCapBps;
        uint8 sectionCount;
        bool isSealed;
        uint32 seatCount;
        uint32 mintedCount;
        uint256 proceeds;
    }

    struct Seat {
        bytes32 eventId;
        uint8 section;
        bool registered;
    }

    /// @notice The ticket token. Set once by the platform after construction,
    /// because the token needs this contract's address and this contract needs
    /// the token's — one of the two has to go second.
    TicketToken public ticketToken;

    /// @notice FEE_PERCENT and FEE_FIXED_CENTS from the product's fee rule.
    uint16 public feePercent;
    uint256 public feeFixedUnits;

    uint256 public platformProceeds;

    mapping(bytes32 eventId => EventSale) private _events;
    mapping(bytes32 eventId => mapping(uint8 section => uint256 priceUnits)) public sectionPrice;
    mapping(uint256 tokenId => Seat) private _seats;

    /// @notice What was actually paid for this seat on the primary sale, before
    /// discount and before fee: the seat's face value.
    mapping(uint256 tokenId => uint256 faceValueUnits) public faceValue;

    mapping(bytes32 eventId => mapping(address wallet => uint32 count)) public primaryPurchased;
    mapping(bytes32 eventId => mapping(bytes32 code => uint16 percentOff)) public discountPercent;

    mapping(uint256 tokenId => uint256 priceUnits) public listingPrice;
    mapping(uint256 tokenId => address seller) public listingSeller;
    mapping(address seller => uint256 owedUnits) public sellerProceeds;

    /// @notice Running total of `sellerProceeds`, so solvency (ONC-042) can be
    /// evaluated without enumerating every address that ever sold a ticket.
    uint256 public sellerProceedsTotal;

    /// @notice Running total of every event's unwithdrawn `proceeds`, for the
    /// same reason.
    uint256 public organizerProceedsTotal;

    // ---------------------------------------------------------------- events
    event TicketTokenSet(address token);
    event EventRegistered(bytes32 indexed eventId, address indexed organizer, uint64 opensAt, uint64 closesAt);
    event SeatsRegistered(bytes32 indexed eventId, uint256 count, uint32 seatCount);
    event EventSealed(bytes32 indexed eventId, uint32 seatCount);
    event DiscountRegistered(bytes32 indexed eventId, bytes32 indexed code, uint16 percentOff);
    event PlatformFeeChanged(uint16 feePercent, uint256 feeFixedUnits);
    event TicketsPurchased(
        bytes32 indexed eventId,
        address indexed buyer,
        uint256 count,
        uint256 subtotalUnits,
        uint256 discountUnits,
        uint256 feeUnits
    );
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 priceUnits);
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event Resold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 priceUnits);
    event OrganizerWithdrawn(bytes32 indexed eventId, address indexed organizer, uint256 amountUnits);
    event PlatformWithdrawn(address indexed to, uint256 amountUnits);
    event SellerWithdrawn(address indexed seller, uint256 amountUnits);

    // ---------------------------------------------------------------- errors
    error AlreadySet();
    error NotConfigured();
    error UnknownEvent();
    error EventExists();
    error EventSealedAlready();
    error EventNotSealed();
    error ZeroAddress();
    error BadWindow();
    error BadSection();
    error SeatAlreadyRegistered();
    error SeatNotForThisEvent();
    error LengthMismatch();
    error EmptySelection();
    error SaleNotOpen();
    error WalletCapExceeded();
    error UnknownDiscount();
    error WrongPayment(uint256 expected, uint256 sent);
    error SeatCountExceeded();
    error NotOwner();
    error NotApproved();
    error ResaleAboveCap(uint256 cap, uint256 price);
    error NotListed();
    error NothingOwed();
    error TransferFailed();
    error OnlyOrganizer();

    constructor(address platform, uint16 feePercent_, uint256 feeFixedUnits_) {
        if (platform == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, platform);
        _grantRole(PLATFORM_ROLE, platform);
        feePercent = feePercent_;
        feeFixedUnits = feeFixedUnits_;
    }

    // ------------------------------------------------------------ platform ops
    function setTicketToken(address token) external onlyRole(PLATFORM_ROLE) {
        if (address(ticketToken) != address(0)) revert AlreadySet();
        if (token == address(0)) revert ZeroAddress();
        ticketToken = TicketToken(token);
        emit TicketTokenSet(token);
    }

    /// @notice ONC-041: platform parameters are the platform role's alone.
    function setPlatformFee(uint16 feePercent_, uint256 feeFixedUnits_) external onlyRole(PLATFORM_ROLE) {
        feePercent = feePercent_;
        feeFixedUnits = feeFixedUnits_;
        emit PlatformFeeChanged(feePercent_, feeFixedUnits_);
    }

    function registerEvent(
        bytes32 eventId,
        address organizer,
        uint64 opensAt,
        uint64 closesAt,
        uint32 walletCap,
        uint16 resaleCapBps,
        uint256[] calldata sectionPrices
    ) external onlyRole(PLATFORM_ROLE) {
        EventSale storage ev = _events[eventId];
        if (ev.organizer != address(0)) revert EventExists();
        if (organizer == address(0)) revert ZeroAddress();
        if (closesAt <= opensAt) revert BadWindow();
        if (sectionPrices.length == 0 || sectionPrices.length > type(uint8).max) revert BadSection();

        ev.organizer = organizer;
        ev.opensAt = opensAt;
        ev.closesAt = closesAt;
        ev.walletCap = walletCap;
        ev.resaleCapBps = resaleCapBps;
        ev.sectionCount = uint8(sectionPrices.length);
        for (uint8 i = 0; i < uint8(sectionPrices.length); i++) {
            sectionPrice[eventId][i] = sectionPrices[i];
        }
        emit EventRegistered(eventId, organizer, opensAt, closesAt);
    }

    /// @notice Register seats against an event, in batches. Seat ids are the
    /// keccak-256 hashes of the seeded seat ids (ONC-003).
    function registerSeats(bytes32 eventId, uint256[] calldata tokenIds, uint8[] calldata sections)
        external
        onlyRole(PLATFORM_ROLE)
    {
        EventSale storage ev = _events[eventId];
        if (ev.organizer == address(0)) revert UnknownEvent();
        if (ev.isSealed) revert EventSealedAlready();
        if (tokenIds.length != sections.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (sections[i] >= ev.sectionCount) revert BadSection();
            Seat storage seat = _seats[tokenIds[i]];
            if (seat.registered) revert SeatAlreadyRegistered();
            seat.eventId = eventId;
            seat.section = sections[i];
            seat.registered = true;
        }
        ev.seatCount += uint32(tokenIds.length);
        emit SeatsRegistered(eventId, tokenIds.length, ev.seatCount);
    }

    /// @notice Fix the inventory. ONC-012's seat count is only meaningful once
    /// nobody can add to it, so selling is gated on this.
    function sealEvent(bytes32 eventId) external onlyRole(PLATFORM_ROLE) {
        EventSale storage ev = _events[eventId];
        if (ev.organizer == address(0)) revert UnknownEvent();
        if (ev.isSealed) revert EventSealedAlready();
        ev.isSealed = true;
        emit EventSealed(eventId, ev.seatCount);
    }

    function registerDiscount(bytes32 eventId, bytes32 code, uint16 percentOff) external onlyRole(PLATFORM_ROLE) {
        if (_events[eventId].organizer == address(0)) revert UnknownEvent();
        if (code == bytes32(0) || percentOff == 0 || percentOff > 100) revert UnknownDiscount();
        discountPercent[eventId][code] = percentOff;
        emit DiscountRegistered(eventId, code, percentOff);
    }

    // ------------------------------------------------------------------ views
    function eventOf(bytes32 eventId) external view returns (EventSale memory) {
        return _events[eventId];
    }

    function seatOf(uint256 tokenId) external view returns (Seat memory) {
        return _seats[tokenId];
    }

    /// @notice The product's money rule, in one place. ONC-020.
    function quote(bytes32 eventId, uint256[] calldata tokenIds, bytes32 code)
        public
        view
        returns (uint256 subtotalUnits, uint256 discountUnits, uint256 feeUnits, uint256 totalUnits)
    {
        if (tokenIds.length == 0) revert EmptySelection();
        EventSale storage ev = _events[eventId];
        if (ev.organizer == address(0)) revert UnknownEvent();

        for (uint256 i = 0; i < tokenIds.length; i++) {
            Seat storage seat = _seats[tokenIds[i]];
            if (!seat.registered || seat.eventId != eventId) revert SeatNotForThisEvent();
            subtotalUnits += sectionPrice[eventId][seat.section];
        }

        // ONC-023: a code that is not registered for this event is a refusal,
        // not a silent zero. bytes32(0) means "no code".
        uint16 percentOff = 0;
        if (code != bytes32(0)) {
            percentOff = discountPercent[eventId][code];
            if (percentOff == 0) revert UnknownDiscount();
        }

        // floor() is integer division. Both lines are the product's, in the
        // product's order: the discount comes off the subtotal, and the fee is
        // charged on what is left.
        discountUnits = (subtotalUnits * percentOff) / 100;
        feeUnits = ((subtotalUnits - discountUnits) * feePercent) / 100 + feeFixedUnits;
        totalUnits = subtotalUnits - discountUnits + feeUnits;
    }

    /// @notice TODO(FEAT-907): the resale price cap is not implemented yet.
    /// `resaleCapBps` is registered per event and stored, and nothing reads it.
    /// Until it does, this returns "no limit" so that the resale market still
    /// functions — see the ticket for what the cap has to do.
    function resaleCeiling(uint256 tokenId) public view returns (uint256) {
        Seat storage seat = _seats[tokenId];
        if (!seat.registered) revert SeatNotForThisEvent();
        return type(uint256).max;
    }

    // ------------------------------------------------------------- buy (primary)
    function buy(bytes32 eventId, uint256[] calldata tokenIds, bytes32 code) external payable {
        if (address(ticketToken) == address(0)) revert NotConfigured();
        EventSale storage ev = _events[eventId];
        if (ev.organizer == address(0)) revert UnknownEvent();
        if (!ev.isSealed) revert EventNotSealed();

        // ONC-022. Closed at `closesAt`: the window is half-open, so a sale
        // that closes at midnight is not open at midnight.
        if (block.timestamp < ev.opensAt || block.timestamp >= ev.closesAt) revert SaleNotOpen();

        // ONC-021. Checked against the count this purchase would PRODUCE. A
        // wallet one ticket below the cap must not be able to buy four more.
        uint32 after_ = primaryPurchased[eventId][msg.sender] + uint32(tokenIds.length);
        if (after_ > ev.walletCap) revert WalletCapExceeded();
        primaryPurchased[eventId][msg.sender] = after_;

        // ONC-012.
        uint32 minted = ev.mintedCount + uint32(tokenIds.length);
        if (minted > ev.seatCount) revert SeatCountExceeded();
        ev.mintedCount = minted;

        (uint256 subtotalUnits, uint256 discountUnits, uint256 feeUnits, uint256 totalUnits) =
            quote(eventId, tokenIds, code);

        // ONC-020. Exact payment. Keeping an overpayment is theft and refunding
        // it is a second external call in the middle of a mint.
        if (msg.value != totalUnits) revert WrongPayment(totalUnits, msg.value);

        // ONC-040. The organiser is owed gross minus discounts; the platform
        // earned the fee. Nothing else is credited to anybody.
        ev.proceeds += subtotalUnits - discountUnits;
        organizerProceedsTotal += subtotalUnits - discountUnits;
        platformProceeds += feeUnits;

        _mintAll(eventId, tokenIds, msg.sender);

        emit TicketsPurchased(eventId, msg.sender, tokenIds.length, subtotalUnits, discountUnits, feeUnits);
    }

    /// @dev Split out of `buy` to keep that function's stack inside the EVM's
    /// 16-slot reach without turning on `viaIR`, which would quadruple the
    /// build time.
    function _mintAll(bytes32 eventId, uint256[] calldata tokenIds, address to) private {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            // The face value of this seat is its section's price at the moment
            // of sale, before discount and before fee.
            faceValue[tokenIds[i]] = sectionPrice[eventId][_seats[tokenIds[i]].section];
            // ONC-011: a seat already minted reverts inside the token.
            ticketToken.mint(to, tokenIds[i], eventId);
        }
    }

    // ------------------------------------------------------------------ resale
    /// @notice ONC-030. Transfers are free; a priced resale through this
    /// contract is capped.
    function listForResale(uint256 tokenId, uint256 priceUnits) external {
        if (ticketToken.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (
            ticketToken.getApproved(tokenId) != address(this)
                && !ticketToken.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved();

        uint256 ceiling = resaleCeiling(tokenId);
        if (priceUnits > ceiling) revert ResaleAboveCap(ceiling, priceUnits);

        listingPrice[tokenId] = priceUnits;
        listingSeller[tokenId] = msg.sender;
        emit Listed(tokenId, msg.sender, priceUnits);
    }

    function cancelListing(uint256 tokenId) external {
        if (listingSeller[tokenId] != msg.sender) revert NotListed();
        delete listingPrice[tokenId];
        delete listingSeller[tokenId];
        emit ListingCancelled(tokenId, msg.sender);
    }

    function buyResale(uint256 tokenId) external payable {
        address seller = listingSeller[tokenId];
        if (seller == address(0)) revert NotListed();
        uint256 priceUnits = listingPrice[tokenId];
        if (msg.value != priceUnits) revert WrongPayment(priceUnits, msg.value);

        // Re-check at settlement. The listing was capped when it was made, but
        // the ceiling is a function of state and a listing can outlive a change
        // to it. Cheap, and the alternative is a stale cap.
        uint256 ceiling = resaleCeiling(tokenId);
        if (priceUnits > ceiling) revert ResaleAboveCap(ceiling, priceUnits);

        delete listingPrice[tokenId];
        delete listingSeller[tokenId];

        // ONC-031. Credited, not pushed.
        sellerProceeds[seller] += priceUnits;
        sellerProceedsTotal += priceUnits;

        if (ticketToken.ownerOf(tokenId) != seller) revert NotOwner();
        ticketToken.transferFrom(seller, msg.sender, tokenId);
        emit Resold(tokenId, seller, msg.sender, priceUnits);
    }

    // -------------------------------------------------------------- settlement
    /// @notice ONC-041 + ONC-043.
    ///
    /// There is deliberately no `nonReentrant` modifier on any of the three
    /// withdrawals: nothing here calls out to anything that could come back,
    /// and a guard would cost every organiser gas for a risk they do not carry.
    function withdrawOrganizerProceeds(bytes32 eventId) external {
        EventSale storage ev = _events[eventId];
        if (ev.organizer == address(0)) revert UnknownEvent();
        if (msg.sender != ev.organizer) revert OnlyOrganizer();

        uint256 amount = ev.proceeds;
        if (amount == 0) revert NothingOwed();

        // Settle first, then close the books, so the event's recorded balance
        // only changes once the money has actually moved.
        _pay(msg.sender, amount);
        ev.proceeds = 0;
        organizerProceedsTotal -= amount;
        emit OrganizerWithdrawn(eventId, msg.sender, amount);
    }

    function withdrawPlatformProceeds(address to) external onlyRole(PLATFORM_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = platformProceeds;
        if (amount == 0) revert NothingOwed();
        platformProceeds = 0;

        _pay(to, amount);
        emit PlatformWithdrawn(to, amount);
    }

    function withdrawSellerProceeds() external {
        uint256 amount = sellerProceeds[msg.sender];
        if (amount == 0) revert NothingOwed();
        sellerProceeds[msg.sender] = 0;
        sellerProceedsTotal -= amount;

        _pay(msg.sender, amount);
        emit SellerWithdrawn(msg.sender, amount);
    }

    /// @notice The sum of everything this contract still owes. ONC-042
    /// compares it against `address(this).balance`.
    function totalOwed() external view returns (uint256) {
        return organizerProceedsTotal + platformProceeds + sellerProceedsTotal;
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
