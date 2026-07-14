# FEAT-806 — Risk score should look at the account, not just the order

- **Requested by:** Priya (Support Lead)
- **Type:** Feature
- **Affects:** order risk scoring, review queue

## Context

The risk queue currently ranks orders on what was bought: how many seats, how
much money, which event, which payment method. Priya's team can see what it is
doing, because the top of the list is the expensive orders.

That is not how they decide anything. When a reviewer opens an order, the first
thing they look at is the account: how long has it existed, has it bought before,
how many cards have been on it, how fast did this checkout happen, how many
orders have come off that address in the last day. An eight-seat arena order from
an account that has bought here nine times is the most ordinary thing in the
world. The same order from an account opened forty minutes ago, with its third
card, placed six seconds after the hold was created, is the thing they want at
the top of the list.

Priya has been doing this by hand: she takes the queue, ignores most of it, and
cross-references the buyer in the admin screens. It takes her the first hour of
every day and she is the only person who does it consistently.

## What we want

The risk score should take account of what we know about the buyer and the
session at the moment the order is placed, not only what was in the basket.

## Acceptance criteria

1. The score reflects the account's standing and history at order time — how long
   the account has existed, how much it has bought before, and how much of that
   was refunded.
2. It reflects velocity — how much activity has come from that buyer in the last
   hour and from that address in the last day.
3. It reflects the payment surface — how many distinct payment instruments the
   account has used.
4. It reflects the shape of the checkout itself — how long the buyer sat on the
   hold before paying, and how many attempts it took.
5. Every input is something we know **at the moment the order is placed**. The
   reporting contract is explicit about which columns qualify and which do not,
   and about how that is checked. Read it before you start; do not work it out
   from the column names.
6. The model clears the declared minimum on the holdout. It does not clear it
   today — that is the point of the ticket — and the contract also declares a
   minimum for the top of the queue, which is the number Priya feels.
7. Two runs of the job still produce identical predictions, and an order still
   scores the same whether it is scored alone or in a batch. Those properties
   hold now and must still hold afterwards.
8. No floating-point arithmetic anywhere near a money value. Derive ratios from
   the money columns if they help; do not write a money value back out as a
   float.

## Out of scope

- Deciding how many orders Support reviews per day, or any cut-off at all. The
  deliverable is a ranking.
- Any change to how orders, holds or accounts are recorded. Everything needed is
  already in the dataset.
- Blocking a checkout automatically.

## Definition of done

- The acceptance criteria above hold.
- The declared minimum is cleared on the holdout and on the second holdout file
  the contract requires, and the two figures agree.
- There is a test for each new group of inputs, and `make lint` in the slot
  passes.
- The write-up says which inputs were added, what each is worth, and — in one
  sentence Priya could read — why the queue is now in a different order.
