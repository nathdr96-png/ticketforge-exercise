# FEAT-907 — Cap on-chain resale at a percentage of face value

- **Requested by:** Marcus (Venue Operations)
- **Type:** Feature
- **Affects:** on-chain resale

## Context

The reason we put these two events on chain at all was the resale story. A
ticket that can be resold, but not for triple, is the thing artists keep asking
us for and the thing I have been telling venues we can do.

Right now a ticket can be resold through our own contract for any price at all.
We register a cap per event — it is in the event's configuration and you can
read it back — and nothing uses it. The Club Show is set to 110% and the Jazz
Evening to 100%, and both will currently accept any number.

Noor has had the conversation with a fan already (BUG-903). I would rather we
had the feature than keep having the conversation.

## What we want

A resale through our contract is refused if the price is above the event's
declared percentage of what was paid for that seat on the primary sale.

## Acceptance criteria

1. Each event already carries a cap, expressed in basis points of face value
   (`resale_cap_bps`: 11000 is 110%, 10000 is 100%). Use it.
2. The base is the price actually paid for **that seat** on the primary sale,
   before any discount and before the booking fee. Not the event's cheapest
   section, not the lowest or the base price, and not the total the buyer
   handed over.
3. A listing above the cap is refused. A listing at exactly the cap is allowed —
   organisers use the whole allowance.
4. The contract can be asked what the highest allowed price for a given ticket
   is, and it answers with that number. A front end needs to show it before
   somebody tries.
5. A ticket bought with a discount code is capped on the same basis as one
   bought without. A concession to the buyer is not a reduction in what the seat
   is worth.
6. Transferring a ticket with no price attached still works. We are not locking
   tickets to wallets, and we are not stopping somebody giving their ticket to a
   friend.
7. A resale that is settled is still settled by crediting the seller, not by
   sending them money inside the buyer's transaction.

## Out of scope

- Royalties or a platform cut on resale. Different conversation, and Dana wants
  to think about it.
- Anything about sales that happen off our contract. We know we cannot see
  those; say so in the PR rather than pretending otherwise.
- Changing the caps themselves, or who can change them.

## Definition of done

- The acceptance criteria above hold.
- The rules the suite asserts are `ONC-030` and `ONC-031` in
  `contract/onchain/rules.yaml` — read them, and the reason and the stated
  limitation given with them, before you start.
- In your PR description, say what the cap does **not** protect against, and
  what you would need in order to protect against it.
