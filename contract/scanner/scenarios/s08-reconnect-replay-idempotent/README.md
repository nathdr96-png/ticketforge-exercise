# s08-reconnect-replay-idempotent

Two things the server does on reconnect, both of which have broken real
devices:

1. **It re-sends records the device already synced.** Replaying
   `tkt_arena_A01-01` twice must change nothing at all — not the admitted set,
   not the queue, not `admitted_total`. A device that treats an inbound record
   as "new information" and re-queues it duplicates every record it ever
   uploaded, and one that *resets* its admitted set from the inbound batch lets
   the same ticket in twice.

2. **It pushes records from other gates.** `tkt_arena_B05-07` was admitted at
   the far door and this device has never seen it. Absorbing it is what makes a
   multi-gate venue safe: the next scan of that ticket here is a `DUPLICATE`.

`replay_total` counts every inbound record and `replay_absorbed_total` counts
the ones that were new, so the two cases above are separately visible. Local
throughput (`admitted_total`) deliberately does not move for a replay: it is a
count of people this door let in.
