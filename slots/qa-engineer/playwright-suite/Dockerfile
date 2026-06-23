FROM node:20-bookworm-slim
WORKDIR /suite

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY tsconfig.json vitest.config.ts Makefile ./
COPY tests ./tests

# The suite is a client, not a server: it needs a backend to point at.
ENV BASE_URL=http://host.docker.internal:3000
CMD ["npx", "vitest", "run"]
