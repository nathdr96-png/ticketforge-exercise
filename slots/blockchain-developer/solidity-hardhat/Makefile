.PHONY: install run build test lint

install:
	npm ci || npm install

# Deploy to a local development chain and declare what was deployed.
#
# There is no server here: this slot is a batch job. It boots an
# in-process chain, sends the deployment, writes $CHAIN_DEPLOYMENT and exits —
# the same shape as the data family, which answers its questions into files and
# exits. conformance/blockchain replays that declaration onto a chain of its own.
run:
	npx hardhat run scripts/deploy.ts --network hardhat

build:
	npx hardhat compile

test:
	npx hardhat test

lint:
	npx solhint 'contracts/**/*.sol'
	npx tsc --noEmit
