.PHONY: install migrate seed run test lint

VENV ?= .venv
PY   := $(VENV)/bin/python
PIP  := $(VENV)/bin/pip
PORT ?= 3000

install:
	python3.12 -m venv $(VENV) || python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

migrate:
	$(PY) -m app.migrate

seed:
	$(PY) -m app.seed

run:
	$(VENV)/bin/uvicorn app.main:app --host 0.0.0.0 --port $(PORT)

test:
	$(VENV)/bin/pytest -q

lint:
	$(VENV)/bin/ruff check app tests
