.PHONY: install migrate seed run test lint clean

VENV := .venv
DBT  := $(VENV)/bin/dbt
PY   := $(VENV)/bin/python

# dbt and its adapter live in a slot-local virtualenv, the way the node slots keep
# a slot-local node_modules.
install:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --quiet --upgrade pip
	$(VENV)/bin/pip install --quiet 'dbt-core~=1.12' 'dbt-postgres~=1.11'
	$(DBT) --version

# migrate and seed use psql and the system python, so a fresh clone can load the
# database before the virtualenv exists.
migrate:
	python3 tools/seed.py --schema-only

seed:
	python3 tools/seed.py

# Build the models, then export them to the result files the grader reads. The
# export is part of `run` on purpose: a model nobody can read is not an answer.
run:
	python3 tools/profile.py
	DBT_PROFILES_DIR=.dbt $(DBT) run --quiet
	$(PY) tools/export.py

# dbt's own tests: the contract's invariants expressed as SQL that must return no
# rows, plus the not_null/unique/accepted_values tests in models/analytics/schema.yml.
test:
	python3 tools/profile.py
	DBT_PROFILES_DIR=.dbt $(DBT) test

lint:
	python3 tools/profile.py
	DBT_PROFILES_DIR=.dbt $(DBT) parse
	DBT_PROFILES_DIR=.dbt $(DBT) compile --quiet

clean:
	rm -rf target dbt_packages logs results .dbt
