# BUG-802 — The same order gets a different risk score depending on the batch

- **Reported by:** Noor (Customer Success)
- **Severity:** S2 — we are declining and apologising to the same buyer on the same order
- **Affects:** order risk scoring, review queue

## What happened

Noor's team works two lists: the overnight scoring run across everything, and a
smaller ad-hoc run when a buyer calls in and they want to see where that order
sits. The two disagree.

She noticed it because a buyer rang about an order that had been held for review.
Noor re-scored that order's event on its own to look at it in context, and the
order came back low risk — so she released it. The next overnight run put it back
in the queue, high. She released it again. Three days running.

It is not one order. She took yesterday's overnight list, re-scored a third of it
as its own batch, and more than half of those orders changed score.

## Example

The same five orders, from the overnight run and from a re-run of a subset:

| order | overnight list | re-run of a subset |
|---|---|---|
| ord_r05120 | 0.812 | 0.344 |
| ord_r05121 | 0.041 | 0.118 |
| ord_r05140 | 0.663 | 0.702 |
| ord_r05155 | 0.009 | 0.051 |
| ord_r05170 | 0.274 | 0.609 |

Noor: "I cannot tell a buyer their order is being reviewed and then tell them it
is fine and then tell them it is being reviewed again. They think we are making
it up. So do I, slightly."

## Steps to reproduce

1. Run the model and produce the predictions for the full holdout.
2. Produce the predictions for the smaller holdout file the reporting contract
   also requires — it is a declared subset of the same orders.
3. For each order in the subset, compare the two scores.

Expected: identical. The same order, the same model.
Actual: most of them differ, and some of them differ enough to move the order in
or out of the queue.

## Notes

Noor's ad-hoc runs are not special in any way — she runs exactly the same command
with a smaller input file.

Worth knowing: the live path scores one order at a time, as it is placed. Nobody
has checked what that path returns.

## Definition of done

- An order's score is the same whether it is scored alone, in a batch of a few
  hundred, or in the whole overnight run.
- The reporting contract's rule about this is respected exactly — read it before
  you start; it says which property is being asserted and why it matters in
  production.
- A test covers it, because nothing did.
