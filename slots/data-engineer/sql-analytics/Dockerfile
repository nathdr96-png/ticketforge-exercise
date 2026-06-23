# A batch job, not a service: it runs the queries, writes the result files and
# exits. There is nothing to EXPOSE and no health endpoint to poll.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/slots/data-engineer/sql-analytics
# The queries are defined against the contract, and `make seed` loads it, so the
# contract directory has to come along.
COPY contract /app/contract
COPY slots/data-engineer/sql-analytics /app/slots/data-engineer/sql-analytics

ENV RESULTS_DIR=/app/slots/data-engineer/sql-analytics/results
CMD ["make", "run"]
