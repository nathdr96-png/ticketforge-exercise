# FEAT-30 — Show what a promo code is worth before the customer pays

- **Requested by:** Sam (Product)
- **Type:** Feature
- **Affects:** checkout, discounts

## Context

Buyers can already enter a promo code and we send it on to the API, but nothing on
the page changes until the order comes back. So the customer types `SAVE10`,
sees the same total as before, assumes the code did not take, and either
abandons or writes to support. Noor's queue has 60-odd of these a month.

Marketing prints two codes on partner material: `SAVE10` (10% off, any event) and
`ARENA20` (20% off, Riverside Arena only). They want to print more, and they want
the saving visible on the page before the customer commits.

## What we want

When a customer applies a code we recognise, the checkout panel immediately shows
the discount and recalculates the fee and total — before the purchase is made.
The order the API returns is still what the customer is actually charged.

## Acceptance criteria

1. Applying a code we recognise updates the discount, fee and total lines on the
   checkout panel straight away, with no purchase and no extra round trip.
2. The figures shown are computed exactly as the pricing contract specifies,
   including which amount the fee is calculated on. They must match the confirmed
   order to the cent.
3. All amounts are integer minor units. No floating-point arithmetic anywhere on
   the money path.
4. A code restricted to one event previews only on that event. On any other event
   it is treated as not recognisable here.
5. A code we do not recognise must not silently preview as zero discount dressed
   up as success: make it clear the code will be checked when the order is placed,
   and let the API have the final word.
6. Removing an applied code puts the panel back to the undiscounted figures.
7. The API remains the authority. Nothing here may change what we send to it, and
   a code the API rejects must still surface the contract's discount error with
   the hold intact.

## Out of scope

- Administering codes (marketing loads them for now)
- Stacking more than one code
- Fixed-amount (non-percentage) discounts

## Definition of done

- The acceptance criteria above hold, evidenced by tests you write.
- The pricing contract and `contract/testids.md` are respected exactly — read
  them first.
