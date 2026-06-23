# TicketForge — blockchain/solidity-hardhat
#
# Nothing in this image reaches the network at run time: `make run` starts an
# in-process development chain, deploys to it and writes its declaration. The
# only network access is `npm ci` and the one-off Solidity compiler download,
# both at build time, and the compiler is baked into the image afterwards so a
# container started with no network still builds and deploys.
FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends make ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY hardhat.config.ts tsconfig.json .solhint.json Makefile ./
COPY contracts ./contracts
COPY scripts ./scripts
COPY test ./test

# The deploy script reads contract/seed/ and contract/onchain/ out of the
# repository, so the contract directory is mounted rather than copied: a slot
# that carried its own copy of the fixtures could drift from the product.
# Mount the repository's contract directory here:
#   docker run -v "$PWD/contract:/repo/contract:ro" ...
ENV TICKETFORGE_ROOT=/repo
ENV CHAIN_DEPLOYMENT=/app/deployment/deployment.json

# Warm the Solidity compiler into the image. After this the container needs no
# network at all.
RUN npx hardhat compile || true

CMD ["make", "run"]
