// Creates a direct Uniswap V3 pool between EVERY pair of the 4 new tokens
// (NOVA-FSN, NOVA-VRTX, NOVA-ORBT, FSN-VRTX, FSN-ORBT, VRTX-ORBT), so they
// swap against each other directly, not just via USDC. Seeded from the
// tokens' own held supply (each wallet already holds ~999,999 of every
// token), so unlike 02-create-pools-and-seed-liquidity.js this doesn't touch
// your USDC balance at all - only a little of each new token, plus gas.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const JSBI = require("jsbi");
const { encodeSqrtRatioX96, TickMath, nearestUsableTick, FeeAmount, TICK_SPACINGS } = require("@uniswap/v3-sdk");
const { POSITION_MANAGER_ADDRESS, POOL_FEE } = require("./tokens.config");

const POSITION_MANAGER_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) external payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// Reference USD value each side of every cross-pool is seeded with. This is
// nominal (the tokens have no real-world value), not real USDC being spent -
// it's just how many of the already-held 1,000,000-supply tokens go into
// the pool, sized so a several-thousand-unit swap stays under ~1% price
// impact instead of draining a razor-thin pool. Override via env var to
// add even more depth later (each run ADDS an additional liquidity
// position on top of what's already there, it doesn't replace it).
const REF_USD = Number(process.env.CROSS_POOL_REF_USD || 100_000_000);

const feeAmount = { 500: FeeAmount.LOW, 3000: FeeAmount.MEDIUM, 10000: FeeAmount.HIGH }[POOL_FEE];
const tickSpacing = TICK_SPACINGS[feeAmount];
const MIN_TICK = nearestUsableTick(TickMath.MIN_TICK, tickSpacing);
const MAX_TICK = nearestUsableTick(TickMath.MAX_TICK, tickSpacing);

function pairs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  }
  return out;
}

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-tokens.json");
  const tokens = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer available - set PRIVATE_KEY in contracts-nexora/.env.");

  const positionManager = new hre.ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, deployer);

  for (const [a, b] of pairs(tokens)) {
    console.log(`\n=== ${a.ticker} <-> ${b.ticker} ===`);

    const amountAFloat = REF_USD / a.priceUsd;
    const amountBFloat = REF_USD / b.priceUsd;
    const amountA = hre.ethers.utils.parseUnits(amountAFloat.toFixed(18), a.decimals);
    const amountB = hre.ethers.utils.parseUnits(amountBFloat.toFixed(18), b.decimals);
    console.log(`  Seeding ${amountAFloat} ${a.ticker} + ${amountBFloat} ${b.ticker}`);

    const isAFirst = a.address.toLowerCase() < b.address.toLowerCase();
    const token0 = isAFirst ? a.address : b.address;
    const token1 = isAFirst ? b.address : a.address;
    const amount0Desired = isAFirst ? amountA : amountB;
    const amount1Desired = isAFirst ? amountB : amountA;

    const sqrtPriceX96 = encodeSqrtRatioX96(
      JSBI.BigInt(amount1Desired.toString()),
      JSBI.BigInt(amount0Desired.toString())
    ).toString();

    console.log("  Creating + initializing pool (no-op if it already exists)...");
    let tx = await positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
    await tx.wait();

    console.log("  Approving token spend...");
    const tokenAContract = new hre.ethers.Contract(a.address, ERC20_ABI, deployer);
    const tokenBContract = new hre.ethers.Contract(b.address, ERC20_ABI, deployer);
    tx = await tokenAContract.approve(POSITION_MANAGER_ADDRESS, amountA);
    await tx.wait();
    tx = await tokenBContract.approve(POSITION_MANAGER_ADDRESS, amountB);
    await tx.wait();

    console.log("  Minting liquidity position...");
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    tx = await positionManager.mint({
      token0,
      token1,
      fee: POOL_FEE,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
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

  console.log("\nAll 6 cross-pools created. The 4 tokens can now swap directly against each other, not just via USDC.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
