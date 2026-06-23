#!/usr/bin/env python3
"""`make test` — the checks this slot can run on itself.

Real tool invocations, all four of them:

  terraform fmt -check  canonical formatting, recursively
  terraform validate    the configuration is internally consistent and typed
  terraform plan        the templates render with the committed tfvars
  kubeconform --strict  every rendered document against the Kubernetes schema

This is NOT the grader. conformance/infra is, and it asserts the policy in
contract/deploy/policy.yaml over the rendered output. What is here is the loop a
candidate runs while working: fast, local, and about validity rather than policy.

    python3 tools/check.py [--lint-only]
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render  # noqa: E402
import toolchain  # noqa: E402

SLOT = pathlib.Path(__file__).resolve().parents[1]
REPO = SLOT.parents[2]
# Vendored with the suite so that schema validation is deterministic and works
# with no network. Kept in one place rather than copied per slot.
SCHEMA_DIR = REPO / "conformance" / "infra" / "schemas"


def step(title: str, cmd: list[str], cwd: pathlib.Path = SLOT) -> bool:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    ok = proc.returncode == 0
    print(f"[{'ok  ' if ok else 'FAIL'}] {title}")
    if not ok:
        sys.stdout.write((proc.stdout + proc.stderr)[-4000:])
    return ok


def main() -> None:
    lint_only = "--lint-only" in sys.argv[1:]
    terraform = toolchain.require("terraform")
    results: list[bool] = []

    if not (SLOT / ".terraform").is_dir():
        print("[FAIL] not initialised — run `make install` first (it is `terraform init`)")
        sys.exit(1)

    results.append(step("terraform fmt -check", [terraform, "fmt", "-check", "-recursive", "-no-color"]))
    results.append(step("terraform validate", [terraform, "validate", "-no-color"]))
    # A plan proves the templates render with the committed values. It writes
    # nothing: -out is omitted and the only provider is hashicorp/local.
    results.append(
        step(
            "terraform plan (templates render)",
            [terraform, "plan", "-input=false", "-no-color",
             "-var=render_dir=/tmp/ticketforge-plan-check"],
        )
    )

    if lint_only:
        sys.exit(0 if all(results) else 1)

    rendered = render.render_dir()
    manifests = rendered / "k8s"
    if not manifests.is_dir():
        print("[FAIL] no rendered manifests — run `make run` first")
        sys.exit(1)

    kubeconform = toolchain.find("kubeconform")
    if kubeconform is None:
        print(
            "[skip] kubeconform not installed — rendered manifests NOT schema-checked here.\n"
            "       conformance/infra checks them anyway and will not skip.\n"
            f"       install: {toolchain.INSTALL_HINT['kubeconform']}"
        )
    else:
        args = [kubeconform, "-strict", "-summary", "-verbose"]
        if SCHEMA_DIR.is_dir():
            args += ["-schema-location", str(SCHEMA_DIR / "{{.ResourceKind}}{{.KindSuffix}}.json")]
        args += ["-schema-location", "default"]
        args += [str(p) for p in sorted(manifests.glob("*.yaml"))]
        results.append(step("kubeconform --strict", args))

    if not (rendered / "index.json").is_file():
        print("[FAIL] no index.json in the render directory")
        results.append(False)
    else:
        print("[ok  ] index.json present")

    print()
    if all(results):
        print("all local checks passed — now run conformance/infra, which is the grader")
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
