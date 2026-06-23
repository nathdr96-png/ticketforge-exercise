# A toolchain image, not a service. The turnstile scanner has no port and
# nothing to serve: it reads a transcript on stdin and writes files.
#
# The default command builds and runs the whole scenario corpus, which needs the
# repository mounted — contract/scanner/ owns the transcripts and the runner, and
# the slot deliberately does not carry a copy of them.
FROM gcc:13-bookworm

# bash for contract/scanner/run-scenarios.sh, make for the slot's own targets.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /slot
COPY Makefile ./
COPY src ./src
COPY tests ./tests

# Memory safety is graded as "every segment exits 0 with an empty stderr"
# (contract/scanner/rules.yaml, SCAN-R14), so the sanitizers are configured here
# as well as in the Makefile — an image whose leak detection was off would make
# that measurement silently meaningless.
ENV ASAN_OPTIONS=detect_leaks=1:detect_stack_use_after_return=1
ENV UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1

RUN make build && make test

CMD ["make", "run"]
