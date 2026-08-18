const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ERC20_ABI = ["function transfer(address to, uint256 amount) external returns (bool)"];

// Modest funding per token - enough for 100 claims of 100 tokens each.
// ORBT's remaining balance is tight after the AMM liquidity work, so this
// stays small relative to that rather than assuming there's plenty to spare.
const FAUCET_RESERVE_PER_TOKEN = 10_000;

async function main() {
  const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-tokens.json"), "utf8"));
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying NexoraFaucet...");
  const Faucet = await hre.ethers.getContractFactory("NexoraFaucet");
  const faucet = await Faucet.deploy();
  await faucet.deployed();
  console.log(`Faucet deployed at ${faucet.address}`);

  console.log(`\nFunding faucet (${FAUCET_RESERVE_PER_TOKEN} of each token)...`);
  for (const t of tokens) {
    const token = new hre.ethers.Contract(t.address, ERC20_ABI, deployer);
    const amount = hre.ethers.utils.parseUnits(String(FAUCET_RESERVE_PER_TOKEN), t.decimals);
    const tx = await token.transfer(faucet.address, amount);
    await tx.wait();
    console.log(`  Sent ${FAUCET_RESERVE_PER_TOKEN} ${t.ticker} -> faucet`);
  }

  const outPath = path.join(__dirname, "..", "deployed-faucet.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        address: faucet.address,
        claimAmount: 100,
        cooldownHours: 24,
        tokens: tokens.map((t) => ({ ticker: t.ticker, name: t.name, address: t.address, decimals: t.decimals })),
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
