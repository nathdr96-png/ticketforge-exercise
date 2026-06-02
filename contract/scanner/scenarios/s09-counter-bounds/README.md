# s09-counter-bounds

A scanner that has been on a door for three seasons has large counters. This
one starts six scans short of 2^32 and its record ids six short of 2^48, so a
`uint32_t` sequence number wraps to zero in the middle of the transcript and an
`int` record id goes negative.

Both numbers are read off the disk at boot and written back to it, so the bound
is reachable in ten lines instead of four billion. Nothing here is synthetic
about the arithmetic: the device really does have to carry a 2^32 sequence
number through a scan, a persist and a reload.

The declared safe bound is 2^53 - 1 — every counter is exchanged as a JSON
number and must survive the round trip exactly.

The seeded state has lifetime totals in the billions and an **empty**
`admitted.log`, which is not a contradiction: the admitted set is scoped to the
event this gate is commissioned to, and last season's log was archived off the
device. `admitted_known` and `queue_depth` are derived from the two logs rather
than read back from `counters.json`, so a device always believes what is
actually on its flash over what the last summary claimed.
