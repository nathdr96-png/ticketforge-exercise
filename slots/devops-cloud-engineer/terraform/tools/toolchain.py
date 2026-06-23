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
    "terraform": (
        "mkdir -p $HOME/.local/toolchains/terraform && "
        "curl -sSL -o /tmp/tf.zip "
        "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip && "
        "unzip -o /tmp/tf.zip -d $HOME/.local/toolchains/terraform"
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
    for tool in ("terraform", "kubeconform"):
        found = find(tool)
        print(f"{tool:14} {found or 'MISSING'}")
        if not found and tool == "terraform":
            status = 1
    sys.exit(status)
