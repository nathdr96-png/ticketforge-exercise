# A toolchain image, not a service. The turnstile scanner has no port and
# nothing to serve: it reads a transcript on stdin and writes files.
#
# The default command builds and runs the whole scenario corpus, which needs the
# repository mounted — contract/scanner/ owns the transcripts and the runner, and
# the slot deliberately does not carry a copy of them.
FROM rust:1.83-bookworm

# bash for contract/scanner/run-scenarios.sh, make for the slot's own targets.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /slot
COPY Cargo.toml Makefile ./
COPY src ./src

# The crate has no dependencies on purpose, so this needs no registry and no
# network — see Cargo.toml.
RUN make build && make test

CMD ["make", "run"]
