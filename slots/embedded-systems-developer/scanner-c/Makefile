.PHONY: install build run test lint

# The five targets every slot has. There is no `migrate` and no `seed`: this
# device has no database and never opens a connection — its fixtures are the
# signed tickets in contract/scanner/tickets.jsonl, generated from
# contract/seed/, and its input is a transcript on stdin.

CC ?= gcc
SRC := src/ticket.c src/state.c src/decide.c src/main.c
BIN := build/scanner
TEST_BIN := build/unit

WARN := -Wall -Wextra -Werror
STD := -std=c11

# Instrumented BY DEFAULT. Memory safety is part of correctness here
# (contract/scanner/rules.yaml, SCAN-R14) and it is graded as "every segment of
# every scenario exits 0 with an empty stderr", so the binary the suite grades
# has to be the one carrying the sanitizers. `make build RELEASE=1` produces
# the uninstrumented build for a real device.
ifeq ($(RELEASE),1)
SAN :=
OPT := -O2
else
SAN := -fsanitize=address,undefined -fno-omit-frame-pointer
OPT := -O1 -g
endif

CFLAGS := $(STD) $(WARN) $(OPT) $(SAN)
LDFLAGS := $(SAN)

export ASAN_OPTIONS := detect_leaks=1:detect_stack_use_after_return=1
export UBSAN_OPTIONS := print_stacktrace=1:halt_on_error=1

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
	@command -v $(CC) >/dev/null || { echo "no C compiler on PATH: $(CC)"; exit 1; }
	@$(CC) --version | head -1
	@echo "nothing to install — the scanner has no dependencies, which is the point"

build: $(BIN)

$(BIN): $(SRC) src/ticket.h src/state.h src/decide.h
	@mkdir -p build
	$(CC) $(CFLAGS) -o $(BIN) $(SRC) $(LDFLAGS)

run: build
	@test -f $(CONTRACT)/run-scenarios.sh || { \
	  echo "cannot find contract/scanner above $(CURDIR) — set TF_ROOT"; exit 1; }
	@SCANNER_BIN=$(BIN) SCAN_OUT_DIR=$(SCAN_OUT_DIR) bash $(CONTRACT)/run-scenarios.sh

test: $(TEST_BIN)
	@./$(TEST_BIN)

$(TEST_BIN): tests/unit.c src/ticket.c src/state.c src/decide.c src/ticket.h src/state.h src/decide.h
	@mkdir -p build
	$(CC) $(CFLAGS) -I src -o $(TEST_BIN) tests/unit.c src/ticket.c src/state.c src/decide.c $(LDFLAGS)

# `lint` is a strict compile rather than a style checker. There is no clang-tidy
# or cppcheck on this host, and a linter that is not installed is a lint that
# always passes — so the gate is the compiler itself with every warning fatal,
# plus the two things about this program that a compiler cannot see: it must
# never write to stderr (that channel belongs to the sanitizers) and it must
# never exit through a path that flushes state it should already have written.
lint:
	$(CC) $(STD) $(WARN) -pedantic -Wshadow -Wconversion -Wsign-conversion \
	  -Wcast-qual -Wstrict-prototypes -Wmissing-prototypes -Wvla \
	  -O2 -fsyntax-only $(SRC)
	@if grep -n -E 'fprintf[[:space:]]*\([[:space:]]*stderr|fputs[[:space:]]*\(.*stderr|perror[[:space:]]*\(' $(SRC) src/*.h; then \
	  echo "lint: the device must write nothing to stderr — see contract/scanner/rules.yaml SCAN-R14"; exit 1; \
	fi
	@if grep -n -E '\batexit[[:space:]]*\(' $(SRC); then \
	  echo "lint: state must be durable before a decision is announced, not on the way out — SCAN-R03"; exit 1; \
	fi
	@echo "lint: clean"
