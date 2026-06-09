import { describe, expect, it } from "vitest";
import { loadModel } from "./model.js";
import { ruleText } from "./contract.js";
import { validateSchemas } from "./tools.js";

/**
 * Black-box conformance for the infra family — part one: is it valid at all?
 *
 * The suite never reads an implementation. It reads the configuration an
 * implementation RENDERED into $RENDER_DIR and grades that, so a Helm chart, a
 * Terraform configuration, plain manifests and a Compose file are all held to the
 * same bar — the same arrangement as conformance/data, which reads result files
 * and never looks at the query that produced them.
 *
 * Validity is table stakes and worth few points. It is not nothing: strict
 * schema validation is the only thing in this repository that catches
 * `readinessProb`, a probe indented under the wrong parent, and `replicas: "2"`.
 * The assertions a reviewer would actually block a PR over are in policy.test.ts.
 */

const KNOWN_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "Pod",
  "ReplicaSet",
  "Service",
  "Ingress",
  "IngressClass",
  "NetworkPolicy",
  "ConfigMap",
  "Secret",
  "ServiceAccount",
  "Role",
  "RoleBinding",
  "ClusterRole",
  "ClusterRoleBinding",
  "PodDisruptionBudget",
  "HorizontalPodAutoscaler",
  "Namespace",
  "PersistentVolumeClaim",
  "ResourceQuota",
  "LimitRange",
  "PriorityClass",
  "ServiceMonitor",
  "PodMonitor",
]);

describe("infra validity", () => {
  it(`DEP-001 ${ruleText("DEP-001")}`, () => {
    const model = loadModel();
    expect(model.loadProblems, model.loadProblems.join("\n")).toEqual([]);
    expect(
      model.index.artifacts.length,
      `index.json in ${model.dir} declares no artifacts`
    ).toBeGreaterThan(0);
    const kinds = new Set(model.index.artifacts.map((a) => a.kind));
    expect(
      kinds.has("kubernetes") || kinds.has("compose"),
      `index.json declares only ${[...kinds].join(", ")}. A deployment needs at least ` +
        `one artifact describing the workloads — a 'kubernetes' or 'compose' artifact.`
    ).toBe(true);
  });

  it(`DEP-002 ${ruleText("DEP-002")}`, () => {
    const model = loadModel();
    const problems: string[] = [...model.parseProblems];
    for (const doc of model.docs) {
      const where = `${doc.source} document ${doc.index}`;
      if (!doc.apiVersion) problems.push(`${where}: no apiVersion`);
      if (!doc.kind) problems.push(`${where}: no kind`);
      if (!doc.name) problems.push(`${where}: no metadata.name`);
      if (doc.kind && !KNOWN_KINDS.has(doc.kind)) {
        problems.push(
          `${where}: kind ${doc.kind} is not a Kubernetes kind this suite recognises. ` +
            `If it is a custom resource, say so in your PR description — it will not be graded.`
        );
      }
    }
    // The implementation rendered something and declared it; if nothing parsed
    // out of it, that is a silent empty deployment and the worst possible pass.
    if (model.index.artifacts.some((a) => a.kind === "kubernetes")) {
      expect(
        model.docs.length,
        "a 'kubernetes' artifact was declared but no documents parsed out of it"
      ).toBeGreaterThan(0);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it(`DEP-003 ${ruleText("DEP-003")}`, () => {
    const model = loadModel();
    if (model.kubeFiles.length === 0) return; // a compose-only slot: nothing to schema-check
    const result = validateSchemas(model.kubeFiles);
    expect(
      result.ok,
      `${result.command}\n\n${result.output}`
    ).toBe(true);
  });

  it("DEP-003 (parser) replica counts, quantities and probe shapes are the types the schema requires", () => {
    // A second, self-contained pass over the same documents. It overlaps with
    // kubeconform on purpose: these three mistakes are the ones that survive a
    // human review, and asserting them here means the failure message names the
    // workload and the field rather than a JSON-schema path.
    const model = loadModel();
    const problems: string[] = [];
    for (const doc of model.docs) {
      const spec = (doc.obj as Record<string, any>).spec ?? {};
      if (spec.replicas !== undefined && !Number.isInteger(spec.replicas)) {
        problems.push(
          `${doc.kind}/${doc.name}: spec.replicas is ${JSON.stringify(spec.replicas)}, ` +
            `which is ${typeof spec.replicas} and not an integer`
        );
      }
    }
    for (const w of model.workloads) {
      for (const c of w.containers) {
        for (const [bucket, values] of [
          ["requests", c.resources.requests],
          ["limits", c.resources.limits],
        ] as const) {
          for (const [key, raw] of Object.entries(values)) {
            if (!/^[0-9]*\.?[0-9]+\s*(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/.test(String(raw))) {
              problems.push(
                `${w.kind}/${w.name} container ${c.name}: resources.${bucket}.${key} = ` +
                  `${JSON.stringify(raw)} is not a Kubernetes quantity`
              );
            }
          }
        }
        for (const [which, probe] of Object.entries(c.probes)) {
          if (probe && probe.mechanism === "unknown") {
            problems.push(
              `${w.kind}/${w.name} container ${c.name}: ${which}Probe declares no ` +
                `httpGet, exec, tcpSocket or grpc — it checks nothing`
            );
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
