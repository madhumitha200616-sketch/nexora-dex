// Adds a SECOND, much tighter (+/-2%) liquidity position on top of the
// existing +/-5% position in each of the 6 custom-token pools (fee 500).
// Uniswap V3 liquidity from multiple positions is simply additive at every
// tick they share, so this doesn't replace anything - it stacks more depth
// right around the current price, which is what actually determines how
// large a swap can go before price impact crosses 1%. Reads the pool's
// LIVE current tick (not a recomputed target) so the new tight range is
// exactly centered on where the pool actually is right now.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { nearestUsableTick, FeeAmount, TICK_SPACINGS } = require("@uniswap/v3-sdk");
const { FACTORY_ADDRESS, POSITION_MANAGER_ADDRESS } = require("./tokens.config");

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"];
const POSITION_MANAGER_ABI = [
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) external payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];

const POOL_FEE = 500;
const DELTA_ANCHOR = 550_000; // additional units of the pricier token per pair
const RANGE_PCT = 0.02; // +/-2% - the sweet spot found by simulation (tighter gave no further benefit)

const feeAmount = { 500: FeeAmount.LOW, 3000: FeeAmount.MEDIUM, 10000: FeeAmount.HIGH }[POOL_FEE];
const tickSpacing = TICK_SPACINGS[feeAmount];

function rangeToTicks(rangePct) {
  return Math.log(1 + rangePct) / Math.log(1.0001);
}

function pairs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  }
  return out;
}

async function main() {
  const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-tokens.json"), "utf8"));
  const [deployer] = await hre.ethers.getSigners();
  const factory = new hre.ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, deployer);
  const positionManager = new hre.ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, deployer);

  for (const [x, y] of pairs(tokens)) {
    const [pricier, cheaper] = x.priceUsd >= y.priceUsd ? [x, y] : [y, x];
    console.log(`\n=== ${pricier.ticker} <-> ${cheaper.ticker} (top-up, +/-${RANGE_PCT * 100}%) ===`);

    const token0Addr = pricier.address.toLowerCase() < cheaper.address.toLowerCase() ? pricier.address : cheaper.address;
    const token1Addr = pricier.address.toLowerCase() < cheaper.address.toLowerCase() ? cheaper.address : pricier.address;

    const poolAddr = await factory.getPool(pricier.address, cheaper.address, POOL_FEE);
    const pool = new hre.ethers.Contract(poolAddr, POOL_ABI, deployer);
    const slot0 = await pool.slot0();
    const tickCurrent = slot0[1];

    const tickLower = nearestUsableTick(tickCurrent - Math.round(rangeToTicks(RANGE_PCT)), tickSpacing);
    const tickUpper = nearestUsableTick(tickCurrent + Math.round(rangeToTicks(RANGE_PCT)), tickSpacing);
    console.log(`  Live tick=${tickCurrent}, new range=[${tickLower}, ${tickUpper}]`);

    const priceCheaperPerPricier = pricier.priceUsd / cheaper.priceUsd;
    const amountPricier = hre.ethers.utils.parseUnits(String(DELTA_ANCHOR), pricier.decimals);
    const amountCheaper = hre.ethers.utils.parseUnits((DELTA_ANCHOR * priceCheaperPerPricier).toFixed(0), cheaper.decimals);

    const amount0Desired = token0Addr === pricier.address ? amountPricier : amountCheaper;
    const amount1Desired = token0Addr === pricier.address ? amountCheaper : amountPricier;

    console.log(`  Depositing ${DELTA_ANCHOR} ${pricier.ticker} + ${(DELTA_ANCHOR * priceCheaperPerPricier).toFixed(0)} ${cheaper.ticker}`);

    console.log("  Approving...");
    const pricierContract = new hre.ethers.Contract(pricier.address, ERC20_ABI, deployer);
    const cheaperContract = new hre.ethers.Contract(cheaper.address, ERC20_ABI, deployer);
    let tx = await pricierContract.approve(POSITION_MANAGER_ADDRESS, amountPricier);
    await tx.wait();
    tx = await cheaperContract.approve(POSITION_MANAGER_ADDRESS, amountCheaper);
    await tx.wait();

    console.log("  Minting top-up position...");
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    tx = await positionManager.mint({
      token0: token0Addr,
      token1: token1Addr,
      fee: POOL_FEE,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: deployer.address,
      deadline,
    });
    const receipt = await tx.wait();
    console.log(`  Done. Tx: ${receipt.transactionHash}`);
  }

  console.log("\nAll 6 pools topped up with concentrated +/-2% liquidity.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
