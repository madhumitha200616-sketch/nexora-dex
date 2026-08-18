const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { NEW_TOKENS, INITIAL_SUPPLY } = require("./tokens.config");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available - set PRIVATE_KEY in contracts-nexora/.env (copy .env.example first)."
    );
  }

  console.log(`Deploying from ${deployer.address}`);
  const balance = await deployer.getBalance();
  console.log(`Balance: ${hre.ethers.utils.formatEther(balance)} ETH`);
  if (balance.isZero()) {
    throw new Error(
      "Deployer wallet has 0 Sepolia ETH - get some from a faucet before deploying."
    );
  }

  const Token = await hre.ethers.getContractFactory("NexoraToken");
  const deployed = [];

  for (const t of NEW_TOKENS) {
    console.log(`\nDeploying ${t.name} (${t.ticker})...`);
    const token = await Token.deploy(t.name, t.ticker, INITIAL_SUPPLY);
    await token.deployed();
    console.log(`  -> ${token.address}`);
    deployed.push({
      ticker: t.ticker,
      name: t.name,
      priceUsd: t.priceUsd,
      address: token.address,
      decimals: 18,
      initialSupply: INITIAL_SUPPLY,
    });
  }

  const outPath = path.join(__dirname, "..", "deployed-tokens.json");
  fs.writeFileSync(outPath, JSON.stringify(deployed, null, 2));
  console.log(`\nSaved addresses to ${outPath}`);
  console.log("Next: run `npm run deploy:pools` to create Uniswap pools and seed liquidity.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
