// One-time research script: finds every live pool address for the 4 custom
// tokens (paired with each other AND with USDC), so the dashboard can read
// from known addresses at runtime instead of calling factory.getPool()
// repeatedly in the browser. Writes a static config file the frontend
// imports directly - same pattern as tokenList.json/faucetConfig.json.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { FACTORY_ADDRESS, USDC_SEPOLIA_ADDRESS } = require("./tokens.config");

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function liquidity() view returns (uint128)"];

function pairs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  }
  return out;
}

async function main() {
  const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-tokens.json"), "utf8"));
  const faucetInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-faucet.json"), "utf8"));
  const provider = hre.ethers.provider;
  const factory = new hre.ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const currentBlock = await provider.getBlockNumber();
  console.log("Current block:", currentBlock);

  const pools = [];

  // Cross pairs (fee 500, the corrected deployment)
  for (const [a, b] of pairs(tokens)) {
    const addr = await factory.getPool(a.address, b.address, 500);
    if (addr !== hre.ethers.constants.AddressZero) {
      const pool = new hre.ethers.Contract(addr, POOL_ABI, provider);
      const [slot0, liquidity] = await Promise.all([pool.slot0(), pool.liquidity()]);
      pools.push({
        pair: `${a.ticker}/${b.ticker}`,
        tokenA: a.ticker,
        tokenB: b.ticker,
        address: addr,
        fee: 500,
        tick: slot0[1],
        liquidity: liquidity.toString(),
      });
      console.log(`${a.ticker}/${b.ticker} @ 500: ${addr} (tick=${slot0[1]}, liquidity=${liquidity.toString()})`);
    } else {
      console.log(`${a.ticker}/${b.ticker} @ 500: NOT FOUND`);
    }
  }

  // USDC pairs (fee 3000)
  for (const t of tokens) {
    const addr = await factory.getPool(t.address, USDC_SEPOLIA_ADDRESS, 3000);
    if (addr !== hre.ethers.constants.AddressZero) {
      const pool = new hre.ethers.Contract(addr, POOL_ABI, provider);
      const [slot0, liquidity] = await Promise.all([pool.slot0(), pool.liquidity()]);
      pools.push({
        pair: `${t.ticker}/USDC`,
        tokenA: t.ticker,
        tokenB: "USDC",
        address: addr,
        fee: 3000,
        tick: slot0[1],
        liquidity: liquidity.toString(),
      });
      console.log(`${t.ticker}/USDC @ 3000: ${addr} (tick=${slot0[1]}, liquidity=${liquidity.toString()})`);
    } else {
      console.log(`${t.ticker}/USDC @ 3000: NOT FOUND`);
    }
  }

  const config = {
    generatedAtBlock: currentBlock,
    // Conservative floor for event-log scans (Swap/Mint) - safely before ALL
    // pool creation/liquidity activity this session, small enough that a
    // scan doesn't have to cover the chain's entire history.
    scanFromBlock: currentBlock - 5000,
    factoryAddress: FACTORY_ADDRESS,
    usdcAddress: USDC_SEPOLIA_ADDRESS,
    faucetAddress: faucetInfo.address,
    tokens: tokens.map((t) => ({ ticker: t.ticker, name: t.name, address: t.address, decimals: t.decimals, priceUsd: t.priceUsd })),
    pools,
  };

  const outPath = path.join(__dirname, "..", "analytics-config.json");
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`\nSaved ${pools.length} pools to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
