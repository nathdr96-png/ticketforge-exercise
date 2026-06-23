.PHONY: run test lint seed migrate build

install:
	npm ci || npm install

migrate:
	npx tsx src/db/migrate.ts

seed:
	npx tsx src/db/seed.ts

run: 
	npx tsx src/index.ts

build:
	npm run build

test:
	npm test

lint:
	npm run lint
