/**
 * The deployment contract, loaded.
 *
 * Nothing in this file knows what rendered it. The suite reads
 * contract/deploy/topology.yaml and contract/deploy/policy.yaml, reads whatever
 * an implementation left in $RENDER_DIR, and compares the two — so a Helm chart,
 * a Terraform configuration and a directory of plain manifests are graded by
 * exactly the same bar, in the same way conformance/data grades SQL, dbt and
 * pandas by comparing result files.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SCHEMA_DIR = path.join(import.meta.dirname, "schemas");

export type ArtifactKind = "kubernetes" | "github-workflow" | "compose";

export interface ConfigSpec {
  name: string;
  /** Where the value is allowed to come from: `secret`, `config` or `any`. */
  from: "secret" | "config" | "any";
  required?: boolean;
  /** This value must equal the same-named value on another role. */
  same_as?: string;
}

export interface WorkloadSpec {
  role: string;
  description: string;
  type: "long-running" | "job";
  http_port: number | null;
  port_env?: string;
  health_path?: string;
  readiness?: { path?: string; required: boolean };
  liveness?: { required: boolean };
  min_replicas?: number;
  singleton?: boolean;
  exactly_replicas?: number;
  rollout?: { must_not_overlap: boolean };
  memory_limit_at_least?: string;
  restart_policy?: string[];
  backoff_limit_required?: boolean;
  config: ConfigSpec[];
}

export interface Topology {
  render: { dir_env: string; default_dir: string; index: string; artifact_kinds: ArtifactKind[] };
  role_label: string;
  workloads: WorkloadSpec[];
  networking: {
    public_entrypoint: string;
    internal_service_type: string;
    ingress_routes: { host_var: string; path: string; role: string }[];
    default_deny_ingress_required: boolean;
  };
  secrets: { sensitive_env: string[]; rendered_material_forbidden: boolean };
  images: { require_tag: boolean; forbid_tags: string[]; digest_satisfies_pinning: boolean };
  resources: { require: string[]; applies_to: string };
  ci: {
    workflow_name: string;
    triggers_required: string[];
    must_invoke: { id: string; matches: string[] }[];
    actions_ref_pattern: string;
    forbid_floating_action_refs: string[];
  };
}

export interface PolicyRule {
  id: string;
  group: string;
  severity: "blocker" | "major" | "minor";
  assert: string;
  because: string;
  tool?: string;
}

export function loadTopology(): Topology {
  const file = path.join(REPO_ROOT, "contract", "deploy", "topology.yaml");
  const doc = parseYaml(fs.readFileSync(file, "utf8")) as Topology;
  if (!doc?.workloads?.length) throw new Error(`no workloads in ${file}`);
  return doc;
}

export function loadPolicy(): PolicyRule[] {
  const file = path.join(REPO_ROOT, "contract", "deploy", "policy.yaml");
  const doc = parseYaml(fs.readFileSync(file, "utf8")) as { rules: PolicyRule[] };
  if (!doc?.rules?.length) throw new Error(`no rules in ${file}`);
  return doc.rules;
}

/** One sentence for a test name: the rule id plus its assertion, de-wrapped. */
export function ruleText(id: string): string {
  const rule = loadPolicy().find((r) => r.id === id);
  if (!rule) throw new Error(`no such policy rule: ${id}`);
  return rule.assert.replace(/\s+/g, " ").trim();
}

/**
 * A figure the deployment contract borrows from another contract file.
 *
 * `memory_limit_at_least: perf-budget:runtime.max_rss_mb` means "whatever
 * contract/perf-budget.yaml already says the peak RSS is". Written as a
 * reference rather than a number so the two cannot drift: if the performance
 * budget is raised, the memory limit this suite demands rises with it.
 */
export function resolveContractRef(ref: string): number {
  const [file, dotted] = ref.split(":");
  if (file !== "perf-budget") throw new Error(`unknown contract reference ${ref}`);
  const doc = parseYaml(
    fs.readFileSync(path.join(REPO_ROOT, "contract", "perf-budget.yaml"), "utf8")
  ) as Record<string, unknown>;
  let node: unknown = doc;
  for (const key of dotted.split(".")) {
    node = (node as Record<string, unknown>)?.[key];
  }
  if (typeof node !== "number") throw new Error(`${ref} is not a number in perf-budget.yaml`);
  return node;
}

export function renderDir(): string {
  const raw = process.env.RENDER_DIR;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "RENDER_DIR is not set. This suite grades the configuration an implementation " +
        "RENDERED; it deploys nothing and renders nothing itself. Run `make run` in " +
        "the slot first, then point RENDER_DIR at its output. " +
        "See conformance/infra/README.md."
    );
  }
  return path.resolve(raw);
}
