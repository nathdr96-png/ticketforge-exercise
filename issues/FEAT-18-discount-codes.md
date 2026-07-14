# FEAT-18 — Discount codes at checkout

- **Requested by:** Sam (Product)
- **Type:** Feature
- **Affects:** checkout, pricing

## Context

Organizers run promotions and currently have no way to offer a code. Marketing
has already printed `SAVE10` on a partner mailer that goes out at the end of the
month, so the codes exist in our database but checkout ignores them.

## What we want

A buyer can supply a discount code when converting a hold into an order. The
order then shows what the discount was worth, and the total reflects it.

## Acceptance criteria

1. A buyer may pass a discount code at checkout. It is optional; existing
   checkout behaviour without a code must not change.
2. A valid, active code reduces the amount owed by its percentage of the seat
   subtotal, rounded in the customer's favour at the cent level.
3. Our booking fee is calculated on the discounted amount, not the original.
4. The resulting order records the code that was used and the discount amount, so
   Finance can reconcile it.
5. A code that does not exist, or is inactive, is rejected with the contract's
   discount error code. The order is not created.
6. A code restricted to one event cannot be used on a different event.
7. All amounts stay integer minor units. No floating-point arithmetic.

## Out of scope

- Creating or administering codes (organizers load them directly for now)
- Stacking more than one code on an order
- Fixed-amount (non-percentage) discounts

## Definition of done

- The acceptance criteria above hold, evidenced by tests you write.
- The pricing contract and error codes are respected exactly — read them first.
