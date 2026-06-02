# s06-queue-bound

The device has finite flash. Twenty scans, room for eight.

The contract's answer is that **the door never closes**: all twenty people are
admitted, because refusing entry to a paying customer because a log is full is a
worse failure than losing a reconciliation record. What must not happen is
losing the record *silently*, so the oldest unsynced record is dropped and
`queue_evicted_total` counts every drop. Finance can then see exactly how much
of the night is unaccounted for instead of discovering a gap later.

The admitted set is never evicted. It is the authority for "this ticket has
already been used" and dropping an entry from it would let somebody in twice.
