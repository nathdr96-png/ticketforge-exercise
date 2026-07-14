# FEAT-33 — Checkout must refuse a hold that is no longer live

- **Requested by:** Marcus (Venue Operations)
- **Type:** Feature
- **Affects:** checkout, seat holds

## Context

Two things happened at the arena on Saturday and I think they are the same thing.

A buyer put four seats on hold, gave up and released them. Somebody else held and
bought two of those seats twenty minutes later. Then the first buyer's phone
retried the checkout it had abandoned, and we charged her for all four. Two of
those seats were in use by other people.

Separately, a tout has worked out that the ten-minute hold timer does not really
expire for him. He holds a block, lets the timer run out, comes back the next
morning and converts it. Those seats have been off sale all night and the seat
map said they were free the whole time.

A hold is a promise that expires. Checkout is currently willing to honour one
that has already been released, has already timed out, or has already been paid
for. It needs to stop.

## What we want

Converting a hold into an order succeeds only while that hold is still a live
claim on its seats. Anything else is refused, with the error code the contract
already defines for it, and nothing is charged.

## Acceptance criteria

1. A hold that has already become an order cannot become a second one. The
   refusal uses the contract's "already converted" code.
2. A hold that was released cannot be converted. The refusal uses the contract's
   "expired" code.
3. A hold whose time has run out cannot be converted, whether or not anything has
   got round to tidying it up yet. Same code as (2).
4. A refused checkout charges nothing, creates no order, and leaves every seat's
   state exactly as it was. A seat that was released and resold stays with the
   person who bought it.
5. A hold whose time has run out is tidied up as part of being refused — its
   seats go back on sale rather than staying off sale until something else
   notices.
6. Checkout on a live hold is unchanged: same prices, same fee, same discount
   behaviour, same idempotency behaviour. In particular a genuine retry of a
   request we have already answered still replays the original order rather than
   being refused by (1) — those two are easy to confuse and the contract
   distinguishes them.
7. The error codes and statuses come from `contract/errors.md`. Do not invent
   one.

## Out of scope

- Changing the hold duration, or making it configurable per event.
- Extending or renewing a hold (Sam has a separate ticket for that).
- Anything about how expiry is swept in the background; this is about what
  checkout is willing to accept.

## Definition of done

- The acceptance criteria above hold, evidenced by tests you write.
- Read `contract/openapi.yaml` and `contract/errors.md` first: every code and
  status you need is already specified.
