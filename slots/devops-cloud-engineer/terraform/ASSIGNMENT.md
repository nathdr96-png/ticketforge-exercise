# Your assignment

Welcome. You are working in `slots/devops-cloud-engineer/terraform`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/devops-cloud-engineer/terraform
make install
make run                     # renders into ./rendered
```

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/infra
npm install
RENDER_DIR=../../slots/devops-cloud-engineer/terraform/rendered npx vitest run
```

Nothing is deployed and nothing needs a cluster, a cloud account or a
container runtime. `make run` renders your deployment configuration
into `rendered/` and exits; the suite reads what came out and asserts
the policy in `contract/deploy/policy.yaml` over it. `make test` in the
slot runs the faster local checks (`terraform fmt -check`,
`terraform validate`, a `terraform plan` and schema validation).

Read `contract/deploy/` first. It is to this role what
`contract/openapi.yaml` is to the backend: every rule you are graded on
is written down there, with the reason a reviewer would care.

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

## Tickets assigned to you

- **Bug** — `issues/BUG-605-api-pods-restart-under-load.md`
- **Feature** — `issues/FEAT-31-network-policies-for-the-namespace.md`

Read the ticket, not just the failing test. The ticket is what the
reporter actually experienced.

## How we review this

- Does the bug actually stop happening, and did you fix the cause rather
  than suppress the symptom?
- Did anything else break? The whole suite must still pass.
- Is the change proportionate? We look at the size and shape of the diff.
- Did you add a test that would have caught this?
- Does the code look like it belongs in this codebase?
- Your commit history. Commit as you work; see CONTRIBUTING.md.

## Ground rules

- Do not edit `contract/` or `conformance/`. Add your own tests beside
  the code you change.
- Time-box: see `docs/TIERS.md`. Stop when the time is up and write down
  what you would do next — an honest note beats a rushed half-fix.
- AI assistance is allowed. Note where you used it in the message you
  send with your fork's URL. We will ask you to change something live in
  the debrief.

Provisioned 2026-10-10.
