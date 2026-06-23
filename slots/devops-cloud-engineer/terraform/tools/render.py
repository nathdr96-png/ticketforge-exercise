#!/usr/bin/env python3
"""Render this slot's deployment configuration into $RENDER_DIR and exit.

This is the whole of `make run`. Nothing is deployed, nothing is contacted, and
no cluster, cloud account or container runtime is involved — see
contract/deploy/README.md for why this family is graded on rendered
configuration rather than on a deployment, and versions.tf for why the
kubernetes provider is deliberately absent.

    RENDER_DIR=./rendered python3 tools/render.py

Output (the interface every infra slot implements, whatever it is written in):

    $RENDER_DIR/index.json             the manifest of what was rendered
    $RENDER_DIR/k8s/workloads.yaml     api, web, sweeper, migration
    $RENDER_DIR/k8s/networking.yaml    services and ingress
    $RENDER_DIR/k8s/networkpolicies.yaml
    $RENDER_DIR/k8s/rbac.yaml
    $RENDER_DIR/ci/deploy.yml          the deployment workflow, verbatim

Two things this does besides calling Terraform:

  * The render directory is wiped first. A stale document left behind from a
    previous render would be graded as if it were current, which is the one
    failure mode that cannot be noticed from the output.
  * The state file is removed with it. State describes files on disk, and these
    are build outputs rather than infrastructure — carrying state across renders
    would mean Terraform refusing to recreate a file somebody deleted, which is
    a confusing way to find out that the render directory is not durable.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import toolchain  # noqa: E402  (sibling module, resolved above)

SLOT = pathlib.Path(__file__).resolve().parents[1]


def render_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("RENDER_DIR") or (SLOT / "rendered")).resolve()


def main() -> None:
    terraform = toolchain.require("terraform")
    out = render_dir()
    if out.exists():
        shutil.rmtree(out)

    for stale in SLOT.glob("terraform.tfstate*"):
        stale.unlink()

    if not (SLOT / ".terraform").is_dir():
        sys.exit(
            "terraform has not been initialised in this slot.\n"
            "Run `make install` first — it is `terraform init`, and it needs "
            "network access once to fetch the hashicorp/local provider."
        )

    proc = subprocess.run(
        [
            terraform, "apply",
            "-auto-approve",
            "-input=false",
            "-no-color",
            f"-var=render_dir={out}",
        ],
        cwd=SLOT,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(proc.stdout[-4000:])
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.exit(f"terraform apply failed (exit {proc.returncode})")

    written = sorted(p.relative_to(out) for p in out.rglob("*") if p.is_file())
    print(f"rendered {out}")
    for path in written:
        print(f"  {path}")


if __name__ == "__main__":
    main()
