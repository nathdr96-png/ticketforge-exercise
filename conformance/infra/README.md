# conformance/infra — the infrastructure / DevOps suite

Black-box and stack-agnostic, like every other suite in `conformance/`. It never
reads an implementation. It reads the configuration an implementation
**rendered** into a directory and asserts the policy in
[`contract/deploy/policy.yaml`](../../contract/deploy/policy.yaml) over it, so a
Helm chart, a Terraform configuration, a directory of plain manifests and a
Compose file are graded by exactly the same bar.

Nothing here deploys anything. No cluster, no cloud credential, no container
runtime.

## Why not "does it deploy"

Because that measurement needs a cluster, takes twenty minutes per attempt, and
grades the cluster as much as the candidate. This suite grades infrastructure the
way infrastructure is actually reviewed — on the configuration, statically — in
two layers:

| Layer | What it catches | Worth |
|---|---|---|
| **Validity** (`validity.test.ts`) | It does not parse. It is not the kind of object it claims to be. `readinessProb`. A probe indented under `spec` instead of `spec.template.spec.containers[]`. `replicas: "2"`. | Table stakes. Four tests. |
| **Declared policy** (`policy.test.ts`) | The database password is a literal. The readiness probe is on the wrong port. The sweeper is scaled out. The image is `:latest`. The Service is a LoadBalancer. The CI job echoes success. | The actual signal. Eighteen tests. |

The second layer is the point, and it is why `contract/deploy/policy.yaml`
exists: without a written-down policy, "assert properties over the parsed
configuration" is one reviewer's taste. Each test's name quotes the rule's
`assert:` line, so a CI failure reads like the review comment it stands in for.

## The interface

An implementation renders into a directory and exits. `index.json` is the only
file whose name is fixed; everything else is whatever it declares. See
[`contract/deploy/README.md`](../../contract/deploy/README.md) for the format and
the three artifact kinds (`kubernetes`, `github-workflow`, `compose`).

```bash
cd slots/devops-cloud-engineer/k8s-helm && make install && make run

cd ../../../conformance/infra && npm install
RENDER_DIR=../../slots/devops-cloud-engineer/k8s-helm/rendered npx vitest run
```

`RENDER_DIR` is required and has no default, for the same reason it has none in
`conformance/data`: silently grading the wrong directory — or a stale render from
before the last change — is worse than refusing to run.

### The normalisers are in the grader

`model.ts` turns `helm template` output, a Terraform-written manifest, a Compose
file and a GitHub Actions workflow into one deployment model, and every policy
assertion runs against that model. The normalisation is deliberately **ours**: a
slot renders real artifacts in their native form and never reports on itself. If
the implementation produced the model, every assertion would be grading a
self-assessment, and the cheapest way to pass would be to describe a deployment
rather than configure one. Compare `conformance/data`, which reads result rows
and never asks a slot whether its own numbers are right.

Adding a stack to this family is a change to `make run` in that slot. Adding a
new *kind* of artifact is a change to `model.ts`, the grader, not to a slot.

## Which checks are a real tool, and which are ours

Worth being precise about, because "we ran a validator" and "we wrote a
validator" are different claims:

| Check | What runs it |
|---|---|
| DEP-003 — Kubernetes schema validity | **`kubeconform --strict`**, a real external binary, against the JSON schemas vendored in [`schemas/`](./schemas/). |
| DEP-003 (parser) — quantity, replica and probe shapes | Ours, in `validity.test.ts`. It overlaps kubeconform on purpose: these three mistakes survive human review, and asserting them separately means the message names the workload and the field instead of a JSON-schema path. |
| DEP-001, DEP-002, DEP-010 … DEP-032 | Ours, over the parsed configuration. |

The schemas are vendored rather than fetched so that validation is deterministic
and works offline — a suite that needs GitHub to be up in order to grade somebody
is not a suite. `kubeconform` is also given its upstream schema location as a
second search path, so a document of a kind this repo has not vendored is still
validated rather than waved through.

A missing `kubeconform` makes DEP-003 **fail**, with the install command in the
message. It does not skip: a grader that could not validate must not report
green. Install it with:

```bash
mkdir -p $HOME/.local/toolchains/kubeconform
curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.6.7/kubeconform-linux-amd64.tar.gz \
  | tar -xz -C $HOME/.local/toolchains/kubeconform
```

`$KUBECONFORM` overrides the search if you keep it somewhere else. `helm` is
*not* needed by this suite — only by the Helm slot's own `make run`.

## What is assessed at review

Every rule in `contract/deploy/policy.yaml` is part of the assessment. This suite
checks many of them automatically; the rest are assessed at review. A green run
here therefore means the checked rules pass — not that the deployment satisfies
the policy. Read the policy itself; it is written down in full so that you are
never asked to guess.
