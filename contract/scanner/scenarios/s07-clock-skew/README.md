# s07-clock-skew

Turnstile hardware keeps time with a coin cell, and coin cells die. The local
wall clock in this transcript reads 2030, then 1970, then the right time again;
none of it changes a single decision.

What the device decides against is its **trusted clock**: the last
authoritative time it was handed over the link, carried forward by elapsed
monotonic time. That is why `TICK 18000` expires a ticket and `NOW` never does.

The window itself is in the ticket and is signed, so a skewed device cannot
widen it. Arena tickets are valid from 1788282000 to 1788300000 — doors two hours
before the advertised start, closing three hours after it.

The last scan is deliberate: a ticket that has already been admitted reads
`DUPLICATE` and not `EXPIRED`. "Already used" is independent of what time it is,
and it is the answer the person on the door can act on.
