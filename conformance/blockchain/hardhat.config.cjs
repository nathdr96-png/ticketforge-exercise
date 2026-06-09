/**
 * The GRADER's own local chain.
 *
 * This is not a build configuration: there are no sources to compile (see
 * `paths.sources`, which points at an empty directory on purpose, so that no
 * Solidity compiler is ever downloaded or run here). Its only job is to
 * describe the development chain that `globalSetup.ts` starts with
 * `hardhat node`, so that the conformance suite has a chain of its own to
 * replay the implementation's deployment onto.
 *
 * Deterministic and offline by construction: the standard local mnemonic, a
 * fixed chain id, auto-mining, no forking and no RPC URL anywhere.
 */
module.exports = {
  solidity: "0.8.28",
  paths: { sources: "./nosources", tests: "./nosources", cache: "./.hardhat-cache", artifacts: "./.hardhat-artifacts" },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: { mnemonic: "test test test test test test test test test test test junk", count: 20 },
      loggingEnabled: false,
      mining: { auto: true },
    },
  },
};
