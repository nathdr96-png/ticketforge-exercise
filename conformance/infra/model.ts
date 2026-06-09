/**
 * The normalised deployment model.
 *
 * This is the stack-agnostic layer. An implementation renders real artifacts in
 * their native form — `helm template` output, a Terraform-written manifest, a
 * Compose file, a GitHub Actions workflow — and the normalisers here flatten
 * them into one model that the policy assertions run against.
 *
 * The normalisers live HERE, in the grader, and not in the implementation. That
 * is the whole design: a slot never reports on itself. If the implementation
 * produced the model, every policy assertion would be grading a self-assessment,
 * and the first thing a candidate under time pressure would learn is that the
 * cheapest way to pass is to describe a deployment rather than configure one.
 * Compare conformance/data, which reads result rows and never asks a slot
 * whether its own numbers are right.
 *
 * Adding a new artifact kind means adding a normaliser here, which is a change
 * to what this suite grades and should be treated like adding a suite.
 */

import fs from "node:fs";
import path from "node:path";
import { parseAllDocuments, parse as parseYaml } from "yaml";
import { type ArtifactKind, type Topology, loadTopology, renderDir } from "./contract.js";

// --------------------------------------------------------------------- types

export interface EnvVar {
  name: string;
  /** Where the value comes from. `literal` is the only one that puts it in the repo. */
  source: "literal" | "secretRef" | "configMapRef" | "fieldRef" | "other";
  value?: string;
  ref?: { name: string; key?: string };
  /** `env` for an explicit entry, `envFrom` for a whole-object import. */
  via: "env" | "envFrom";
}

export interface Probe {
  mechanism: "httpGet" | "exec" | "tcpSocket" | "grpc" | "unknown";
  path?: string;
  /** As written: a number or a port name. */
  port?: string | number;
  /** Resolved against the container's declared ports; null when unresolvable. */
  resolvedPort: number | null;
}

export interface ContainerModel {
  name: string;
  image: { raw: string; repository: string; tag: string | null; digest: string | null };
  ports: { name?: string; containerPort: number }[];
  env: EnvVar[];
  resources: {
    requests: Record<string, string>;
    limits: Record<string, string>;
  };
  probes: { readiness?: Probe; liveness?: Probe; startup?: Probe };
}

export interface WorkloadModel {
  /** The contract's role label value, or null when the workload does not declare one. */
  role: string | null;
  name: string;
  kind: string;
  /** null for kinds where replicas are not a concept (Job, CronJob). */
  replicas: number | null;
  strategy: { type?: string; maxSurge?: string | number; maxUnavailable?: string | number } | null;
  annotations: Record<string, string>;
  labels: Record<string, string>;
  podLabels: Record<string, string>;
  restartPolicy: string | null;
  backoffLimit: number | null;
  containers: ContainerModel[];
  source: string;
}

export interface ServiceModel {
  name: string;
  type: string;
  ports: { name?: string; port: number; targetPort: string | number | null }[];
  selector: Record<string, string>;
  source: string;
}

export interface NetworkPolicyModel {
  name: string;
  /** true when podSelector is `{}` — every pod in the namespace. */
  selectsAllPods: boolean;
  podSelector: Record<string, unknown>;
  policyTypes: string[];
  ingress: unknown[] | null;
  egress: unknown[] | null;
  source: string;
}

export interface SecretModel {
  name: string;
  keys: string[];
  /** true when the document carries `data` or `stringData` — i.e. the material itself. */
  hasMaterial: boolean;
  source: string;
}

export interface WorkflowStep {
  name: string;
  uses: string | null;
  run: string | null;
  if: string | null;
  continueOnError: boolean;
}

export interface WorkflowJob {
  id: string;
  name: string;
  if: string | null;
  continueOnError: boolean;
  steps: WorkflowStep[];
}

export interface WorkflowModel {
  name: string;
  triggers: string[];
  jobs: WorkflowJob[];
  source: string;
}

export interface KubeDoc {
  apiVersion: string | null;
  kind: string | null;
  name: string | null;
  obj: Record<string, unknown>;
  source: string;
  index: number;
}

export interface Model {
  dir: string;
  index: {
    version?: number;
    artifacts: { kind: string; path: string; name?: string }[];
    toolchain?: { name: string; version?: string }[];
    [k: string]: unknown;
  };
  /**
   * Problems with the artifact SET itself: a declared path that is not there, a
   * kind the contract does not define, an index that declares nothing. DEP-001.
   */
  loadProblems: string[];
  /**
   * Problems READING a declared artifact: it is not parseable YAML or JSON.
   * Kept apart from loadProblems so that the rule a failure is attributed to is
   * the rule it is actually about. DEP-002.
   */
  parseProblems: string[];
  docs: KubeDoc[];
  workloads: WorkloadModel[];
  services: ServiceModel[];
  networkPolicies: NetworkPolicyModel[];
  ingresses: { name: string; source: string; obj: Record<string, unknown> }[];
  secrets: SecretModel[];
  configMaps: { name: string; data: Record<string, string>; source: string }[];
  workflows: WorkflowModel[];
  /** Every artifact's raw text, for the credential scan (DEP-017). */
  texts: { path: string; text: string }[];
  /** Absolute paths of the rendered Kubernetes artifacts, for kubeconform. */
  kubeFiles: string[];
  topology: Topology;
}

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "ReplicaSet",
  "Pod",
]);

// ---------------------------------------------------------------- primitives

/** `ghcr.io/x/y:1.2.3`, `x/y@sha256:…`, `nginx` — split without guessing. */
export function parseImage(raw: string): ContainerModel["image"] {
  const at = raw.indexOf("@");
  if (at !== -1) {
    return { raw, repository: raw.slice(0, at), tag: null, digest: raw.slice(at + 1) };
  }
  const slash = raw.lastIndexOf("/");
  const colon = raw.lastIndexOf(":");
  // A colon before the last slash is a registry port, not a tag.
  if (colon > slash) {
    return { raw, repository: raw.slice(0, colon), tag: raw.slice(colon + 1), digest: null };
  }
  return { raw, repository: raw, tag: null, digest: null };
}

/** Kubernetes memory quantity → bytes. Returns null for anything unparseable. */
export function memoryBytes(q: string | undefined): number | null {
  if (q === undefined || q === null) return null;
  const m = /^([0-9]*\.?[0-9]+)\s*(Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|k|m)?$/.exec(String(q).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const scale: Record<string, number> = {
    "": 1,
    m: 1e-3,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  return n * scale[unit];
}

/** Kubernetes CPU quantity → millicores. Returns null for anything unparseable. */
export function cpuMillis(q: string | number | undefined): number | null {
  if (q === undefined || q === null) return null;
  const s = String(q).trim();
  const m = /^([0-9]*\.?[0-9]+)(m)?$/.exec(s);
  if (!m) return null;
  return m[2] === "m" ? Number(m[1]) : Number(m[1]) * 1000;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : v === undefined || v === null ? null : String(v);
}

function record(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = typeof val === "string" ? val : String(val);
  }
  return out;
}

// ------------------------------------------------------- kubernetes normaliser

function normaliseProbe(raw: unknown, ports: ContainerModel["ports"]): Probe | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, any>;
  const mechanism: Probe["mechanism"] = p.httpGet
    ? "httpGet"
    : p.exec
      ? "exec"
      : p.tcpSocket
        ? "tcpSocket"
        : p.grpc
          ? "grpc"
          : "unknown";
  const target = p.httpGet ?? p.tcpSocket ?? p.grpc ?? {};
  const port = target.port;
  let resolved: number | null = null;
  if (typeof port === "number") resolved = port;
  else if (typeof port === "string") {
    if (/^\d+$/.test(port)) resolved = Number(port);
    else resolved = ports.find((cp) => cp.name === port)?.containerPort ?? null;
  }
  return { mechanism, path: target.path, port, resolvedPort: resolved };
}

function normaliseEnv(
  container: Record<string, any>,
  configMaps: Map<string, Record<string, string>>,
  secretNames: Set<string>
): EnvVar[] {
  const out: EnvVar[] = [];
  for (const entry of container.env ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name);
    const from = entry.valueFrom;
    if (from?.secretKeyRef) {
      out.push({
        name,
        source: "secretRef",
        ref: { name: String(from.secretKeyRef.name), key: str(from.secretKeyRef.key) ?? undefined },
        via: "env",
      });
    } else if (from?.configMapKeyRef) {
      const cm = configMaps.get(String(from.configMapKeyRef.name));
      out.push({
        name,
        source: "configMapRef",
        value: cm?.[String(from.configMapKeyRef.key)],
        ref: {
          name: String(from.configMapKeyRef.name),
          key: str(from.configMapKeyRef.key) ?? undefined,
        },
        via: "env",
      });
    } else if (from?.fieldRef || from?.resourceFieldRef) {
      out.push({ name, source: "fieldRef", via: "env" });
    } else if (from) {
      out.push({ name, source: "other", via: "env" });
    } else {
      out.push({ name, source: "literal", value: str(entry.value) ?? "", via: "env" });
    }
  }
  // `envFrom` imports a whole object. A ConfigMap's keys are resolvable from the
  // rendered output; a Secret's deliberately are not, and that is the point —
  // they are counted as secret references without their values.
  for (const entry of container.envFrom ?? []) {
    if (entry?.configMapRef?.name) {
      const cm = configMaps.get(String(entry.configMapRef.name));
      for (const [k, v] of Object.entries(cm ?? {})) {
        out.push({
          name: k,
          source: "configMapRef",
          value: v,
          ref: { name: String(entry.configMapRef.name), key: k },
          via: "envFrom",
        });
      }
    } else if (entry?.secretRef?.name) {
      // Keys are unknown without the Secret's material. Recorded as a reference
      // to that Secret so DEP-016 can see the name even though the key list is
      // not in the rendered output — which is exactly how it should be.
      out.push({
        name: "*",
        source: "secretRef",
        ref: { name: String(entry.secretRef.name) },
        via: "envFrom",
      });
      secretNames.add(String(entry.secretRef.name));
    }
  }
  return out;
}

function normaliseContainer(
  raw: Record<string, any>,
  configMaps: Map<string, Record<string, string>>,
  secretNames: Set<string>
): ContainerModel {
  const ports = (raw.ports ?? [])
    .filter((p: any) => p && typeof p === "object" && p.containerPort !== undefined)
    .map((p: any) => ({ name: str(p.name) ?? undefined, containerPort: Number(p.containerPort) }));
  return {
    name: String(raw.name ?? "?"),
    image: parseImage(String(raw.image ?? "")),
    ports,
    env: normaliseEnv(raw, configMaps, secretNames),
    resources: {
      requests: record(raw.resources?.requests),
      limits: record(raw.resources?.limits),
    },
    probes: {
      readiness: normaliseProbe(raw.readinessProbe, ports),
      liveness: normaliseProbe(raw.livenessProbe, ports),
      startup: normaliseProbe(raw.startupProbe, ports),
    },
  };
}

function podSpecOf(obj: Record<string, any>): Record<string, any> | null {
  if (obj.kind === "Pod") return obj.spec ?? null;
  if (obj.kind === "CronJob") return obj.spec?.jobTemplate?.spec?.template?.spec ?? null;
  return obj.spec?.template?.spec ?? null;
}

function podMetaOf(obj: Record<string, any>): Record<string, any> {
  if (obj.kind === "Pod") return obj.metadata ?? {};
  if (obj.kind === "CronJob") return obj.spec?.jobTemplate?.spec?.template?.metadata ?? {};
  return obj.spec?.template?.metadata ?? {};
}

// -------------------------------------------------------- compose normaliser

/**
 * Compose services become workloads.
 *
 * `deploy.replicas` is the replica count, `healthcheck` is the readiness probe
 * (a Compose health check is what gates `depends_on: service_healthy`, which is
 * what readiness means here), and `deploy.resources` is requests/limits. The
 * role comes from the service name, since Compose has no labels by default — but
 * an explicit `labels` entry for the contract's role label wins, so a Compose
 * service can be named whatever the team calls it.
 */
function normaliseCompose(text: string, source: string, roleLabel: string, model: Model): void {
  const doc = parseYaml(text) as Record<string, any> | null;
  for (const [name, svc] of Object.entries(doc?.services ?? {})) {
    const s = svc as Record<string, any>;
    const labels = Array.isArray(s.labels)
      ? Object.fromEntries(
          (s.labels as string[]).map((l) => {
            const i = l.indexOf("=");
            return i === -1 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)];
          })
        )
      : record(s.labels);
    const env: EnvVar[] = [];
    const rawEnv = Array.isArray(s.environment)
      ? Object.fromEntries(
          (s.environment as string[]).map((e) => {
            const i = e.indexOf("=");
            return i === -1 ? [e, ""] : [e.slice(0, i), e.slice(i + 1)];
          })
        )
      : record(s.environment);
    for (const [k, v] of Object.entries(rawEnv)) {
      // `${VAR}` and a `secrets:` mount are references; anything else is a
      // literal sitting in the file.
      const isRef = /^\$\{?[A-Za-z_]/.test(String(v)) || String(v) === "";
      env.push({
        name: k,
        source: isRef ? "secretRef" : "literal",
        value: String(v),
        via: "env",
      });
    }
    for (const secret of s.secrets ?? []) {
      const sn = typeof secret === "string" ? secret : String(secret?.source ?? "");
      env.push({ name: sn.toUpperCase().replace(/-/g, "_"), source: "secretRef", ref: { name: sn }, via: "env" });
    }
    const ports = (s.expose ?? []).map((p: any) => ({ containerPort: Number(String(p).split("/")[0]) }));
    const hc = s.healthcheck?.test;
    const hcText = Array.isArray(hc) ? hc.join(" ") : String(hc ?? "");
    const hcPath = /https?:\/\/[^\s"']*?(\/[A-Za-z0-9._\-\/]*)/.exec(hcText)?.[1];
    const hcPort = /:(\d+)/.exec(hcText)?.[1];
    model.workloads.push({
      role: labels[roleLabel] ?? name,
      name,
      kind: "ComposeService",
      replicas: s.deploy?.replicas ?? 1,
      strategy: s.deploy?.update_config
        ? { type: s.deploy.update_config.order === "stop-first" ? "Recreate" : "RollingUpdate" }
        : null,
      annotations: labels,
      labels,
      podLabels: labels,
      restartPolicy: str(s.restart),
      backoffLimit: null,
      containers: [
        {
          name,
          image: parseImage(String(s.image ?? "")),
          ports: ports.length ? ports : hcPort ? [{ containerPort: Number(hcPort) }] : [],
          env,
          resources: {
            requests: record(s.deploy?.resources?.reservations),
            limits: record(s.deploy?.resources?.limits),
          },
          probes: hc
            ? {
                readiness: {
                  mechanism: "httpGet",
                  path: hcPath,
                  port: hcPort ? Number(hcPort) : undefined,
                  resolvedPort: hcPort ? Number(hcPort) : null,
                },
                liveness: {
                  mechanism: "httpGet",
                  path: hcPath,
                  port: hcPort ? Number(hcPort) : undefined,
                  resolvedPort: hcPort ? Number(hcPort) : null,
                },
              }
            : {},
        },
      ],
      source,
    });
  }
}

// ------------------------------------------------------- workflow normaliser

function normaliseWorkflow(text: string, source: string, declaredName?: string): WorkflowModel {
  const doc = (parseYaml(text) ?? {}) as Record<string, any>;
  // `on:` is YAML 1.1's boolean true. The `yaml` package parses 1.2 by default,
  // where it stays the string "on" — but a workflow written by a tool that emits
  // 1.1 would key it as `true`, so both spellings are read.
  const on = doc.on ?? doc.true ?? doc[true as unknown as string];
  const triggers = Array.isArray(on)
    ? on.map(String)
    : typeof on === "string"
      ? [on]
      : Object.keys(on ?? {});
  const jobs: WorkflowJob[] = Object.entries(doc.jobs ?? {}).map(([id, j]) => {
    const job = j as Record<string, any>;
    return {
      id,
      name: str(job.name) ?? id,
      if: str(job.if),
      continueOnError: job["continue-on-error"] === true || job["continue-on-error"] === "true",
      steps: (job.steps ?? []).map((s: Record<string, any>) => ({
        name: str(s?.name) ?? str(s?.uses) ?? "(unnamed step)",
        uses: str(s?.uses),
        run: str(s?.run),
        if: str(s?.if),
        continueOnError:
          s?.["continue-on-error"] === true || s?.["continue-on-error"] === "true",
      })),
    };
  });
  return { name: str(doc.name) ?? declaredName ?? path.basename(source), triggers, jobs, source };
}

// ------------------------------------------------------------------ loading

function emptyModel(dir: string, topology: Topology): Model {
  return {
    dir,
    index: { artifacts: [] },
    loadProblems: [],
    parseProblems: [],
    docs: [],
    workloads: [],
    services: [],
    networkPolicies: [],
    ingresses: [],
    secrets: [],
    configMaps: [],
    workflows: [],
    texts: [],
    kubeFiles: [],
    topology,
  };
}

let cached: Model | null = null;

/** Build the model once per process. Throws only when there is nothing to grade. */
export function loadModel(): Model {
  if (cached) return cached;
  const topology = loadTopology();
  const dir = renderDir();
  const model = emptyModel(dir, topology);

  if (!fs.existsSync(dir)) {
    throw new Error(
      `no render directory at ${dir}. Run \`make run\` in the slot under test first; ` +
        `it writes ${topology.render.index} and the artifacts that index declares.`
    );
  }
  const indexPath = path.join(dir, topology.render.index);
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `no ${topology.render.index} in ${dir}. Every infra slot renders one — see ` +
        `contract/deploy/README.md for the three fields it needs.`
    );
  }
  try {
    model.index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (err) {
    throw new Error(`${indexPath} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(model.index.artifacts) || model.index.artifacts.length === 0) {
    model.loadProblems.push(`${topology.render.index} declares no artifacts`);
  }

  const known = new Set<string>(topology.render.artifact_kinds);
  const configMaps = new Map<string, Record<string, string>>();
  const secretNames = new Set<string>();
  const kubeArtifacts: { file: string; rel: string }[] = [];

  // Pass one: read every file, collect ConfigMaps and Secrets first so that env
  // references into them can be resolved in pass two regardless of document
  // order.
  for (const artifact of model.index.artifacts ?? []) {
    const rel = String(artifact?.path ?? "");
    const file = path.join(dir, rel);
    if (!rel || !fs.existsSync(file)) {
      model.loadProblems.push(`declared artifact ${rel || "(no path)"} does not exist`);
      continue;
    }
    if (!known.has(String(artifact.kind))) {
      model.loadProblems.push(
        `artifact ${rel} declares kind ${JSON.stringify(artifact.kind)}, which the ` +
          `contract does not define (known: ${[...known].join(", ")})`
      );
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    model.texts.push({ path: rel, text });

    if (artifact.kind === "kubernetes") {
      kubeArtifacts.push({ file, rel });
      model.kubeFiles.push(file);
      const docs = parseAllDocuments(text);
      docs.forEach((d, i) => {
        if (d.errors.length) {
          model.parseProblems.push(`${rel} document ${i}: ${d.errors[0].message}`);
          return;
        }
        const obj = d.toJS() as Record<string, any> | null;
        if (obj === null || obj === undefined) return; // an empty document is legal
        if (typeof obj !== "object") {
          model.parseProblems.push(`${rel} document ${i} is not a mapping`);
          return;
        }
        model.docs.push({
          apiVersion: str(obj.apiVersion),
          kind: str(obj.kind),
          name: str(obj.metadata?.name),
          obj,
          source: rel,
          index: i,
        });
        if (obj.kind === "ConfigMap") {
          configMaps.set(String(obj.metadata?.name), record(obj.data));
        }
      });
    } else if (artifact.kind === "github-workflow") {
      try {
        model.workflows.push(normaliseWorkflow(text, rel, artifact.name));
      } catch (err) {
        model.parseProblems.push(`${rel} is not a parseable workflow: ${(err as Error).message}`);
      }
    } else if (artifact.kind === "compose") {
      try {
        normaliseCompose(text, rel, topology.role_label, model);
      } catch (err) {
        model.parseProblems.push(`${rel} is not a parseable compose file: ${(err as Error).message}`);
      }
    }
  }

  // Pass two: the Kubernetes objects.
  for (const doc of model.docs) {
    const obj = doc.obj as Record<string, any>;
    const name = doc.name ?? "(unnamed)";
    const kind = doc.kind ?? "(no kind)";

    if (kind === "ConfigMap") {
      model.configMaps.push({ name, data: record(obj.data), source: doc.source });
      continue;
    }
    if (kind === "Secret") {
      const keys = [...Object.keys(record(obj.data)), ...Object.keys(record(obj.stringData))];
      model.secrets.push({
        name,
        keys,
        hasMaterial: obj.data !== undefined || obj.stringData !== undefined,
        source: doc.source,
      });
      continue;
    }
    if (kind === "Service") {
      model.services.push({
        name,
        type: str(obj.spec?.type) ?? "ClusterIP",
        ports: (obj.spec?.ports ?? []).map((p: any) => ({
          name: str(p?.name) ?? undefined,
          port: Number(p?.port),
          targetPort: p?.targetPort ?? null,
        })),
        selector: record(obj.spec?.selector),
        source: doc.source,
      });
      continue;
    }
    if (kind === "NetworkPolicy") {
      const sel = obj.spec?.podSelector ?? {};
      model.networkPolicies.push({
        name,
        selectsAllPods: Object.keys(sel).length === 0,
        podSelector: sel,
        policyTypes: (obj.spec?.policyTypes ?? []).map(String),
        ingress: obj.spec?.ingress ?? null,
        egress: obj.spec?.egress ?? null,
        source: doc.source,
      });
      continue;
    }
    if (kind === "Ingress") {
      model.ingresses.push({ name, source: doc.source, obj });
      continue;
    }
    if (!WORKLOAD_KINDS.has(kind)) continue;

    const podSpec = podSpecOf(obj) ?? {};
    const podMeta = podMetaOf(obj);
    const labels = record(obj.metadata?.labels);
    const podLabels = record(podMeta.labels);
    const containers = [
      ...(podSpec.initContainers ?? []),
      ...(podSpec.containers ?? []),
    ].map((c: Record<string, any>) => normaliseContainer(c, configMaps, secretNames));

    model.workloads.push({
      role: labels[topology.role_label] ?? podLabels[topology.role_label] ?? null,
      name,
      kind,
      replicas:
        kind === "Job" || kind === "CronJob" || kind === "Pod" || kind === "DaemonSet"
          ? null
          : obj.spec?.replicas === undefined
            ? 1 // Kubernetes' own default, and a real one-replica deployment
            : Number(obj.spec.replicas),
      strategy: obj.spec?.strategy
        ? {
            type: str(obj.spec.strategy.type) ?? undefined,
            maxSurge: obj.spec.strategy.rollingUpdate?.maxSurge,
            maxUnavailable: obj.spec.strategy.rollingUpdate?.maxUnavailable,
          }
        : obj.spec?.updateStrategy
          ? {
              type: str(obj.spec.updateStrategy.type) ?? undefined,
              maxSurge: obj.spec.updateStrategy.rollingUpdate?.maxSurge,
              maxUnavailable: obj.spec.updateStrategy.rollingUpdate?.maxUnavailable,
            }
          : null,
      annotations: record(obj.metadata?.annotations),
      labels,
      podLabels,
      restartPolicy: str(podSpec.restartPolicy),
      backoffLimit:
        obj.spec?.backoffLimit === undefined
          ? obj.spec?.jobTemplate?.spec?.backoffLimit === undefined
            ? null
            : Number(obj.spec.jobTemplate.spec.backoffLimit)
          : Number(obj.spec.backoffLimit),
      containers,
      source: doc.source,
    });
  }

  cached = model;
  return model;
}

/** The single workload declaring a role, or null. More than one is a DEP-010 failure. */
export function workloadsForRole(model: Model, role: string): WorkloadModel[] {
  return model.workloads.filter((w) => w.role === role);
}

/** Every env var on a workload, flattened across its containers. */
export function envOf(workload: WorkloadModel, name: string): EnvVar[] {
  return workload.containers.flatMap((c) => c.env.filter((e) => e.name === name));
}

export function describeWorkload(w: WorkloadModel): string {
  return `${w.kind}/${w.name} (role ${w.role ?? "undeclared"}, from ${w.source})`;
}
