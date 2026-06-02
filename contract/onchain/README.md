# TicketForge on-chain contract

The contract for the **blockchain / protocol** role family: an on-chain primary
ticket sale with a capped resale and auditable settlement, for the events in
[`contract/seed/`](../seed/).

This directory is additive. It changes nothing about the HTTP product — the
same events, the same seats, the same prices, the same fee rule — and it adds
no second definition of anything the rest of `contract/` already defines.

| File | What it is |
|---|---|
| [`rules.yaml`](./rules.yaml) | the rules, with stable ids, the reason each one matters, and which suite enforces it |
| [`abi/PrimarySale.json`](./abi/PrimarySale.json), [`abi/TicketToken.json`](./abi/TicketToken.json) | the interface every implementation must present — the on-chain analogue of `openapi.yaml` |

The visible suite is [`conformance/blockchain/`](../../conformance/blockchain/);
some properties are also assessed at review. The family is described in
[`slots/blockchain-developer/_SPEC.md`](../../slots/blockchain-developer/_SPEC.md).

## Why this product gets a chain at all

Not because ticketing needs one. Because organisers ask for two things that are
awkward off chain and natural on it:

- **a resale that is not scalping.** A cap that travels with the ticket instead
  of living in one marketplace's terms of service.
- **settlement they can audit.** Every purchase, every fee and every withdrawal
  is a log entry with a block number on it, and the organiser can check their
  payout against the same arithmetic the revenue report publishes.

Everything else about the exercise follows from keeping those two honest.

## The shape of it

Two contracts.

**`TicketToken`** is an ERC-721, one token per seat. The token id is
`uint256(keccak256(seat_id))`, where `seat_id` is the seat's id in
[`seats.json`](../seed/seats.json) — so `seat_club_A01-07` has one id,
derivable by anybody holding the seed file, and the suite recomputes it rather
than asking the implementation what it thinks a seat is called. Only the
primary sale may mint. One seat, one token is the product's inventory rule
written on chain, and selling the same seat twice has the same shape here as it
does in the backend: off chain the defence is a row lock, here it is that the
token already exists.

**`PrimarySale`** holds everything else: the event registry, the sale, the
capped resale market and the settlement balances.

- **Primary sale.** A seat costs its section's seeded price. A purchase is
  refused outside the event's declared window, or if it would take the buyer's
  wallet over the per-event cap, or if the payment is not exact.
- **Resale.** A ticket can be transferred freely. A *priced* resale through the
  contract above `resale_cap_bps` of the price paid for that seat is refused.
  Proceeds are credited to the seller, never pushed to them.
- **Settlement.** An organiser withdraws their own event's proceeds; the
  platform withdraws the fees and owns the fee parameters.

## The money

There is **one** fee rule in TicketForge and this is not it —
[`contract/openapi.yaml`](../openapi.yaml) is, in the `Order` and
`RevenueReport` schemas, written out as arithmetic in the money comment above
the `orders` table in [`contract/schema.sql`](../schema.sql) and as acceptance
criteria in [`contract/scenarios/T3-orders-money.md`](../scenarios/T3-orders-money.md):

```
discount_cents = floor(subtotal_cents * percent_off / 100)
fee_cents      = floor((subtotal_cents - discount_cents) * FEE_PERCENT / 100) + FEE_FIXED_CENTS
total_cents    = (subtotal_cents - discount_cents) + fee_cents
```

with `FEE_PERCENT = 5` and `FEE_FIXED_CENTS = 30`. The fee is charged on the
subtotal **after** the discount, and that is the order people get wrong. On chain, the organiser is credited
`subtotal - discount` and the platform is credited the fee, which is the same
split `RevenueReport` publishes — so a withdrawal reconciles against a report
the organiser already receives.

**The unit.** There is no oracle, no stablecoin and no bridge here, and
inventing one would mean inventing a second money model for a product that has
exactly one. So the local chain's native unit stands in for the event
currency's **minor** unit, one for one: a seat priced `price_cents: 2500` costs
2500 wei. Every figure on chain is then the same integer a reader can find in
`contract/seed/`, the fee formula is reproduced with no scaling factor, and
there is nowhere for a float to appear. Scaling to 10^18 would add a multiplier
to every assertion and measure nothing.

No floating point, anywhere — on chain or in a deployment script. Solidity has
none; `0.8.x` arithmetic is checked by default, and an implementation should not
opt out of it with `unchecked`.

## What comes from `contract/seed/`

| | |
|---|---|
| events on chain | `event_club_100` (100 seats, section A at 2500, organiser `user_org_1`) and `event_jazz_eur` (100 seats, A at 4000 and B at 3500, organiser `user_org_2`) |
| not on chain | `event_arena_2000`, `event_draft`, `event_cancelled` |
| seat ids | every seat of those two events, from `seats.json` |
| discounts | `SAVE10` (10%) on the club event, from `seed.json` |

`event_arena_2000` is published and in the product, and it is deliberately not
on chain: registering 2000 seats is a gas-budget exercise, not a correctness
one, and it would add minutes to every grading run without asserting anything
the two 100-seat events do not already assert. The draft and cancelled events
are excluded because the product does not sell them — and the suite checks that
they are **absent**, not merely unmentioned.

This family touches no database, so it has no stake in
[`conformance/reserved-seats.json`](../../conformance/reserved-seats.json): the
seat territory negotiated between the browser suites and the analytics fixture
is about rows in Postgres, and nothing here writes any.

## Roles, keys and the chain

Addresses come from the standard local development mnemonic
(`test test test ... junk`) by index: account 0 is the platform, 1 and 2 are the
two organisers, 3 and up are buyers. Those keys are in every Hardhat and
Foundry installation on earth, which is exactly why they are the right ones
here.

Nothing in this family may need an internet RPC endpoint, a testnet, a faucet,
a mainnet fork, or a private key from the environment. That is not an
environment concession; it is what makes the grade reproducible. A rule that
depends on whether a faucet is rate-limiting today measures the faucet.

## The sale window

Declared in `rules.yaml` as two absolute instants rather than derived from the
clock at deploy time, so that a replayed deployment is identical to the
original one and the suite can assert the registered window without reading its
own clock. The suite moves its chain to a fixed instant inside the window and
fails loudly, with the reason, if that instant ever falls outside it.

## Rule ids

Stable, and quoted in the grader's test names so a failure reads like the
review comment it stands in for.

| Group | Ids |
|---|---|
| deployment | `ONC-001` … `ONC-003` |
| token | `ONC-010` … `ONC-012` |
| primary sale | `ONC-020` … `ONC-023` |
| resale | `ONC-030`, `ONC-031` |
| settlement | `ONC-040` … `ONC-043` |
| invariants | `ONC-050` … `ONC-052` |

Every rule is written down in `rules.yaml` in full. Many are checked by the
visible suite; the rest are assessed at review.

## The one rule that is only partly enforceable

`ONC-030` carries a `limitation` field, and it is the most important sentence in
this directory.

A chain can only price a sale it is party to. Two wallets can transfer a ticket
and settle in cash, or through a marketplace that takes payment somewhere else,
and no on-chain rule can see that price. What the cap buys is that the
contract's own market cannot be the venue for scalping, and that a priced
resale which does go through the contract is capped. Enforcing more than that
means soul-binding the ticket or whitelisting transfers, and both break the
resale the organiser actually wants.

An anti-scalping rule sold as absolute is a worse rule than one whose edge is
written down, so the edge is written down — in `rules.yaml`, next to the rule,
where an implementer reads it.
