.PHONY: install migrate seed run test lint

# This slot has no server and no dependency tree: psql and python3 (standard
# library only) are the whole toolchain. `install` therefore checks rather than
# installs — it is here because every slot in this repo exposes the same six
# targets and the harness calls them by name.
install:
	@command -v psql >/dev/null || { echo "psql not found — install the postgresql client" >&2; exit 1; }
	@command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
	@echo "nothing to install: psql + python3 standard library only"

migrate:
	python3 tools/seed.py --schema-only

# Always re-migrates first: the answers in the contract are defined against one
# exact dataset, and seeding on top of leftovers would not reproduce it.
seed:
	python3 tools/seed.py

run:
	python3 tools/run.py

test:
	python3 tools/check.py

lint:
	python3 tools/lint.py
