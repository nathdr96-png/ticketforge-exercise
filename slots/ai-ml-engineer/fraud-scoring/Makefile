.PHONY: install run test lint clean

VENV := .venv
PY   := $(VENV)/bin/python

# Where `make run` writes its predictions. The grader passes this in; the default
# is here so that a human can type `make run` and get something to look at.
# conformance/ml has NO default for it, which is the point: a grader that guesses
# a directory grades a stale run.
PREDICTIONS_DIR ?= $(CURDIR)/predictions

# scikit-learn's gradient booster is OpenMP-parallel. Its results do not depend
# on the thread count — the histogram build is deterministic — so pinning this is
# purely about not spawning one thread per core on a shared machine and spending
# longer fighting for them than training. RISK-R10 is satisfied either way.
THREADS ?= 2
ENV := OMP_NUM_THREADS=$(THREADS) OPENBLAS_NUM_THREADS=$(THREADS) MKL_NUM_THREADS=$(THREADS)

# Dependencies live in a slot-local virtualenv, the way the node slots keep a
# slot-local node_modules and slots/data-engineer/dbt keeps its own .venv.
install:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --quiet --upgrade pip
	$(VENV)/bin/pip install --quiet -r requirements.txt
	$(PY) -c "import numpy, pandas, sklearn, yaml; print('numpy', numpy.__version__, '| pandas', pandas.__version__, '| scikit-learn', sklearn.__version__)"

# TWO runs, in two separate processes, into run1/ and run2/.
#
# This is not belt and braces. The grader cannot execute the candidate's code, so
# RISK-R07 (determinism) has to be measurable from the outside: two independent
# executions of fit-and-predict, and the suite asserts their output is identical.
# run1 is the run that is scored. See contract/risk/rules.yaml, output.two_runs.
run:
	$(ENV) $(PY) -m risk --out "$(PREDICTIONS_DIR)/run1"
	$(ENV) $(PY) -m risk --out "$(PREDICTIONS_DIR)/run2"

test:
	$(ENV) $(PY) -m pytest -q tests

lint:
	$(PY) -m compileall -q risk tests
	$(PY) -m risk.lint

clean:
	rm -rf predictions .pytest_cache **/__pycache__
