.PHONY: install build run test lint

# The five targets every slot has. There is no `migrate` and no `seed`: this
# device has no database and never opens a connection — its fixtures are the
# signed tickets in contract/scanner/tickets.jsonl, generated from
# contract/seed/, and its input is a transcript on stdin.

# Prefer a system Rust; fall back to the toolchain this repo provisions, so a
# grader can run `make run` without setting up PATH first.
CARGO ?= $(shell command -v cargo 2>/dev/null || echo $(HOME)/.local/toolchains/rust/bin/cargo)
# cargo shells out to `rustc` by name, so the chosen toolchain's bin directory
# has to be on PATH too. Without this, make finds cargo and cargo does not find
# rustc, which is a confusing way to fail.
export PATH := $(dir $(CARGO)):$(PATH)

# --offline everywhere: this crate has no dependencies on purpose (see
# Cargo.toml), so a build must never reach for a registry, and a build that
# tries is a build that will fail on an air-gapped grading host.
CARGOFLAGS ?= --offline

BIN := build/scanner
TARGET := target/release/scanner

SCAN_OUT_DIR ?= $(CURDIR)/out

# Where the contract lives. The slot normally sits at slots/<family>/<stack>, so
# it is three levels up — but a COPY of the slot can be rooted anywhere: a work
# copy beside it, or a package that puts the whole tree somewhere else
# entirely. So the root is searched for rather
# than assumed, and TF_ROOT overrides it. A hard-coded ../../.. here fails by
# running nothing, which looks exactly like a defect that breaks nothing.
TF_ROOT ?= $(shell d="$(CURDIR)"; while [ "$$d" != "/" ]; do \
	if [ -f "$$d/contract/scanner/run-scenarios.sh" ]; then echo "$$d"; break; fi; \
	d=$$(dirname "$$d"); done)
CONTRACT := $(TF_ROOT)/contract/scanner

install:
	@command -v $(CARGO) >/dev/null 2>&1 || test -x $(CARGO) || { \
	  echo "no cargo found: $(CARGO)"; \
	  echo "install a Rust toolchain, or put one in $(HOME)/.local/toolchains/rust"; \
	  exit 1; }
	@$(CARGO) --version
	@echo "nothing to fetch — the scanner has no dependencies, which is the point"

build:
	$(CARGO) build $(CARGOFLAGS) --release
	@mkdir -p build
	@cp $(TARGET) $(BIN)

run: build
	@test -f $(CONTRACT)/run-scenarios.sh || { \
	  echo "cannot find contract/scanner above $(CURDIR) — set TF_ROOT"; exit 1; }
	@SCANNER_BIN=$(BIN) SCAN_OUT_DIR=$(SCAN_OUT_DIR) bash $(CONTRACT)/run-scenarios.sh

test:
	$(CARGO) test $(CARGOFLAGS) --release

# `lint` is a strict compile rather than a style checker. clippy is not part of
# the standalone toolchain this repo provisions, and a linter that is not
# installed is a lint that always passes — so the gate is the compiler itself
# with every warning fatal, plus the three things about this program a compiler
# cannot see: it must forbid unsafe code (which is this slot's entire claim to
# memory safety under SCAN-R14), it must never write to stderr, and it must not
# leave state to be written on the way out.
lint:
	RUSTFLAGS="-D warnings" $(CARGO) build $(CARGOFLAGS) --release
	RUSTFLAGS="-D warnings" $(CARGO) test $(CARGOFLAGS) --release --no-run
	@grep -q '^#!\[forbid(unsafe_code)\]' src/main.rs || { \
	  echo "lint: src/main.rs must carry #![forbid(unsafe_code)] — it is what SCAN-R14 rests on"; \
	  exit 1; }
	@if grep -rn -E 'eprintln!|eprint!|io::stderr' src/; then \
	  echo "lint: the device must write nothing to stderr — see contract/scanner/rules.yaml SCAN-R14"; \
	  exit 1; \
	fi
	@if grep -rn -E 'impl Drop for State' src/; then \
	  echo "lint: state must be durable before a decision is announced, not in a destructor — SCAN-R03"; \
	  exit 1; \
	fi
	@echo "lint: clean"
