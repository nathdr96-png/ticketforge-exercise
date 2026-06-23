.PHONY: install run test lint

# This slot is configuration, not a program. There is no server, no database and
# no dependency tree: helm renders the chart and the suite grades what came out.
# `install` therefore checks the toolchain rather than installing packages — it
# exists because every slot in this repo exposes the same four targets and the
# harness calls them by name.
install:
	@python3 tools/toolchain.py

# Renders into $RENDER_DIR, defaulting to ./rendered. Writes index.json, the
# rendered Kubernetes documents and the deployment workflow, then exits.
run:
	@python3 tools/render.py

# helm lint + helm template + kubeconform --strict over the rendered output.
# conformance/infra is what grades the policy; this is the local loop.
test:
	@python3 tools/check.py

lint:
	@python3 tools/check.py --lint-only
