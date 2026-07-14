# BUG-1102 — Scanner storage fills up when the network is out, and the loss figure is always zero

- **Reported by:** Marcus (Venue Operations)
- **Severity:** S2 — a door that works until it doesn't
- **Affects:** turnstile scanner, offline sync

## What happened

Two scanners on the west doors ran out of storage on Saturday. Both had been
offline for most of the first hour — the venue wifi was being reconfigured — and
both admitted people the whole time, which is what we want. But towards the end
of the hour they slowed right down and then one of them stopped writing anything
at all.

The device is specced to hold a fixed number of unsent records. Marcus asked me
what happens when it reaches that number, because the "records we lost" figure on
the end-of-night sheet is zero for every event we have ever run, and he does not
believe it.

## Example

Saturday, west door 2. By Dana's reckoning the device took around 600 scans
before the link came back. The device is specced to hold 64 unsent records.

| line | device says | what Marcus expects |
|---|---|---|
| scans taken | 600 | 600 |
| records sent up | 600 | at most 64 at any one time |
| records we lost | 0 | some number greater than zero |

Dana's reconciliation balances, which is the part that worries her: the figures
agree with each other and do not agree with the specification.

## Steps to reproduce

1. Run the scanner over the standard scenario set.
2. One scenario deliberately configures a small bound and then presents more
   people than it can hold.
3. Compare the number of unsent records the device is holding at the end against
   the bound it was configured with.

Expected: the device never holds more unsent records than it was configured for,
the door keeps admitting people regardless, and anything that had to be dropped
is counted so Dana can say how much of the night is unaccounted for.
Actual: the number of unsent records it is holding is not bounded by anything,
and the dropped count is structurally zero.

## Notes

Marcus is explicit about the trade-off and does not want it decided silently:
"I would rather lose a line on a spreadsheet than close a door on somebody who
paid." The published rule for what happens at the limit is in
`contract/scanner/`; read it before you change anything, because it is the
opposite of what the obvious fix does.

## Definition of done

- The unsent-record count never exceeds the configured bound, in any scenario.
- Every person is still admitted at the bound. The door does not close.
- The number of dropped records is accurate, and it reconciles: everything the
  device queued either went upstream, is still waiting, or was dropped and
  counted.
