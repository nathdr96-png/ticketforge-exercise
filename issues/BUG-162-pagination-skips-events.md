# BUG-162 — The first event is missing from the events list

- **Reported by:** Noor (Customer Success)
- **Severity:** S2
- **Affects:** events list, pagination

## What happened

Our earliest on-sale event does not appear anywhere in the browse list. The
organizer called in because they could not find their own show. Paging forward
also hits an empty page before the end of the list.

The event is definitely published — fetching it directly by id works.

## Steps to reproduce

1. Request the first page of the events list.
2. Compare the returned items against the total count in the response.

Expected: page 1 starts at the first event; walking the pages returns every event
exactly once.
Actual: page 1 begins partway in; one event is never returned and there is a
trailing empty page.

## Definition of done

- Walking every page returns each event exactly once, starting from the first.
- A regression test covers page 1.
