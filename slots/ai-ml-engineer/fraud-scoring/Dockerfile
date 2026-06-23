# The graded run is offline: no network, no hosted model, no database, no GPU.
# This image reflects that — it installs three pinned wheels and runs a batch job.
FROM python:3.12-slim-bookworm

WORKDIR /app

# Dependencies first, so a change to the model does not reinstall scikit-learn.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

COPY risk ./risk
COPY tests ./tests
COPY Makefile ./

# The dataset and the rules are part of the CONTRACT, not of this slot, so they
# are not copied in: mount the repository's contract/ at /app/contract and
# risk.contract.repo_root() finds it by looking for contract/risk/rules.yaml.
#
#   docker run --rm --network none \
#     -v "$PWD/contract:/app/contract:ro" \
#     -v "$PWD/out:/out" \
#     -e PREDICTIONS_DIR=/out ticketforge-fraud-scoring
#
# `--network none` is not a precaution here; it is a statement of the contract
# (RISK-R10). If the image needs the network, the model is wrong.
ENV PREDICTIONS_DIR=/out \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    PYTHONDONTWRITEBYTECODE=1

# Two runs, the way `make run` does it — see the Makefile for why.
CMD ["sh", "-c", "python -m risk --out \"$PREDICTIONS_DIR/run1\" && python -m risk --out \"$PREDICTIONS_DIR/run2\""]
