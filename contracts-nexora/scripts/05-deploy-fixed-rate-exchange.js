const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { EXCHANGE_RESERVE_PER_TOKEN } = require("./tokens.config");

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-tokens.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error("deployed-tokens.json not found - run deploy:tokens first.");
  }
  const tokens = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer available - set PRIVATE_KEY in contracts-nexora/.env.");

  const addresses = tokens.map((t) => t.address);
  const prices18 = tokens.map((t) => hre.ethers.utils.parseUnits(String(t.priceUsd), 18));

  console.log("Deploying NexoraFixedRateExchange with prices:");
  tokens.forEach((t) => console.log(`  ${t.ticker}: $${t.priceUsd}`));

  const Exchange = await hre.ethers.getContractFactory("NexoraFixedRateExchange");
  const exchange = await Exchange.deploy(addresses, prices18);
  await exchange.deployed();
  console.log(`\nExchange deployed at ${exchange.address}`);

  console.log(`\nFunding reserves (${EXCHANGE_RESERVE_PER_TOKEN.toLocaleString()} of each token)...`);
  for (const t of tokens) {
    const token = new hre.ethers.Contract(t.address, ERC20_ABI, deployer);
    const amount = hre.ethers.utils.parseUnits(String(EXCHANGE_RESERVE_PER_TOKEN), t.decimals);
    const tx = await token.transfer(exchange.address, amount);
    await tx.wait();
    console.log(`  Sent ${EXCHANGE_RESERVE_PER_TOKEN.toLocaleString()} ${t.ticker} -> exchange reserve`);
  }

  const outPath = path.join(__dirname, "..", "deployed-exchange.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        address: exchange.address,
        reservePerToken: EXCHANGE_RESERVE_PER_TOKEN,
        tokens: tokens.map((t) => ({ ticker: t.ticker, address: t.address, priceUsd: t.priceUsd })),
      },
      null,
      2
    )
  );
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
