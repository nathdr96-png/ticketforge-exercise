#!/usr/bin/env python3
"""Find the external binaries this slot needs.

PATH first, then $HOME/.local/toolchains/<name>/, which is where this repository
installs tarball toolchains (Go, the JDK and Maven are already there). Nothing is
downloaded here: a missing tool is reported with the one command that installs
it, rather than silently skipped, because a validator that quietly does not run
is worse than one that is absent.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import sys

TOOLCHAINS = pathlib.Path(os.environ.get("TF_TOOLCHAINS", pathlib.Path.home() / ".local" / "toolchains"))

INSTALL_HINT = {
    "helm": (
        "curl -sSL https://get.helm.sh/helm-v3.16.3-linux-amd64.tar.gz "
        "| tar -xz -C $HOME/.local/toolchains/helm --strip-components=1   "
        "(mkdir -p $HOME/.local/toolchains/helm first)"
    ),
    "kubeconform": (
        "curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.6.7/"
        "kubeconform-linux-amd64.tar.gz | tar -xz -C $HOME/.local/toolchains/kubeconform"
    ),
}


def find(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    candidate = TOOLCHAINS / name / name
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    return None


def require(name: str) -> str:
    found = find(name)
    if found:
        return found
    hint = INSTALL_HINT.get(name, f"install {name} and put it on PATH")
    sys.exit(
        f"{name} not found on PATH or in {TOOLCHAINS / name}/.\n"
        f"Install it with:\n  {hint}"
    )


if __name__ == "__main__":
    status = 0
    for tool in ("helm", "kubeconform"):
        found = find(tool)
        print(f"{tool:14} {found or 'MISSING'}")
        if not found and tool == "helm":
            status = 1
    sys.exit(status)
