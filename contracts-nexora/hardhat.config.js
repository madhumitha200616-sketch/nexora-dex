require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Falls back to the same public Sepolia RPC the frontend (dex/.env) already
// uses, so this works out of the box even if you don't set your own.
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// Never committed - see .env.example. Deployment/pool scripts simply won't
// have a signer to work with until this is filled in locally.
const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
};
