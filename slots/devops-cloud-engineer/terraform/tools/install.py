#!/usr/bin/env python3
"""`make install` — `terraform init`, plus a toolchain report.

The only step in this slot that touches the network, and only the first time:
it fetches the hashicorp/local provider and writes .terraform.lock.hcl.

Providers go into a shared plugin cache under $HOME/.local/toolchains/, next to
the other tarball toolchains this repository installs. That matters more than it
looks: every fresh copy of this slot runs `make install`, and without the cache
each one would download 18MB of provider and depend on a registry being
reachable. With it, `.terraform` is 28KB of symlinks and init takes under a
second.

Set TF_PLUGIN_CACHE_DIR yourself to override.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import toolchain  # noqa: E402

SLOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_CACHE = toolchain.TOOLCHAINS / "terraform-plugin-cache"


def main() -> None:
    terraform = toolchain.require("terraform")
    cache = pathlib.Path(os.environ.get("TF_PLUGIN_CACHE_DIR") or DEFAULT_CACHE)
    cache.mkdir(parents=True, exist_ok=True)

    print(f"terraform      {terraform}")
    print(f"kubeconform    {toolchain.find('kubeconform') or 'MISSING (needed by conformance/infra, not here)'}")
    print(f"plugin cache   {cache}")

    proc = subprocess.run(
        [terraform, "init", "-input=false", "-no-color"],
        cwd=SLOT,
        capture_output=True,
        text=True,
        env={**os.environ, "TF_PLUGIN_CACHE_DIR": str(cache)},
    )
    if proc.returncode != 0:
        sys.stdout.write(proc.stdout[-3000:])
        sys.stderr.write(proc.stderr[-3000:])
        sys.exit(f"terraform init failed (exit {proc.returncode})")
    print("terraform init ok")


if __name__ == "__main__":
    main()
