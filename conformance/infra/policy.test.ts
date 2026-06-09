import { describe, expect, it } from "vitest";
import {
  type Model,
  type WorkloadModel,
  describeWorkload,
  envOf,
  loadModel,
  workloadsForRole,
} from "./model.js";
import { type WorkloadSpec, loadTopology, ruleText } from "./contract.js";
import { scanForCredentials } from "./credentials.js";

/**
 * Black-box conformance for the infra family — part two: the declared policy.
 *
 * This is where the signal is. validity.test.ts asks whether the configuration
 * parses and matches the schema, which any templating engine gets right by
 * accident. These tests ask the questions a reviewer would actually block a pull
 * request over, and every one of them is the assertion written down in
 * contract/deploy/policy.yaml — the test names quote it, so a CI failure reads
 * like the review comment it stands in for.
 */

const TOPOLOGY = loadTopology();

function fail(problems: string[]): void {
  expect(problems, problems.length ? "\n" + problems.join("\n") : "").toEqual([]);
}

/** The one workload declaring this role. Null when zero or more than one do. */
function soleWorkload(model: Model, role: string): WorkloadModel | null {
  const found = workloadsForRole(model, role);
  return found.length === 1 ? found[0] : null;
}

/** A Kubernetes label selector against a set of labels. */
function selectorMatches(
  selector: Record<string, any>,
  labels: Record<string, string>
): boolean {
  const matchLabels = (selector.matchLabels ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(matchLabels)) {
    if (labels[k] !== String(v)) return false;
  }
  for (const expr of selector.matchExpressions ?? []) {
    const value = labels[expr.key];
    const values = (expr.values ?? []).map(String);
    switch (expr.operator) {
      case "In":
        if (value === undefined || !values.includes(value)) return false;
        break;
      case "NotIn":
        if (value !== undefined && values.includes(value)) return false;
        break;
      case "Exists":
        if (value === undefined) return false;
        break;
      case "DoesNotExist":
        if (value !== undefined) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** Shell lines of a `run:` block, comments and blanks removed. */
function shellLines(run: string): string[] {
  return run
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "").trim())
    .filter((l) => l.length > 0);
}

const RUNNER =
  /\b(?:npx\s+vitest|vitest\s+run|npm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|make\s+test|npx\s+playwright)\b/;
// A command line that cannot fail, or does not run anything: a bare `echo`, a
// `|| true`, a trailing `; true`. Deliberately NOT a bare `true` anywhere in the
// line — `npm test --silent=true` runs the suite, and a matcher that called that
// neutralised would be the same mistake this rule exists to catch.
const NEUTRALISED = /^(?:echo|printf|:|true|#)\b|\|\|\s*true\b|;\s*true\s*$/;

// --------------------------------------------------------------- topology

describe("infra policy: topology", () => {
  it(`DEP-010 ${ruleText("DEP-010")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      const found = workloadsForRole(model, spec.role);
      if (found.length === 0) {
        problems.push(
          `no workload declares ${TOPOLOGY.role_label}=${spec.role}. The contract ` +
            `requires it: ${spec.description.replace(/\s+/g, " ").trim()}`
        );
      } else if (found.length > 1) {
        problems.push(
          `${found.length} workloads declare ${TOPOLOGY.role_label}=${spec.role} ` +
            `(${found.map((w) => w.name).join(", ")}); the grader cannot tell which ` +
            `one the contract's rules are about`
        );
      }
    }
    fail(problems);
  });

  it("DEP-010 every workload declares the configuration the contract requires", () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue; // reported by the test above
      // A whole-Secret `envFrom` import brings in keys the rendered output does
      // not list, and correctly so. It therefore satisfies a required secret
      // value without naming it.
      const wildcardSecret = workload.containers.some((c) =>
        c.env.some((e) => e.name === "*" && e.source === "secretRef")
      );
      for (const want of spec.config ?? []) {
        if (!want.required) continue;
        const found = envOf(workload, want.name);
        if (found.length === 0) {
          if (want.from === "secret" && wildcardSecret) continue;
          problems.push(
            `${describeWorkload(workload)}: ${want.name} is not configured, and the ` +
              `contract requires it (from: ${want.from})`
          );
        }
      }
    }
    fail(problems);
  });

  it(`DEP-014 ${ruleText("DEP-014")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      if (spec.min_replicas === undefined) continue;
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue;
      if (workload.replicas === null) continue; // a kind without replicas
      if (workload.replicas < spec.min_replicas) {
        problems.push(
          `${describeWorkload(workload)}: ${workload.replicas} replica(s), the contract ` +
            `requires at least ${spec.min_replicas}. One replica means every deploy and ` +
            `every node drain is an outage.`
        );
      }
    }
    fail(problems);
  });

  it(`DEP-015 ${ruleText("DEP-015")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      if (!spec.singleton) continue;
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue;
      const want = spec.exactly_replicas ?? 1;
      if (workload.replicas !== null && workload.replicas !== want) {
        problems.push(
          `${describeWorkload(workload)}: ${workload.replicas} replicas, and this workload ` +
            `must run exactly ${want}. Two sweepers racing the same expired hold emit ` +
            `hold.expired twice — which double-counts in every outbox-derived report — or ` +
            `release a seat a second time after a buyer has re-held it.`
        );
      }
      if (!spec.rollout?.must_not_overlap) continue;
      const strategy = workload.strategy;
      const recreate = strategy?.type === "Recreate";
      const zeroSurge =
        strategy?.type !== "Recreate" &&
        strategy?.maxSurge !== undefined &&
        (String(strategy.maxSurge) === "0" || String(strategy.maxSurge) === "0%");
      const declared = Boolean(workload.annotations["ticketforge.io/singleton-mechanism"]);
      if (!recreate && !zeroSurge && !declared) {
        problems.push(
          `${describeWorkload(workload)}: rollout can run two instances at once ` +
            `(strategy ${JSON.stringify(workload.strategy)}). replicas=1 is not enough: a ` +
            `default rolling update starts the replacement before the old pod stops, so ` +
            `every deploy is a window with two sweepers in it. Use strategy.type=Recreate, ` +
            `maxSurge=0, or declare a single-admission mechanism in the ` +
            `ticketforge.io/singleton-mechanism annotation.`
        );
      }
    }
    fail(problems);
  });
});

// ------------------------------------------------------------ supply chain

describe("infra policy: supply chain and capacity", () => {
  it(`DEP-011 ${ruleText("DEP-011")}`, () => {
    const model = loadModel();
    const forbidden = new Set(TOPOLOGY.images.forbid_tags.map((t) => t.toLowerCase()));
    const problems: string[] = [];
    for (const w of model.workloads) {
      for (const c of w.containers) {
        const { raw, tag, digest } = c.image;
        if (digest && TOPOLOGY.images.digest_satisfies_pinning) continue;
        if (!tag) {
          problems.push(
            `${describeWorkload(w)} container ${c.name}: image ${JSON.stringify(raw)} has ` +
              `no tag and no digest, so it resolves to whatever the registry calls latest`
          );
          continue;
        }
        if (forbidden.has(tag.toLowerCase())) {
          problems.push(
            `${describeWorkload(w)} container ${c.name}: image ${JSON.stringify(raw)} is ` +
              `pinned to the floating tag "${tag}". Two pods of the same workload can end ` +
              `up on different builds and there is no previous version to roll back to.`
          );
        }
      }
    }
    fail(problems);
  });

  it(`DEP-012 ${ruleText("DEP-012")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const w of model.workloads) {
      for (const c of w.containers) {
        for (const required of TOPOLOGY.resources.require) {
          const [bucket, key] = required.split(".") as ["requests" | "limits", string];
          if (c.resources[bucket]?.[key] === undefined) {
            problems.push(
              `${describeWorkload(w)} container ${c.name}: no resources.${bucket}.${key}`
            );
          }
        }
      }
    }
    fail(problems);
  });
});

// ------------------------------------------------------------------ health

describe("infra policy: health", () => {
  it("DEP-013 readiness probes point at the contract's health path on the container's own port", () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      if (!spec.readiness?.required) continue;
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue;
      const container = workload.containers[0];
      const probe = container?.probes.readiness;
      if (!probe) {
        problems.push(
          `${describeWorkload(workload)}: no readiness probe. Without one the rollout ` +
            `sends traffic to a pod the moment its process starts, which for the API ` +
            `means into something that is still connecting to Postgres.`
        );
        continue;
      }
      const wantPath = spec.readiness.path ?? spec.health_path;
      if (wantPath && probe.path !== wantPath) {
        problems.push(
          `${describeWorkload(workload)}: readiness probe checks ` +
            `${JSON.stringify(probe.path ?? null)}, the contract's readiness endpoint is ` +
            `${JSON.stringify(wantPath)}. A path that merely returns 200 reports a process ` +
            `that bound a socket, not a service that can serve.`
        );
      }
      const httpPort = spec.http_port;
      if (httpPort !== null && probe.resolvedPort !== httpPort) {
        const declared = container.ports.map((p) => `${p.name ?? "(unnamed)"}=${p.containerPort}`);
        problems.push(
          `${describeWorkload(workload)}: readiness probe targets port ` +
            `${JSON.stringify(probe.port ?? null)}` +
            (probe.resolvedPort === null
              ? ` which resolves to nothing`
              : ` (resolved: ${probe.resolvedPort})`) +
            `, but the contract's HTTP port for this role is ${httpPort}. ` +
            `The container declares ${declared.length ? declared.join(", ") : "no ports"}. ` +
            `A probe on the wrong port never succeeds, so the pod never becomes ready ` +
            `and the rollout stalls — or, worse, it answers and reports something else healthy.`
        );
      }
    }
    fail(problems);
  });

  it("DEP-013 every workload the contract requires a liveness probe for has one", () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads) {
      if (!spec.liveness?.required) continue;
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue;
      const container = workload.containers[0];
      if (!container?.probes.liveness) {
        problems.push(
          `${describeWorkload(workload)}: no liveness probe. A wedged process keeps its ` +
            `place in the Deployment forever and nothing restarts it.`
        );
      }
    }
    fail(problems);
  });
});

// ----------------------------------------------------------------- secrets

describe("infra policy: secrets", () => {
  it(`DEP-016 ${ruleText("DEP-016")}`, () => {
    const model = loadModel();
    const sensitive = new Set(TOPOLOGY.secrets.sensitive_env);
    const problems: string[] = [];
    for (const w of model.workloads) {
      for (const c of w.containers) {
        for (const env of c.env) {
          if (!sensitive.has(env.name)) continue;
          if (env.source === "secretRef") continue;
          problems.push(
            `${describeWorkload(w)} container ${c.name}: ${env.name} is a ${env.source} ` +
              `value, not a secret reference. The contract marks it sensitive, which means ` +
              `it must arrive from a secret the rendered configuration only names — a ` +
              `literal here is in the repository, in every clone of it, in the CI log that ` +
              `printed the diff and in \`kubectl get -o yaml\` for anyone with read access.`
          );
        }
      }
    }
    fail(problems);
  });

  it(`DEP-017 ${ruleText("DEP-017")}`, () => {
    const model = loadModel();
    const findings = scanForCredentials(model.texts);
    fail(
      findings.map(
        (f) => `${f.file}:${f.line}: ${f.rule} — ${f.excerpt}`
      )
    );
  });
});

// -------------------------------------------------------------- networking

describe("infra policy: networking", () => {
  it(`DEP-018 ${ruleText("DEP-018")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const svc of model.services) {
      if (svc.type !== TOPOLOGY.networking.internal_service_type) {
        problems.push(
          `Service/${svc.name} is type ${svc.type}. Everything but the ` +
            `${TOPOLOGY.networking.public_entrypoint} must be ` +
            `${TOPOLOGY.networking.internal_service_type}: a LoadBalancer or NodePort here ` +
            `is a second front door straight past the ingress and whatever TLS and rate ` +
            `limiting live there.`
        );
      }
      const selected = model.workloads.filter(
        (w) =>
          Object.keys(svc.selector).length > 0 &&
          Object.entries(svc.selector).every(([k, v]) => w.podLabels[k] === v)
      );
      if (selected.length === 0) {
        problems.push(
          `Service/${svc.name} selects ${JSON.stringify(svc.selector)}, which matches no ` +
            `rendered workload. It will route to no endpoints and fail silently.`
        );
        continue;
      }
      for (const port of svc.ports) {
        const declared = selected.flatMap((w) => w.containers.flatMap((c) => c.ports));
        const ok =
          typeof port.targetPort === "number" || /^\d+$/.test(String(port.targetPort ?? ""))
            ? declared.some((p) => p.containerPort === Number(port.targetPort))
            : port.targetPort === null
              ? declared.some((p) => p.containerPort === port.port)
              : declared.some((p) => p.name === String(port.targetPort));
        if (!ok) {
          problems.push(
            `Service/${svc.name} port ${port.port} targets ` +
              `${JSON.stringify(port.targetPort)}, which no selected container declares ` +
              `(declared: ${declared.map((p) => `${p.name ?? "(unnamed)"}=${p.containerPort}`).join(", ") || "none"})`
          );
        }
      }
    }
    fail(problems);
  });

  it("DEP-019 a default-deny ingress NetworkPolicy selects every pod in the namespace", () => {
    if (!TOPOLOGY.networking.default_deny_ingress_required) return;
    const model = loadModel();
    const defaultDeny = model.networkPolicies.filter(
      (p) =>
        p.selectsAllPods &&
        p.policyTypes.includes("Ingress") &&
        (p.ingress === null || p.ingress.length === 0)
    );
    expect(
      defaultDeny.length,
      `no default-deny ingress policy. The contract requires a NetworkPolicy with ` +
        `podSelector: {} and policyTypes: [Ingress] and no ingress rules, so that nothing ` +
        `in the namespace is reachable until something says otherwise. Without it a ` +
        `compromised web pod can open a connection straight to Postgres. ` +
        `Rendered policies: ${
          model.networkPolicies.length
            ? model.networkPolicies
                .map(
                  (p) =>
                    `${p.name} [selectsAllPods=${p.selectsAllPods}, types=${p.policyTypes.join("+") || "none"}, ingressRules=${p.ingress?.length ?? 0}]`
                )
                .join("; ")
            : "none"
        }`
    ).toBeGreaterThan(0);
  });

  it("DEP-019 no policy both selects every pod and permits all ingress", () => {
    const model = loadModel();
    const allowAll = model.networkPolicies.filter(
      (p) =>
        p.selectsAllPods &&
        Array.isArray(p.ingress) &&
        p.ingress.some((rule) => {
          if (!rule || typeof rule !== "object") return true;
          const r = rule as Record<string, unknown>;
          const keys = Object.keys(r);
          if (keys.length === 0) return true;
          const from = r.from as unknown[] | undefined;
          return Array.isArray(from) && from.length === 0 && r.ports === undefined;
        })
    );
    fail(
      allowAll.map(
        (p) =>
          `NetworkPolicy/${p.name} selects every pod and permits all ingress. It appears in ` +
            `every listing as a network policy and permits exactly as much as having none.`
      )
    );
  });

  it("DEP-019 the API is reachable only through an explicit allow rule", () => {
    if (!TOPOLOGY.networking.default_deny_ingress_required) return;
    const model = loadModel();
    const api = soleWorkload(model, "api");
    if (!api) return; // DEP-010 reports this
    const allowing = model.networkPolicies.filter(
      (p) =>
        !p.selectsAllPods &&
        p.policyTypes.includes("Ingress") &&
        selectorMatches(p.podSelector, api.podLabels) &&
        Array.isArray(p.ingress) &&
        p.ingress.some((rule) => {
          const r = (rule ?? {}) as Record<string, unknown>;
          return Array.isArray(r.from) && r.from.length > 0;
        })
    );
    expect(
      allowing.length,
      `no NetworkPolicy explicitly allows ingress to the API. With a default-deny ` +
        `baseline in place and nothing opening it, the API is unreachable; with no ` +
        `baseline at all, it is reachable by everything. Either way the policy set does ` +
        `not say who may talk to it. Policies selecting the API: ${
          model.networkPolicies
            .filter((p) => selectorMatches(p.podSelector, api.podLabels))
            .map((p) => `${p.name} [types=${p.policyTypes.join("+") || "none"}, ingressRules=${p.ingress?.length ?? 0}]`)
            .join("; ") || "none"
        }`
    ).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------- lifecycle

describe("infra policy: lifecycle", () => {
  it(`DEP-020 ${ruleText("DEP-020")}`, () => {
    const model = loadModel();
    const problems: string[] = [];
    for (const spec of TOPOLOGY.workloads as WorkloadSpec[]) {
      if (spec.type !== "job") continue;
      const workload = soleWorkload(model, spec.role);
      if (!workload) continue;
      if (!["Job", "CronJob"].includes(workload.kind)) {
        problems.push(
          `${describeWorkload(workload)}: the contract declares this role a one-shot job, ` +
            `so it must be a Job or CronJob, not a ${workload.kind}`
        );
      }
      const allowed = spec.restart_policy ?? [];
      if (allowed.length && workload.restartPolicy && !allowed.includes(workload.restartPolicy)) {
        problems.push(
          `${describeWorkload(workload)}: restartPolicy ${workload.restartPolicy}, the ` +
            `contract allows ${allowed.join(" or ")}`
        );
      }
      if (spec.backoff_limit_required && workload.backoffLimit === null) {
        problems.push(
          `${describeWorkload(workload)}: no backoffLimit. A failed migration then retries ` +
            `indefinitely, holding locks against a live database with the API queued behind it.`
        );
      }
    }
    fail(problems);
  });
});

// ---------------------------------------------------------------------- ci

describe("infra policy: ci", () => {
  function workflow(model: Model) {
    const wanted = TOPOLOGY.ci.workflow_name;
    return (
      model.workflows.find((w) => w.name === wanted) ??
      model.workflows.find((w) => w.source.includes(wanted)) ??
      model.workflows[0] ??
      null
    );
  }

  it(`DEP-030 ${ruleText("DEP-030")}`, () => {
    const model = loadModel();
    const wf = workflow(model);
    expect(
      wf,
      `no github-workflow artifact in index.json. The deployment pipeline is part of ` +
        `the deliverable: contract/deploy/topology.yaml requires a workflow named ` +
        `"${TOPOLOGY.ci.workflow_name}" to be rendered and it is parsed, not just counted.`
    ).not.toBeNull();
    if (!wf) return;

    const steps = wf.jobs.flatMap((j) => j.steps.map((s) => ({ job: j, step: s })));
    const problems: string[] = [];

    for (const want of TOPOLOGY.ci.must_invoke) {
      const mentioning = steps.filter(
        ({ step }) => step.run && want.matches.some((m) => step.run!.includes(m))
      );
      if (mentioning.length === 0) {
        problems.push(
          `no step in workflow "${wf.name}" invokes ${want.id} ` +
            `(looked for any of: ${want.matches.join(", ")})`
        );
        continue;
      }
      // Mentioning it is not running it. The failure mode this catches is a step
      // that still names the suite in an `echo`, so the workflow reads correct
      // and the gate is gone.
      const real = mentioning.filter(({ step }) =>
        shellLines(step.run!).some((line) => RUNNER.test(line) && !NEUTRALISED.test(line))
      );
      if (want.id === "conformance" && real.length === 0) {
        problems.push(
          `step "${mentioning[0].step.name}" in job "${mentioning[0].job.id}" mentions ` +
            `${want.matches.join("/")} but never runs it. Its commands are:\n` +
            shellLines(mentioning[0].step.run!)
              .map((l) => `      ${l}`)
              .join("\n") +
            `\n    A job that prints that the suite passed is a green check mark over an ` +
            `unvalidated deployment, and it looks identical to a working pipeline in every ` +
            `view except the log.`
        );
      }
    }
    fail(problems);
  });

  it(`DEP-031 ${ruleText("DEP-031")}`, () => {
    const model = loadModel();
    const wf = workflow(model);
    if (!wf) return; // DEP-030 reports this
    const pattern = new RegExp(TOPOLOGY.ci.actions_ref_pattern);
    const problems: string[] = [];
    for (const job of wf.jobs) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        if (step.uses.startsWith("./") || step.uses.startsWith("docker://")) continue;
        const at = step.uses.lastIndexOf("@");
        const ref = at === -1 ? "" : step.uses.slice(at + 1);
        if (!pattern.test(ref)) {
          problems.push(
            `job "${job.id}" step "${step.name}": uses ${step.uses} — ` +
              (ref
                ? `"${ref}" is not a version tag or a commit sha`
                : `no ref at all`) +
              `. A branch ref is a third party deciding what runs with our deployment ` +
              `credentials, whenever they feel like it.`
          );
        }
      }
    }
    fail(problems);
  });

  it(`DEP-032 ${ruleText("DEP-032")}`, () => {
    const model = loadModel();
    const wf = workflow(model);
    if (!wf) return;
    const missing = TOPOLOGY.ci.triggers_required.filter((t) => !wf.triggers.includes(t));
    fail(
      missing.map(
        (t) =>
          `workflow "${wf.name}" does not run on ${t} (triggers: ` +
          `${wf.triggers.join(", ") || "none"}). Validation that runs only after merge ` +
          `tells you what you have already shipped.`
      )
    );
  });
});
