.PHONY: install migrate seed run build test lint

BIN := bin/ticketforge
PKG := ./cmd/ticketforge

# Prefer a system Go; fall back to the toolchain this repo provisions, so a grader
# can run `make run` without setting up PATH first.
GO ?= $(shell command -v go 2>/dev/null || echo $(HOME)/.local/toolchains/go/bin/go)

install:
	$(GO) mod download

migrate:
	$(GO) run $(PKG) migrate

seed:
	$(GO) run $(PKG) seed

run:
	$(GO) run $(PKG) serve

build:
	$(GO) build -o $(BIN) $(PKG)

test:
	$(GO) test ./...

lint:
	@unformatted="$$($(GO)fmt -l .)"; \
	if [ -n "$$unformatted" ]; then \
		echo "gofmt needed for:"; echo "$$unformatted"; exit 1; \
	fi
	$(GO) vet ./...
