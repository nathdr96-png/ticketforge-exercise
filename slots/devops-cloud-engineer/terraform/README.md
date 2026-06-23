# infra/terraform — TicketForge deployment rendered by Terraform

The same deployment as [`../k8s-helm`](../k8s-helm/), rendered by Terraform
instead of Helm: the API, the web app, the hold-expiry sweeper, the schema
migration, the Services, the Ingress, the NetworkPolicies, the ServiceAccount
and the disruption budgets, plus the deployment pipeline in `ci/deploy.yml`.

It exists to prove a claim the family makes and could otherwise only assert:
that the grading surface is a **rendered artifact set**, not a toolchain. This
slot renders four `kubernetes` artifacts where the Helm slot renders one, it has
no templating language in common with it, and
[`conformance/infra`](../../../conformance/infra/) grades both without a line of
stack-specific code.

## Terraform as a renderer

`versions.tf` declares exactly one provider, `hashicorp/local`. That is
deliberate and worth reading before you reach for the kubernetes provider:

- `kubernetes_manifest` needs a live API server to produce even a *plan*, so a
  configuration built on it cannot be validated — let alone graded — without a
  cluster. It would also mean grading the cluster.
- `local_file` + `templatefile()` is a real pattern teams use when the apply step
  belongs to a GitOps controller or to `kubectl apply` in a pipeline, which is
  what `ci/deploy.yml` does here. Terraform owns the configuration; something
  else owns the rollout.

The cost is honest: this configuration has no drift detection, because it manages
files rather than cluster objects. Say so in a design review; do not pretend
otherwise.

## How this slot is graded

```bash
make install        # terraform init — the one step that needs the network, once
make run            # terraform apply → $RENDER_DIR (default ./rendered), then exits
make test           # terraform fmt -check + validate + plan + kubeconform --strict
make lint           # the first three, no render needed

# the grader
cd ../../../conformance/infra && npm install
RENDER_DIR=../../slots/devops-cloud-engineer/terraform/rendered npx vitest run
```

Four targets, like every slot. No `migrate` and no `seed`: this slot owns no
database and starts no process — it only renders.

`make run` wipes the render directory **and the state file** first. State
describes files on disk here, and those are build outputs rather than
infrastructure — carrying state across renders would mean Terraform refusing to
recreate a file somebody deleted, which is a confusing way to discover that the
render directory is not durable.

### Toolchain

`terraform` is required. `kubeconform` is optional here and required by the
grader. Both are looked for on `PATH` and then in
`$HOME/.local/toolchains/<name>/`:

```bash
mkdir -p $HOME/.local/toolchains/terraform $HOME/.local/toolchains/kubeconform
curl -sSL -o /tmp/tf.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
unzip -o /tmp/tf.zip -d $HOME/.local/toolchains/terraform
curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.6.7/kubeconform-linux-amd64.tar.gz \
  | tar -xz -C $HOME/.local/toolchains/kubeconform
```

`make install` puts providers in a shared plugin cache under
`$HOME/.local/toolchains/terraform-plugin-cache`. That is not a nicety:
rendering from several fresh copies of this slot (as CI or a reviewer might)
would otherwise download 18MB of provider each time and depend on the registry
being reachable. Override with
`TF_PLUGIN_CACHE_DIR`.

## What is in here

| Path | What it is |
|---|---|
| `versions.tf` | Required versions and the one provider. |
| `variables.tf` | Every input, typed. One validation block — on image pinning — and the comment there explains why there is exactly one. |
| `terraform.tfvars` | The committed values: the equivalent of the Helm slot's `values.yaml`. |
| `main.tf` | Labels, image references, and the six `local_file` resources that write the artifact set. |
| `templates/workloads.yaml.tftpl` | API, web, sweeper, migration job. |
| `templates/networking.yaml.tftpl` | Two ClusterIP Services and the Ingress. |
| `templates/networkpolicies.yaml.tftpl` | Default-deny ingress, then what the topology needs. |
| `templates/rbac.yaml.tftpl` | ServiceAccount and the two disruption budgets. |
| `ci/deploy.yml` | The deployment workflow. Rendered as an artifact and parsed by the suite. |
| `tools/install.py` | `make install`. `terraform init` with the shared plugin cache. |
| `tools/render.py` | `make run`. |
| `tools/check.py` | `make test`. Four real tool invocations and no assertions of its own. |

## The three decisions worth reading before changing anything

They are the same three as the Helm slot's, because they are properties of the
product rather than of the toolchain. In brief, with the long version in the
templates themselves:

- **The sweeper is a singleton, and that is correctness, not capacity.** Two
  hold-expiry workers racing an expired hold either emit `hold.expired` twice —
  double-counting in every outbox-derived report, including the data family's
  `q4_seat_hold_history` — or release a seat a second time after a buyer has
  re-held it. `replicas = 1` is half of it; `strategy: type: Recreate` in
  `templates/workloads.yaml.tftpl` is the other half, because a default rolling
  update starts the replacement before the old pod stops.
- **`hold_ttl_seconds` is one variable read by two workloads.** If those numbers
  drift apart the shorter one wins, and seats are swept out from under buyers
  still inside the countdown the API promised them.
- **Secrets are created out of band and this configuration only names them.**
  There is no password variable to fill in, and no expression in `main.tf` that
  can produce a literal for a sensitive value.

## What this slot does differently from the Helm slot

Worth knowing, because a reviewer comparing the two will notice:

- **Four manifest files instead of one.** Each concern is diffable on its own,
  and the suite merges them — which is how we know the interface is a directory
  of declared artifacts rather than a single file with extra steps.
- **No Helm hooks, so the migration ordering is explicit.** The Job carries a
  `ticketforge.io/run-before: api` annotation and `ci/deploy.yml` applies the
  manifests and then waits on the API rollout. Helm's `pre-install,pre-upgrade`
  hook is strictly better at this; this is the honest version of what Terraform
  can promise on its own.
- **`namespace:` is set on every object,** because there is no `helm --namespace`
  to supply it at apply time.
