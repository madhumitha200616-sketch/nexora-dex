// Pulls all token reserves back out of both the abandoned first exchange
// deployment and the current one, back to the deployer wallet - freeing
// that capital for real Uniswap V3 pools instead.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const EXCHANGE_ABI = [
  "function withdrawReserve(address token, uint256 amount, address to) external",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

const OLD_EXCHANGE_ADDRESS = "0x7d0f89d586C89C607f1c5124FDA5C14C9A6D6FD0";

async function main() {
  const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-tokens.json"), "utf8"));
  const exchangeInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-exchange.json"), "utf8"));

  const [deployer] = await hre.ethers.getSigners();

  for (const exchangeAddress of [OLD_EXCHANGE_ADDRESS, exchangeInfo.address]) {
    console.log(`\n=== Recovering from exchange ${exchangeAddress} ===`);
    const exchange = new hre.ethers.Contract(exchangeAddress, EXCHANGE_ABI, deployer);

    for (const t of tokens) {
      const tokenContract = new hre.ethers.Contract(t.address, ERC20_ABI, deployer);
      const balance = await tokenContract.balanceOf(exchangeAddress);
      if (balance.isZero()) {
        console.log(`  ${t.ticker}: nothing to recover`);
        continue;
      }
      console.log(`  Recovering ${hre.ethers.utils.formatUnits(balance, t.decimals)} ${t.ticker}...`);
      const tx = await exchange.withdrawReserve(t.address, balance, deployer.address);
      await tx.wait();
      console.log(`  Done.`);
    }
  }

  console.log("\n=== Final wallet balances ===");
  for (const t of tokens) {
    const tokenContract = new hre.ethers.Contract(t.address, ERC20_ABI, deployer);
    const balance = await tokenContract.balanceOf(deployer.address);
    console.log(`  ${t.ticker}: ${hre.ethers.utils.formatUnits(balance, t.decimals)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
