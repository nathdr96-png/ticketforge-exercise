# Local conveniences. Every target works from the root of the package you were
# given; none of them is required — use your own Postgres or tooling if you prefer.
#
#   make up                   start PostgreSQL 16 in Docker on localhost:5432
#   make mock                 start a stateless mock of contract/openapi.yaml on :4010
#   make down                 stop them
#   make install|migrate|seed|run|test|lint
#                             run that target in your slot's own Makefile
#
# If the package holds more than one slot, say which one is yours:
#   make test SLOT=backend/go

.PHONY: help up mock down install migrate seed run build test lint

SLOTS := $(patsubst slots/%/Makefile,%,$(wildcard slots/*/*/Makefile))
SLOT ?= $(if $(word 2,$(SLOTS)),,$(SLOTS))

# The database `make up` starts. Your environment wins if you already set it.
DATABASE_URL ?= postgres://ticketforge:ticketforge@localhost:5432/ticketforge
export DATABASE_URL

help:
	@awk '/^#/ { sub(/^# ?/, ""); print; next } { exit }' Makefile
	@echo "Slots in this package: $(SLOTS)"

up:
	docker compose up -d --wait postgres

mock:
	docker compose up -d mock

down:
	docker compose down

install migrate seed run build test lint:
	@test -n "$(SLOT)" || { echo "this package holds several slots — pass SLOT=<role/stack>, one of: $(SLOTS)" >&2; exit 2; }
	$(MAKE) -C slots/$(SLOT) $@
