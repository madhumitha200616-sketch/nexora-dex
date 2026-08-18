const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const JSBI = require("jsbi");
const { encodeSqrtRatioX96, TickMath, nearestUsableTick, FeeAmount, TICK_SPACINGS } = require("@uniswap/v3-sdk");
const {
  USDC_SEPOLIA_ADDRESS,
  USDC_DECIMALS,
  POSITION_MANAGER_ADDRESS,
  POOL_FEE,
} = require("./tokens.config");

const POSITION_MANAGER_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) external payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// Full-range position: always in range regardless of how the (thin,
// testnet-only) price moves, so this never needs active management.
const feeAmount = { 500: FeeAmount.LOW, 3000: FeeAmount.MEDIUM, 10000: FeeAmount.HIGH }[POOL_FEE];
const tickSpacing = TICK_SPACINGS[feeAmount];
const MIN_TICK = nearestUsableTick(TickMath.MIN_TICK, tickSpacing);
const MAX_TICK = nearestUsableTick(TickMath.MAX_TICK, tickSpacing);

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-tokens.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error("deployed-tokens.json not found - run `npm run deploy:tokens` first.");
  }
  const deployedTokens = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const usdcPerPool = process.env.LIQUIDITY_USDC_PER_POOL || "10";
  console.log(`Seeding each pool with ${usdcPerPool} USDC (+ the matching amount of the new token).\n`);

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer available - set PRIVATE_KEY in contracts-nexora/.env.");
  }

  const positionManager = new hre.ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, deployer);
  const usdc = new hre.ethers.Contract(USDC_SEPOLIA_ADDRESS, ERC20_ABI, deployer);

  const usdcAmount = hre.ethers.utils.parseUnits(usdcPerPool, USDC_DECIMALS);

  const results = [];

  for (const token of deployedTokens) {
    console.log(`\n=== ${token.name} (${token.ticker}) ===`);

    // 1 TOKEN ~= priceUsd USD ~= priceUsd USDC, so this is how much of the
    // new token matches the USDC amount above at the target price.
    const tokenAmountFloat = Number(usdcPerPool) / token.priceUsd;
    const tokenAmount = hre.ethers.utils.parseUnits(tokenAmountFloat.toFixed(18), token.decimals);
    console.log(`  Seeding ${tokenAmountFloat} ${token.ticker} + ${usdcPerPool} USDC`);

    const tokenContract = new hre.ethers.Contract(token.address, ERC20_ABI, deployer);

    // Uniswap pools are ordered by address (token0 < token1).
    const isTokenFirst = token.address.toLowerCase() < USDC_SEPOLIA_ADDRESS.toLowerCase();
    const token0 = isTokenFirst ? token.address : USDC_SEPOLIA_ADDRESS;
    const token1 = isTokenFirst ? USDC_SEPOLIA_ADDRESS : token.address;
    const amount0Desired = isTokenFirst ? tokenAmount : usdcAmount;
    const amount1Desired = isTokenFirst ? usdcAmount : tokenAmount;

    const sqrtPriceX96 = encodeSqrtRatioX96(
      JSBI.BigInt(amount1Desired.toString()),
      JSBI.BigInt(amount0Desired.toString())
    ).toString();

    console.log("  Creating + initializing pool (no-op if it already exists)...");
    let tx = await positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
    await tx.wait();

    console.log("  Approving token spend...");
    tx = await tokenContract.approve(POSITION_MANAGER_ADDRESS, tokenAmount);
    await tx.wait();
    tx = await usdc.approve(POSITION_MANAGER_ADDRESS, usdcAmount);
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

    results.push({ ...token, poolFee: POOL_FEE, seededUsdc: usdcPerPool, seededToken: tokenAmountFloat });
  }

  fs.writeFileSync(deployedPath, JSON.stringify(results, null, 2));
  console.log("\nAll pools created and seeded. Run `npm run update:tokenlist` next.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
