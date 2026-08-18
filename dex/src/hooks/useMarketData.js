import { useEffect, useState } from "react";
import { ethers } from "ethers";

// Dedicated RPC endpoint for this page only - the app's default endpoint
// (REACT_APP_INFURA_URL, a free public node) is more prone to throttling
// under repeated queries. This is the same endpoint AnalyticsDashboard.js
// already relies on for heavier querying elsewhere in this project.
const RPC_URL = "https://ethereum-sepolia.publicnode.com";

const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];
const FEE_TIERS = [500, 3000, 10000, 100];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const SWAP_EVENT_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

const ERC20_ABI = ["function balanceOf(address owner) external view returns (uint256)"];

// Fetched once per token selection and shared by the 24H/7D/1M tabs - a
// tab switch just filters this same dataset by wall-clock time instead of
// refetching.
const MAX_RANGE_BLOCKS = 21600; // ~3 days on Sepolia at ~12s/block
const AVG_BLOCK_SECONDS = 12;
const RPC_TIMEOUT_MS = 10000;
const REQUEST_SPACING_MS = 400;
// Hard ceiling on the WHOLE load, independent of how many individual calls
// succeed or fail inside it - a free public RPC under load can make each
// small piece slow without ever cleanly erroring, and without this the
// page would just sit on "Loading..." forever instead of surfacing a
// retryable error like the UI requires.
const OVERALL_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkSizeFor(rangeBlocks) {
  if (rangeBlocks <= 8000) return 2000;
  if (rangeBlocks <= 60000) return 6000;
  return 10000;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function findPoolFee(provider, tokenA, tokenB) {
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  for (let i = 0; i < FEE_TIERS.length; i++) {
    if (i > 0) await sleep(REQUEST_SPACING_MS);
    const pool = await withTimeout(factory.getPool(tokenA, tokenB, FEE_TIERS[i]), RPC_TIMEOUT_MS);
    if (pool && pool !== ethers.constants.AddressZero) {
      return { fee: FEE_TIERS[i], poolAddress: pool };
    }
  }
  return null;
}

// Current spot price read from slot0(), independent of trade history. Same
// decimals exponent applies regardless of which side is "base" - only the
// raw ratio flips depending on token ordering.
function spotPriceBaseInQuote(sqrtPriceX96, token0IsBase, decimalsBase, decimalsQuote) {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const priceToken1PerToken0Raw = ratio * ratio;
  const rawRatio = token0IsBase ? priceToken1PerToken0Raw : 1 / priceToken1PerToken0Raw;
  return rawRatio * 10 ** (decimalsBase - decimalsQuote);
}

const EMPTY_STATE = {
  loading: true,
  error: null,
  poolInfo: null,
  trades: [],
  spotPrice: null,
  liquidityBase: null,
  liquidityQuote: null,
};

export function useMarketData(baseToken, quoteToken, reloadKey = 0) {
  const [state, setState] = useState(EMPTY_STATE);

  useEffect(() => {
    if (!baseToken || !quoteToken) return;
    let settled = false;
    setState({ ...EMPTY_STATE, loading: true });

    function finish(next) {
      if (settled) return;
      settled = true;
      setState(next);
    }

    async function run() {
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      const poolResult = await findPoolFee(provider, baseToken.sepoliaAddress, quoteToken.sepoliaAddress);
      if (!poolResult) {
        return { ...EMPTY_STATE, loading: false, error: "no-pool" };
      }

      const pool = new ethers.Contract(poolResult.poolAddress, POOL_ABI, provider);
      const iface = new ethers.utils.Interface(SWAP_EVENT_ABI);
      const token0IsBase = baseToken.sepoliaAddress.toLowerCase() < quoteToken.sepoliaAddress.toLowerCase();

      const currentBlock = await withTimeout(provider.getBlockNumber(), RPC_TIMEOUT_MS);
      const fromBlock = Math.max(0, currentBlock - MAX_RANGE_BLOCKS);
      const chunkSize = chunkSizeFor(MAX_RANGE_BLOCKS);
      const swapTopic = iface.getEventTopic("Swap");

      // A single reference block anchors every trade's Date/Time instead of
      // one getBlock() call per unique swap block - that per-event approach
      // multiplied RPC calls by however many distinct blocks had trades and
      // was the main reason this used to stall. Sepolia's block time is a
      // steady ~12s, so estimating from one real anchor timestamp stays
      // accurate to within a small margin while cutting calls from O(trades)
      // to O(1). The price and block number for every trade are still exact,
      // on-chain values - only the displayed time is an estimate.
      const anchorBlock = await withTimeout(provider.getBlock(currentBlock), RPC_TIMEOUT_MS);
      const anchorTimestamp = anchorBlock.timestamp;

      const logs = [];
      for (let start = fromBlock; start <= currentBlock; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, currentBlock);
        try {
          const chunk = await withTimeout(
            provider.getLogs({
              address: poolResult.poolAddress,
              topics: [swapTopic],
              fromBlock: start,
              toBlock: end,
            }),
            RPC_TIMEOUT_MS
          );
          logs.push(...chunk);
        } catch (err) {
          console.warn(`useMarketData: getLogs failed for blocks ${start}-${end}:`, err.message);
        }
        if (start + chunkSize <= currentBlock) await sleep(REQUEST_SPACING_MS);
      }

      const trades = logs
        .map((log) => {
          const parsed = iface.parseLog(log);
          const amount0 = Number(
            ethers.utils.formatUnits(parsed.args.amount0.abs(), token0IsBase ? baseToken.decimals : quoteToken.decimals)
          );
          const amount1 = Number(
            ethers.utils.formatUnits(parsed.args.amount1.abs(), token0IsBase ? quoteToken.decimals : baseToken.decimals)
          );
          if (amount0 === 0 || amount1 === 0) return null;
          const price = token0IsBase ? amount1 / amount0 : amount0 / amount1;
          const volumeQuote = token0IsBase ? amount1 : amount0;
          const timestamp = anchorTimestamp - (currentBlock - log.blockNumber) * AVG_BLOCK_SECONDS;
          return { blockNumber: log.blockNumber, timestamp, price, volumeQuote };
        })
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);

      await sleep(REQUEST_SPACING_MS);

      const [slot0, liquidityBaseRaw, liquidityQuoteRaw] = await withTimeout(
        Promise.all([
          pool.slot0(),
          new ethers.Contract(baseToken.sepoliaAddress, ERC20_ABI, provider).balanceOf(poolResult.poolAddress),
          new ethers.Contract(quoteToken.sepoliaAddress, ERC20_ABI, provider).balanceOf(poolResult.poolAddress),
        ]),
        RPC_TIMEOUT_MS
      );

      const spotPrice = spotPriceBaseInQuote(slot0.sqrtPriceX96, token0IsBase, baseToken.decimals, quoteToken.decimals);
      const liquidityBase = Number(ethers.utils.formatUnits(liquidityBaseRaw, baseToken.decimals));
      const liquidityQuote = Number(ethers.utils.formatUnits(liquidityQuoteRaw, quoteToken.decimals));

      return { loading: false, error: null, poolInfo: poolResult, trades, spotPrice, liquidityBase, liquidityQuote };
    }

    withTimeout(run(), OVERALL_TIMEOUT_MS)
      .then((next) => finish(next))
      .catch((err) => {
        console.error("useMarketData load failed:", err.message);
        finish({ ...EMPTY_STATE, loading: false, error: "load-failed" });
      });

    return () => {
      settled = true;
    };
  }, [baseToken, quoteToken, reloadKey]);

  return state;
}
