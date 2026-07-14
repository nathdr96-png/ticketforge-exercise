# BUG-605 — API pods restart every few minutes once an on-sale starts

- **Reported by:** Priya (Site Reliability / on-call)
- **Severity:** S1 — intermittent outage under exactly the load we expect
- **Affects:** API deployment

## What happened

Friday's 10:00 on-sale. Within ninety seconds the API pods started cycling:
every pod restarted at least four times in the first ten minutes. Buyers got 502s
and the seat map intermittently failed to load. It settled down once the rush was
over.

The pods are not crashing — the logs stop mid-request with no error, and the
restart reason is `OOMKilled` with exit code 137. Memory climbs steadily from the
moment traffic arrives and the pod is killed on the way up.

This is the load the product is sized for. `contract/perf-budget.yaml` has a
number for exactly this scenario and we are nowhere near honouring it in the
deployment.

## Steps to reproduce

1. Put the API under the concurrency load in `contract/perf-budget.yaml`
   (`conformance/concurrency` is the same shape).
2. Watch resident memory, then watch the restart count.
3. Compare the memory ceiling the deployment grants a pod with the peak RSS the
   performance budget already commits to.

Expected: a pod can reach the budgeted peak without being killed.
Actual: the pod is killed well before it, every time, under the load the budget
describes.

## Notes

Nothing in the application changed. The API's own memory profile under the
concurrency suite is the same as it was in August — I checked against the old
run.

There is a configuration change from the autumn capacity review described as
"tightened so we fit more API pods per node". Steady-state usage is indeed well
under it. On-sale usage is not, and on-sale is the product.

## Definition of done

- The API survives the load in `contract/perf-budget.yaml` without being killed.
- The deployment's memory ceiling and the published performance budget agree, and
  cannot drift apart again without something failing.
