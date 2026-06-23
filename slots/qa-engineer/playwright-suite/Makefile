.PHONY: install run test lint

# The suite talks to a running TicketForge backend over HTTP. Point BASE_URL at
# any slot — the suite never learns which language is behind it.
BASE_URL ?= http://127.0.0.1:3000
export BASE_URL

install:
	npm ci || npm install

# Every target goes through `npm run`, never `npx`: with node_modules missing, npx
# silently fetches a same-named package from the registry and fails in a way that
# looks like a test failure. `npm run` fails honestly. Run `make install` first.

# Human-facing: the same run as `test`, with every test name printed, so a reader
# can see what is covered without opening the files.
run:
	npm run test:verbose

# CI- and grader-facing. Exits non-zero if any test fails.
test:
	npm test

lint:
	npm run lint
