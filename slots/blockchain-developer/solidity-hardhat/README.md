# blockchain/solidity-hardhat

TicketForge's on-chain primary ticket sale. Solidity 0.8.28, OpenZeppelin,
Hardhat. A complete implementation of the **blockchain / protocol** slot —
see [`../_SPEC.md`](../_SPEC.md) for what the family is and how it is graded,
and [`contract/onchain/`](../../../contract/onchain/) for the rules it
implements.

## Quick start

```bash
make install
make run        # compiles, deploys to an in-process local chain, writes deployment/deployment.json
make test       # the slot's own tests
make lint       # solhint over the contracts, plus a TypeScript type check
```

No database. No server. No network at run time: `make run` starts its own
in-process development chain, sends the deployment, writes one file and exits.
The only thing that ever reaches the network is `npm install` and Hardhat's
one-off download of solc 0.8.28, which it caches in `~/.cache/hardhat-nodejs/`.

Grade it:

```bash
cd ../../../conformance/blockchain && npm install
CHAIN_DEPLOYMENT=../../slots/blockchain-developer/solidity-hardhat/deployment/deployment.json npx vitest run
```

## What is in here

| | |
|---|---|
| `contracts/TicketToken.sol` | the ticket: OpenZeppelin ERC-721, one token per seat, mintable only by the sale |
| `contracts/PrimarySale.sol` | the event registry, the primary sale, the capped resale market, settlement |
| `contracts/test/ReentrantReceiver.sol` | a test fixture, not part of the deployment — a withdrawal recipient that calls back |
| `scripts/fixtures.ts` | reads `contract/seed/` and `contract/onchain/rules.yaml`; nothing here retypes a price |
| `scripts/deploy.ts` | deploys, registers the seeded events, and declares every transaction it sent |
| `test/sale.test.ts` | the slot's own tests — not the grade, and deliberately not a copy of it |

## The two contracts

**`TicketToken`** is an ERC-721. Token id is `uint256(keccak256(seat_id))` using
the seat's id from [`contract/seed/seats.json`](../../../contract/seed/seats.json),
so `seat_club_A01-07` has one id that anybody holding the seed file can
recompute — which is what lets the conformance suite address a seat without
asking this contract what it thinks a seat is called. Only `PrimarySale` may
mint; a second mint of the same seat reverts inside OpenZeppelin, which is this
family's version of the row lock that stops `BUG-251-same-seat-sold-twice`.

The ERC-721 is OpenZeppelin's rather than hand-rolled, for the ordinary reason:
a ticket will be read by wallets, indexers and marketplaces that already know
the standard, and a hand-written `transferFrom` is where the money goes missing.

**`PrimarySale`** holds the rest. The platform role registers an event with its
organiser, its sale window, its per-wallet cap, its resale cap and its section
prices; registers the event's seats; and seals it. After that:

- `quote(eventId, tokenIds, code)` — the product's money rule, in one place.
- `buy(eventId, tokenIds, code)` — refuses outside the window, refuses a basket
  that would take the wallet over the cap, refuses an inexact payment, mints,
  credits `subtotal - discount` to the organiser and the fee to the platform.
- `listForResale` / `buyResale` / `cancelListing` — the capped resale market.
  Proceeds are **credited**, never pushed.
- `withdrawOrganizerProceeds` / `withdrawPlatformProceeds` /
  `withdrawSellerProceeds` — settlement, with the access control that matters.
- `totalOwed()` — everything the contract still owes, so solvency can be checked
  from outside without enumerating every address that ever sold a ticket.

## Money

One definition, and it is not in this directory —
[`contract/openapi.yaml`](../../../contract/openapi.yaml) is, restated as
arithmetic in `contract/schema.sql` and as acceptance criteria in
`contract/scenarios/T3-orders-money.md`:

```
discount = floor(subtotal * percent_off / 100)
fee      = floor((subtotal - discount) * FEE_PERCENT / 100) + FEE_FIXED_CENTS
total    = subtotal - discount + fee
```

The fee is charged on the subtotal **after** the discount.

Every amount is an integer in the chain's native unit, and one native unit is
one minor unit of the event's currency: a seat priced `price_cents: 2500` costs
2500 wei. The reasoning is in
[`contract/onchain/rules.yaml`](../../../contract/onchain/rules.yaml) under
`denomination`. No floating point anywhere — Solidity has none, `0.8.x`
arithmetic is checked by default, and nothing here opts out with `unchecked`.

## The deployment declaration

`make run` writes `deployment/deployment.json`, or wherever
`$CHAIN_DEPLOYMENT` points. It records **every transaction the deployer sent, in
order, as calldata**, plus the resulting addresses and runtime code hashes:

```json
{
  "schema": "ticketforge.onchain.deployment/1",
  "deployer": "0xf39F…",
  "contracts": { "PrimarySale": { "address": "0x5FbD…", "runtime_code_hash": "0x…" } },
  "steps": [{ "index": 0, "kind": "deploy", "contract": "PrimarySale", "data": "0x60a0…", "address": "0x5FbD…" }]
}
```

That file is the whole interface with the grader. The suite replays the step
list from nonce 0 onto a chain of its own and requires every declared address to
come back identical — a `CREATE` address is a pure function of (deployer,
nonce), so that one check proves the declaration is the whole truth. Which in
turn means the grader imports nothing from this directory, and the same suite
grades a Foundry or Vyper implementation with no change.

`send()` in `scripts/deploy.ts` is the only place a transaction is sent, and it
records the same `data` string it broadcasts, so the file cannot drift from what
happened.

## Environment

See [`.env.example`](./.env.example). Everything is optional and there is
deliberately **no** private key, RPC URL or mnemonic override: role addresses
come from the standard local development mnemonic by index, declared in
`contract/onchain/rules.yaml`. Account 0 is the platform, 1 and 2 are the two
organisers, 3 and up are buyers.

| | | |
|---|---|---|
| `CHAIN_DEPLOYMENT` | `./deployment/deployment.json` | where `make run` writes its declaration |
| `FEE_PERCENT` | `5` | percentage component of the booking fee |
| `FEE_FIXED_CENTS` | `30` | fixed component of the booking fee |
| `TICKETFORGE_ROOT` | the repository root | where `contract/` is, for a container that mounts it elsewhere |

## Notes on two things that look like omissions

**There is no `nonReentrant` modifier on the withdrawals.** That is deliberate
and the comment above `withdrawOrganizerProceeds` says why: the safety property
is the order of two lines — zero the books, then make the external call — and a
guard bolted over the top would let that ordering rot while still passing. The
contract's own test (`test/sale.test.ts`, via `contracts/test/ReentrantReceiver.sol`)
asserts the ordering directly, with a recipient that really calls back.

**`buy` splits its mint loop into `_mintAll`.** Not a style choice: `buy` was
one local variable past the EVM's sixteen-slot reach, and the alternative was
turning on `viaIR`, which would multiply the build time for every candidate and
every grading run.

**Gas is not optimised beyond the obvious.** The optimizer is on at 200 runs and
the hot paths avoid repeated storage reads, but nothing here is contorted for
gas. It is out of scope for this family — see `_SPEC.md` — because there is no
objective bar at this scale and a 12% cheaper mint is not a better answer to any
of the tickets.
