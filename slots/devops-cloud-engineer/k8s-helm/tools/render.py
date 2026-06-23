#!/usr/bin/env python3
"""Render this slot's deployment configuration into $RENDER_DIR and exit.

This is the whole of `make run`. Nothing is deployed, nothing is contacted, and
no cluster, cloud account or container runtime is involved — see
contract/deploy/README.md for why this family is graded on rendered
configuration rather than on a deployment.

    RENDER_DIR=./rendered python3 tools/render.py

Output (the interface every infra slot implements, whatever it is written in):

    $RENDER_DIR/index.json          the manifest of what was rendered
    $RENDER_DIR/k8s/ticketforge.yaml  `helm template` of this chart
    $RENDER_DIR/ci/deploy.yml       the deployment workflow, verbatim

The directory is wiped first. A stale document left behind from a previous render
would be graded as if it were current, which is the one failure mode that cannot
be noticed from the output.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import toolchain  # noqa: E402  (sibling module, resolved above)

SLOT = pathlib.Path(__file__).resolve().parents[1]
RELEASE = "ticketforge"
NAMESPACE = "ticketforge"


def render_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("RENDER_DIR") or (SLOT / "rendered")).resolve()


def main() -> None:
    helm = toolchain.require("helm")
    out = render_dir()
    if out.exists():
        shutil.rmtree(out)
    (out / "k8s").mkdir(parents=True)
    (out / "ci").mkdir(parents=True)

    proc = subprocess.run(
        [
            helm, "template", RELEASE, str(SLOT),
            "--namespace", NAMESPACE,
            "--values", str(SLOT / "values.yaml"),
            # Hooks are part of the deployment: the migration Job is one, and a
            # render that omitted it would be a render of a deployment that never
            # migrates.
            "--include-crds",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        sys.exit(f"helm template failed (exit {proc.returncode})")

    (out / "k8s" / "ticketforge.yaml").write_text(proc.stdout)
    shutil.copy2(SLOT / "ci" / "deploy.yml", out / "ci" / "deploy.yml")

    version = subprocess.run(
        [helm, "version", "--short"], capture_output=True, text=True
    ).stdout.strip()

    index = {
        "version": 1,
        "slot": "infra/k8s-helm",
        "contract": "contract/deploy/topology.yaml",
        "toolchain": [{"name": "helm", "version": version}],
        "artifacts": [
            {
                "kind": "kubernetes",
                "path": "k8s/ticketforge.yaml",
                "note": "helm template of the chart with the committed default values",
            },
            {
                "kind": "github-workflow",
                "path": "ci/deploy.yml",
                "name": "deploy",
            },
        ],
    }
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n")

    docs = sum(1 for line in proc.stdout.splitlines() if line.startswith("kind: "))
    print(f"rendered {out}")
    print(f"  k8s/ticketforge.yaml  ({docs} documents)")
    print("  ci/deploy.yml")
    print("  index.json")


if __name__ == "__main__":
    main()
