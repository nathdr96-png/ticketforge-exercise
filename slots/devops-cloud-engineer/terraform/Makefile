.PHONY: install run test lint

# This slot is configuration, not a program. There is no server and no database:
# Terraform renders the manifests and the suite grades what came out.
# `install` is `terraform init` — the one step that needs network, once, to
# fetch the hashicorp/local provider. It is here because every slot in this repo
# exposes the same four targets and the harness calls them by name.
install:
	@python3 tools/install.py

# Renders into $RENDER_DIR, defaulting to ./rendered. Wipes the directory and
# the state file first, writes index.json, the four manifest files and the
# deployment workflow, then exits.
run:
	@python3 tools/render.py

# terraform fmt -check + validate + plan + kubeconform --strict over the
# rendered output. conformance/infra is what grades the policy; this is the
# local loop.
test:
	@python3 tools/check.py

lint:
	@python3 tools/check.py --lint-only
