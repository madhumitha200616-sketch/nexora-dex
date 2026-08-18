// Creates a REAL Uniswap V3 pool between every pair of the 4 custom tokens,
// using CONCENTRATED liquidity (a tight +/-5% range around the target
// price) instead of full-range. Full-range spreads liquidity across an
// enormous price span most of which never gets used, so it needs far more
// capital to hit the same price-impact target - concentrating it near the
// actual trading price gets the same (or better) depth-where-it-matters
// using a fraction of the tokens. Parameters below were verified off-chain
// first (see conversation) to keep a 50,000-token swap under ~1% impact,
// even under a 100,000-token stress test.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const JSBI = require("jsbi");
const { Pool, Position, TickMath, nearestUsableTick, FeeAmount, TICK_SPACINGS } = require("@uniswap/v3-sdk");
const { Token, CurrencyAmount } = require("@uniswap/sdk-core");
const { POSITION_MANAGER_ADDRESS } = require("./tokens.config");

const POSITION_MANAGER_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) external payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];

const CHAIN_ID = 11155111;
// 500 (0.05%), NOT the shared 3000 used elsewhere - the first attempt at
// this deploy (fee 3000) had a price-inversion bug and initialized those
// pools wrong. Rather than fight an already-initialized pool at the wrong
// price, this uses a fresh fee tier so it's a clean new pool. The old,
// mispriced fee-3000 pools are left orphaned with their (small) misplaced
// liquidity - harmless on testnet, not worth the complexity of surgically
// draining them.
const POOL_FEE = 500;
const ANCHOR_AMOUNT = 400_000; // units of the pricier token in each pair
const RANGE_PCT = 0.05; // +/-5%

const feeAmount = { 500: FeeAmount.LOW, 3000: FeeAmount.MEDIUM, 10000: FeeAmount.HIGH }[POOL_FEE];
const tickSpacing = TICK_SPACINGS[feeAmount];

function rangeToTicks(rangePct) {
  return Math.log(1 + rangePct) / Math.log(1.0001);
}

function sqrtJSBI(value) {
  if (JSBI.lessThan(value, JSBI.BigInt(2))) return value;
  let x0 = value;
  let x1 = JSBI.signedRightShift(JSBI.add(x0, JSBI.BigInt(1)), JSBI.BigInt(1));
  while (JSBI.lessThan(x1, x0)) {
    x0 = x1;
    x1 = JSBI.signedRightShift(JSBI.add(JSBI.divide(value, x0), x0), JSBI.BigInt(1));
  }
  return x0;
}

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
  const positionManager = new hre.ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, deployer);

  for (const [x, y] of pairs(tokens)) {
    // Always anchor on the PRICIER token - the cheaper one then naturally
    // gets a proportionally larger raw amount, so both trade directions end
    // up well-covered (verified in simulation).
    const [pricier, cheaper] = x.priceUsd >= y.priceUsd ? [x, y] : [y, x];
    console.log(`\n=== ${pricier.ticker} <-> ${cheaper.ticker} (concentrated) ===`);

    const priceCheaperPerPricier = pricier.priceUsd / cheaper.priceUsd;
    const depositPricier = ANCHOR_AMOUNT;
    const depositCheaper = ANCHOR_AMOUNT * priceCheaperPerPricier;
    console.log(`  Target deposit: ${depositPricier} ${pricier.ticker} + ${depositCheaper} ${cheaper.ticker}`);

    const tokenPricier = new Token(CHAIN_ID, pricier.address, pricier.decimals, pricier.ticker);
    const tokenCheaper = new Token(CHAIN_ID, cheaper.address, cheaper.decimals, cheaper.ticker);
    const [token0, token1] = tokenPricier.sortsBefore(tokenCheaper) ? [tokenPricier, tokenCheaper] : [tokenCheaper, tokenPricier];

    // price of token1 in terms of token0
    // price0to1 = token1 per token0. priceCheaperPerPricier already means
    // "how many cheaper-tokens equal 1 pricier-token" (it's a token-count
    // ratio, not a USD ratio needing inversion) - so when token0 IS the
    // pricier token, price0to1 (cheaper-per-pricier) equals it directly;
    // when token0 is the cheaper token, price0to1 is its reciprocal
    // (pricier-per-cheaper). (Earlier version had this backwards, which
    // initialized every pool at the wrong price - that was the actual bug.)
    const price0to1 = token0.address === tokenPricier.address ? priceCheaperPerPricier : 1 / priceCheaperPerPricier;
    const Q192 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(192));
    const priceScaled = BigInt(Math.round(price0to1 * 1e12));
    const numerator = JSBI.multiply(JSBI.BigInt(priceScaled.toString()), Q192);
    const denominator = JSBI.BigInt((10n ** 12n).toString());
    const ratioX192 = JSBI.divide(numerator, denominator);
    const sqrtRatioX96 = sqrtJSBI(ratioX192).toString();

    const tickCurrent = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtRatioX96));
    const tickLower = nearestUsableTick(tickCurrent - Math.round(rangeToTicks(RANGE_PCT)), tickSpacing);
    const tickUpper = nearestUsableTick(tickCurrent + Math.round(rangeToTicks(RANGE_PCT)), tickSpacing);

    const pool = new Pool(token0, token1, POOL_FEE, sqrtRatioX96, JSBI.BigInt(0), tickCurrent);

    const amountPricier = CurrencyAmount.fromRawAmount(
      tokenPricier,
      JSBI.BigInt(hre.ethers.utils.parseUnits(String(depositPricier), pricier.decimals).toString())
    );
    const amountCheaper = CurrencyAmount.fromRawAmount(
      tokenCheaper,
      JSBI.BigInt(hre.ethers.utils.parseUnits(depositCheaper.toFixed(0), cheaper.decimals).toString())
    );
    const amount0 = token0.address === tokenPricier.address ? amountPricier : amountCheaper;
    const amount1 = token0.address === tokenPricier.address ? amountCheaper : amountPricier;

    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: amount0.quotient,
      amount1: amount1.quotient,
      useFullPrecision: true,
    });

    const amount0Desired = hre.ethers.BigNumber.from(position.amount0.quotient.toString());
    const amount1Desired = hre.ethers.BigNumber.from(position.amount1.quotient.toString());

    console.log(`  Actual amounts to deposit: amount0=${position.amount0.toExact()} amount1=${position.amount1.toExact()}`);
    console.log(`  Tick range: [${tickLower}, ${tickUpper}] (current ${tickCurrent})`);

    console.log("  Creating + initializing pool (no-op if it already exists)...");
    let tx = await positionManager.createAndInitializePoolIfNecessary(token0.address, token1.address, POOL_FEE, sqrtRatioX96);
    await tx.wait();

    console.log("  Approving token spend...");
    const token0Contract = new hre.ethers.Contract(token0.address, ERC20_ABI, deployer);
    const token1Contract = new hre.ethers.Contract(token1.address, ERC20_ABI, deployer);
    tx = await token0Contract.approve(POSITION_MANAGER_ADDRESS, amount0Desired);
    await tx.wait();
    tx = await token1Contract.approve(POSITION_MANAGER_ADDRESS, amount1Desired);
    await tx.wait();

    console.log("  Minting concentrated liquidity position...");
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    tx = await positionManager.mint({
      token0: token0.address,
      token1: token1.address,
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

  console.log("\nAll 6 concentrated cross-pools created.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
