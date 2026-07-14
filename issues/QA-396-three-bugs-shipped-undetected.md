# QA-396 — Three releases in a row shipped a bug the regression suite passed

- **Reported by:** Marcus (Engineering Manager)
- **Severity:** S2 — we no longer trust a green build
- **Affects:** the API regression suite
- **Type:** Test coverage

## What happened

Three of our last five releases shipped a customer-visible bug. In every case the
regression suite was green before the release, green after it, and green while the
bug was in production. Two of the three were found by Finance; the third was found
by an organizer phoning Customer Success.

That is the problem I want fixed. The suite runs, it is fast, nobody has to babysit
it — and it did not see any of this:

**1. An organizer could not find their own show.** Noor took the call. The
organizer's event was published and loaded fine by direct link, but it never
appeared when you browsed the catalogue, and paging forward hit a blank page before
the end of the list. Every individual page looked perfectly normal, which is
presumably why nothing complained.

**2. Discounted orders were charged a cent too much.** Dana spotted it in payout
reconciliation. Only orders with a discount code, and only some of those — the ones
where the fee landed between cents. One cent per ticket, in our favour, which is
exactly the direction that gets you a letter. The suite had a test covering the
booking fee on a discounted order. It passed throughout.

**3. A payout report that did not add up.** Also Dana. The report showed a discount
line and a fee line and a headline figure that ignored both, so an organizer
invoiced us from a number we had never collected. Each column, read on its own, was
a plausible amount of money. Only the relationship between them was wrong. Dana
recomputed month-end by hand for three days.

All three had been fixed in the code by the time I wrote this. None of them had a
test, and in two of the three cases there *was* a test in the area that stayed
green — which worries me more than if there had been nothing at all.

## Steps to reproduce

1. Run the suite against the current backend. It passes.
2. Reintroduce any of the three behaviours above by hand in a scratch copy of the
   backend — break the catalogue's paging, round the booking fee up to the nearest
   cent, or report the payout headline as the pre-discount figure.
3. Run the suite again.

Expected: the suite fails, and the failure says which behaviour broke.
Actual: the suite still passes.

## Definition of done

Your suite must catch these behaviours. Treat each as a bug report from a
customer, and write the test that would have stopped it reaching them:

1. **The catalogue is complete.** Browsing it page by page returns every published
   event exactly once, starting at the first one, with no missing and no repeated
   entries and no phantom blank page.
2. **A discounted booking fee is correct to the cent.** Not "a fee was charged" —
   the exact amount the pricing rule in the contract produces, on a subtotal where
   getting the rounding direction wrong actually changes the answer. Most of our
   seat prices hide that difference; find one that does not.
3. **The payout report reconciles.** The headline figures agree with each other per
   the definitions in the reporting contract, the per-event breakdown sums to them,
   and the figures move by the right amounts when a new order is paid for.

And the standing bar, which matters as much as the three above:

4. **Every test still passes against the current, correct backend.** A suite that
   reports bugs that are not there gets ignored, and then it is worse than no
   suite. If you cannot make an assertion reliable, say so in the PR rather than
   leaving something that fails one run in five.
5. **A failure explains itself.** We read these in CI logs at 18:00 on a Friday.
   `expected 143 to be 142` is not a bug report.

## Notes

Do not change `contract/` or `conformance/`. If you think the contract is
ambiguous about any of the three — Dana has argued that one of them genuinely was —
write that down in the PR with the evidence. That is a useful finding, not a
failure to deliver.

I am interested in what else you find while you are in there. If a fourth gap is
obvious to you, cover it and say why you picked that one.
