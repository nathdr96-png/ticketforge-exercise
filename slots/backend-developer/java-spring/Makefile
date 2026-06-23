.PHONY: install migrate seed run build test lint clean

# --- toolchain -------------------------------------------------------------
# Set here so the slot works out of the box without the caller exporting anything:
# an exported JAVA_HOME wins, then a JDK under $(HOME)/.local/toolchains, then
# whatever `java` is already on PATH.
TOOLCHAINS ?= $(HOME)/.local/toolchains
ifeq ($(JAVA_HOME),)
JAVA_HOME := $(wildcard $(TOOLCHAINS)/jdk)
endif
ifneq ($(JAVA_HOME),)
export JAVA_HOME
export PATH := $(JAVA_HOME)/bin:$(PATH)
endif

MVN ?= $(shell command -v mvn 2>/dev/null || echo $(TOOLCHAINS)/maven/bin/mvn)
MVNFLAGS ?= -B -q
JAR := target/ticketforge-java-spring.jar

# --- runtime config ------------------------------------------------------
# .env (if present) wins over the defaults below; the environment and command line
# still win over .env. Copy .env.example to get started.
ifneq (,$(wildcard .env))
include .env
export
endif

DATABASE_URL ?= postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge
PORT ?= 3000
export DATABASE_URL
export PORT

install:
	$(MVN) $(MVNFLAGS) dependency:go-offline

build:
	$(MVN) $(MVNFLAGS) -DskipTests package

$(JAR):
	$(MVN) $(MVNFLAGS) -DskipTests package

# Applies contract/schema.sql verbatim (drops and recreates the public schema first).
migrate: $(JAR)
	java -jar $(JAR) --app.task=migrate

# migrate + load contract/seed/*.json deterministically (bcrypt cost 10).
seed: $(JAR)
	java -jar $(JAR) --app.task=seed

run: $(JAR)
	java -jar $(JAR) --server.port=$(PORT)

# Not -q: the point of `make test` is to see the results.
test:
	$(MVN) -B test

# A type-check: full compile of main + test
# sources with all javac lint checks on, warnings fatal.
lint:
	$(MVN) $(MVNFLAGS) -DskipTests \
	  -Dmaven.compiler.showDeprecation=true \
	  test-compile

clean:
	$(MVN) $(MVNFLAGS) clean
