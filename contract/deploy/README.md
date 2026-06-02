# Deployment contract

The source of truth for the **infra / DevOps** role family, the way
[`../openapi.yaml`](../openapi.yaml) is the source of truth for the backend
family and [`../analytics/questions.yaml`](../analytics/questions.yaml) is for
the data family. Everything in here is additive: it does not change the REST
surface, the schema, the seed or the analytics questions, and no other family is
affected by it.

| File | What it is |
|---|---|
| [`topology.yaml`](./topology.yaml) | What has to be deployed: the workloads, their ports, their health endpoints, the configuration each one needs and where each value is allowed to come from. |
| [`policy.yaml`](./policy.yaml) | The policy rules asserted over the **rendered** configuration. Each rule has a stable id, the assertion in one sentence, why a reviewer cares, and whether the visible suite checks it or it is assessed at review. |

The grader is [`../../conformance/infra/`](../../conformance/infra/).

## Why this family is graded on rendered configuration

The other families are graded by running something. A backend is graded by
calling it over HTTP; a data slot is graded on the files it wrote. Infrastructure
has the awkward property that the thing you would most like to measure — "does it
deploy, stay up and survive a rollout" — needs a cluster, a cloud account and
twenty minutes per attempt, and would grade the cluster as much as the candidate.

So this family is graded the way infrastructure is actually *reviewed*: on the
configuration, statically. Two kinds of check, in order of how much they tell
you:

1. **Validity.** Does it parse, and does every object match the schema of the
   thing it claims to be? This is table stakes and worth few points. It is also
   not nothing: strict schema validation catches `readinessProb`, a probe under
   `spec` instead of `spec.template.spec.containers[]`, and a `replicas: "2"`
   string — all of which a cluster rejects and a human reviewer misses.
2. **Declared policy.** Does the configuration assert the properties a reviewer
   would actually block the PR over? Is the database password a literal in the
   repo? Is the readiness probe pointing at the endpoint that really reports
   readiness, on the port the container really listens on? Is the hold-expiry
   sweeper running in a way that can double-sweep? Is the image pinned? Does CI
   genuinely run the conformance suite, or does it `echo` and exit 0?

The second kind is where the signal is, and it is why this contract exists:
without a declared policy, "assert properties over the parsed configuration" is
just one reviewer's taste. `policy.yaml` writes the taste down so a Helm chart, a
Terraform configuration and a directory of plain manifests are all held to the
same bar.

## The interface

An implementation **renders** its configuration into a directory and exits. It
does not deploy anything, and nothing in the grader needs a cluster, a cloud
credential or a container runtime.

```
$RENDER_DIR/
  index.json                 # the manifest of what was rendered (required)
  k8s/ticketforge.yaml       # whatever the index declares
  ci/deploy.yml
```

`make run` does the rendering and must honour `RENDER_DIR`, defaulting to
`./rendered` inside the slot. `index.json` is the only file whose name is fixed:

```json
{
  "version": 1,
  "toolchain": [{ "name": "helm", "version": "v3.16.3" }],
  "artifacts": [
    { "kind": "kubernetes",      "path": "k8s/ticketforge.yaml" },
    { "kind": "github-workflow", "path": "ci/deploy.yml", "name": "deploy" }
  ]
}
```

### Artifact kinds

The suite normalises every artifact into one internal deployment model and
asserts policy against that model. The **normalisers live in the grader**, not in
the implementation: a slot renders real artifacts in their native form and never
reports on itself, exactly as a data slot writes result rows and never reports
its own score.

| `kind` | What the file must be | Normalised into |
|---|---|---|
| `kubernetes` | A YAML stream (`---`-separated) of Kubernetes objects. What `helm template` prints, or what a Terraform `local_file` wrote, or hand-written manifests concatenated. | workloads, services, ingresses, network policies, secrets, config maps |
| `github-workflow` | One GitHub Actions workflow file. | the CI model: triggers, jobs, steps |
| `compose` | One Compose-spec file. Services become workloads; `deploy.replicas` becomes the replica count; `healthcheck` becomes the readiness probe. | workloads, services |

Several artifacts of the same kind are allowed and are merged. An artifact of an
unknown kind fails `DEP-001` rather than being ignored — silently skipping a file
would mean grading half a deployment and calling it green.

Adding a stack to this family means teaching `make run` to render these files.
Adding a *new kind* of artifact means writing a normaliser in
`conformance/infra/model.ts`; that is a change to the grader, not to a slot.

## Running it

```bash
cd slots/devops-cloud-engineer/k8s-helm
make install && make run            # renders into ./rendered

cd ../../../conformance/infra && npm install
RENDER_DIR=../../slots/devops-cloud-engineer/k8s-helm/rendered npx vitest run
```

`RENDER_DIR` has no default, for the same reason it has none in
`conformance/data`: silently grading the wrong directory, or a stale one, is
worse than refusing to run.

## What this contract deliberately does not say

- **Which cloud.** No rule names a provider, a region, an instance type or a
  managed-service SKU. Those are real decisions and they are reviewed in the
  debrief; they are not objectively gradeable here and pretending otherwise would
  reward whoever guessed the same cloud we did.
- **How Postgres and Redis are run.** The contract requires the connection
  strings to arrive from a secret reference. Whether that secret points at a
  managed instance, an operator-managed cluster or a StatefulSet in the same
  namespace is the implementation's call. The *one* thing the contract insists on
  is that no credential is a literal in the repository or in the rendered output.
- **Cost, autoscaling targets and alert thresholds.** Judgement calls with no
  objective answer at this scale. Say what you chose in your PR description.

## Relationship to the repository's own infrastructure

This is not a generic example deployment. The workloads in `topology.yaml` are
the ones this repository already has:

| Workload | What it actually runs |
|---|---|
| `api` | A backend slot — the image built by a backend slot's Dockerfile, whatever its stack. Listens on `PORT`, reports on `GET /health`. |
| `web` | The built web app from a `slots/frontend-developer/*` slot, served as static files. |
| `hold-expiry-worker` | The sweeper that expires holds past their TTL and emits `hold.expired` to the outbox. This is the same invariant `contract/scenarios/T2-holds.md` and the data family's `q4_seat_hold_history` depend on, which is why it has a policy rule of its own. |
| `migrate` | `make migrate` against the contract schema, before the API rolls. |

The root [`docker-compose.yml`](../../docker-compose.yml) is the local
development version of the same system and is where the environment variable
names come from.
