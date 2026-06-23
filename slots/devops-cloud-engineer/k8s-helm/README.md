# infra/k8s-helm — TicketForge deployment as a Helm chart

A Helm chart that deploys TicketForge: the API, the web app, the hold-expiry
sweeper and the schema migration, plus the Service, Ingress, NetworkPolicy,
ServiceAccount and PodDisruptionBudget objects around them. The deployment
pipeline (`ci/deploy.yml`) is part of the deliverable, not documentation of it.

## How this slot is graded

By what it *renders*, statically. There is no cluster here and the grader needs
none — see [`contract/deploy/README.md`](../../../contract/deploy/README.md) for
why, and [`conformance/infra/`](../../../conformance/infra/) for the suite.

```bash
make install        # checks the toolchain: helm, and kubeconform if you have it
make run            # renders into $RENDER_DIR (default ./rendered) and exits
make test           # helm lint + helm template + kubeconform --strict
make lint           # just the chart lint, no render needed

# the grader
cd ../../../conformance/infra && npm install
RENDER_DIR=../../slots/devops-cloud-engineer/k8s-helm/rendered npx vitest run
```

Four targets, like every slot in this repository. There is no `migrate` or
`seed`: this slot owns no database and starts no process — it only renders.

### Toolchain

`helm` is required. `kubeconform` is optional *here* and required by the grader.
Both are looked for on `PATH` and then in `$HOME/.local/toolchains/<name>/`,
which is where this repository installs tarball toolchains:

```bash
mkdir -p $HOME/.local/toolchains/helm $HOME/.local/toolchains/kubeconform
curl -sSL https://get.helm.sh/helm-v3.16.3-linux-amd64.tar.gz \
  | tar -xz -C $HOME/.local/toolchains/helm --strip-components=1
curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.6.7/kubeconform-linux-amd64.tar.gz \
  | tar -xz -C $HOME/.local/toolchains/kubeconform
```

## What is in here

| Path | What it is |
|---|---|
| `Chart.yaml` | Chart metadata. `appVersion` is kept in step with the image tags in `values.yaml`: a chart that says 1.14.3 and deploys `:latest` is a lie told to whoever reads `helm list`. |
| `values.yaml` | Every figure an operator changes. No credential appears in it, by construction — see "Secrets" below. |
| `values.staging.yaml` | Hosts and capacity only. Deliberately contains nothing that is a correctness property, because an environment file is exactly where those get quietly relaxed "just for staging" and then promoted. |
| `templates/_helpers.tpl` | Naming, labelling, the image helper and the secret-env helper. |
| `templates/api-deployment.yaml` | The API. 3 replicas, readiness/liveness/startup probes on `GET /health`, requests and limits. |
| `templates/web-deployment.yaml` | The built web app as static files. Holds no credential and talks to the API through the ingress. |
| `templates/worker-deployment.yaml` | The hold-expiry sweeper. A singleton, with a `Recreate` rollout — read the comment at the top of that file before changing either. |
| `templates/migrate-job.yaml` | The schema migration, as a `pre-install,pre-upgrade` hook so it finishes before the API rolls. |
| `templates/services.yaml` | Two ClusterIP Services, target ports by name. |
| `templates/ingress.yaml` | The one externally reachable object. |
| `templates/networkpolicy.yaml` | Default-deny ingress, then exactly what the topology needs. |
| `templates/serviceaccount.yaml` | One service account with no token mounted, plus the disruption budgets. |
| `ci/deploy.yml` | The deployment workflow. Rendered as an artifact and parsed by the suite. |
| `tools/render.py` | `make run`. Shells out to `helm template` and writes `index.json`. |
| `tools/check.py` | `make test`. Three real tool invocations and no assertions of its own. |

## Three decisions worth reading before you change anything

**The sweeper is a singleton, and that is correctness, not capacity.** Two
hold-expiry workers racing the same expired hold either emit `hold.expired`
twice — which double-counts in every report built on the outbox, including the
data family's `q4_seat_hold_history` — or release a seat a second time after a
buyer has already re-held it, which oversells. `replicas: 1` is necessary and not
sufficient: a default rolling update starts the replacement pod before the old
one stops, so every deploy would be a window with two sweepers in it. Hence
`strategy: type: Recreate`. Holds then expire a few seconds late during a deploy
instead of expiring twice; late is recoverable and twice is not.

**`hold.ttlSeconds` is one value read by two workloads.** The API advertises the
countdown to the buyer; the sweeper enforces it. If those numbers ever drift
apart the shorter one wins, and seats are swept out from under buyers who are
still inside a countdown the API promised them. Nothing in the backend suite can
see that, because each service is individually correct.

**Secrets are created out of band and this chart only names them.** There is no
`password:` field in `values.yaml` to accidentally fill in, and
`templates/_helpers.tpl` has no branch that produces a literal for a sensitive
value — the unsafe spelling is simply unavailable, which is more reliable than
reviewing for it. Whether the Secret comes from the platform team, a
sealed-secrets controller or an external-secrets operator is not this chart's
business; that it is never rendered here is.

## Installing it for real

Not required for grading, and not possible in this repository's environment,
which has no cluster. For the record:

```bash
kubectl create namespace ticketforge
kubectl -n ticketforge create secret generic ticketforge-app \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=JWT_SECRET="$JWT_SECRET"
helm upgrade --install ticketforge . -n ticketforge \
  --values values.yaml --values values.staging.yaml --atomic --timeout 10m
```

The `ticketforge-app` Secret and the `ticketforge-tls` Secret are the two
prerequisites. `--atomic` is deliberate: a failed migration hook should roll the
release back rather than leave half of it applied.
