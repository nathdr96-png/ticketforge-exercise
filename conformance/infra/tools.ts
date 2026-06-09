/**
 * External validators the suite invokes for real.
 *
 * There is exactly one of them: `kubeconform --strict`, against the Kubernetes
 * JSON schemas vendored in ./schemas/. Everything else this suite asserts is its
 * own parser over the rendered configuration, and the README says which is which
 * so nobody mistakes a policy assertion for a schema check or the reverse.
 *
 * A missing kubeconform makes the schema test FAIL rather than skip. A grader
 * that could not validate must not read as a grader that validated — and the
 * failure message is the command that fixes it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCHEMA_DIR } from "./contract.js";

export const KUBECONFORM_INSTALL =
  "curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.6.7/" +
  "kubeconform-linux-amd64.tar.gz | tar -xz -C $HOME/.local/toolchains/kubeconform  " +
  "(mkdir -p $HOME/.local/toolchains/kubeconform first)";

export function findKubeconform(): string | null {
  const explicit = process.env.KUBECONFORM;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const toolchains =
    process.env.TF_TOOLCHAINS ?? path.join(os.homedir(), ".local", "toolchains");
  const candidates = [
    path.join(toolchains, "kubeconform", "kubeconform"),
    "/usr/local/bin/kubeconform",
    "/usr/bin/kubeconform",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // PATH, without a shell.
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const c = path.join(dir, "kubeconform");
    if (dir && fs.existsSync(c)) return c;
  }
  return null;
}

export interface SchemaResult {
  ok: boolean;
  output: string;
  command: string;
}

/**
 * Validate rendered Kubernetes documents against their schemas.
 *
 * Two schema locations, in order: the vendored directory (deterministic and
 * offline — the suite must not depend on GitHub being up to grade somebody), and
 * then kubeconform's own upstream location, so a document of a kind this repo
 * has not vendored is still validated rather than waved through.
 */
export function validateSchemas(files: string[]): SchemaResult {
  const bin = findKubeconform();
  if (!bin) {
    return {
      ok: false,
      command: "kubeconform",
      output:
        "kubeconform is not installed, so the rendered manifests were NOT schema-checked.\n" +
        "This is a failure, not a skip: a grader that could not validate must not " +
        "report green.\nInstall it with:\n  " +
        KUBECONFORM_INSTALL,
    };
  }
  const args = [
    "-strict",
    "-summary",
    "-schema-location",
    path.join(SCHEMA_DIR, "{{.ResourceKind}}{{.KindSuffix}}.json"),
    "-schema-location",
    "default",
    ...files,
  ];
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: out, command: `${path.basename(bin)} ${args.join(" ")}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      command: `${path.basename(bin)} ${args.join(" ")}`,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.stdout || e.stderr ? "" : e.message ?? ""}`,
    };
  }
}
