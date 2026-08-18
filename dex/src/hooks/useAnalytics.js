import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import analyticsConfig from "../analyticsConfig.json";

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const POOL_ABI = [
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
];

const CLAIMED_ABI = ["event Claimed(address indexed user, address indexed token, uint256 amount)"];

// Same Uniswap V3 QuoterV2 deployment the Swap page already uses for real
// quotes (see Swap.js) - callStatic simulates the swap fully on-chain
// against current pool state without broadcasting a transaction, spending
// gas, or changing any liquidity. Reused here (not re-derived) so "live
// price" means the exact same thing on both pages.
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// This project is Create React App (react-scripts), not Vite - env vars
// must be prefixed REACT_APP_ to be exposed via process.env at build time;
// a VITE_-prefixed var would silently be undefined here. Falls back to the
// public endpoint that's been in use, but any consumer of useAnalytics can
// now point at a dedicated/paid RPC via .env instead of being stuck with a
// hardcoded, frequently rate-limited public node.
export const DEFAULT_SEPOLIA_RPC_URL = process.env.REACT_APP_SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";

const CHUNK_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 5000;
const MIN_SPLIT_SIZE = 150;
const MAX_RETRY_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const decimalsOf = (ticker) => (ticker === "USDC" ? 6 : 18);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || "request"} timed out after ${ms}ms`)), ms)),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ethers v5's fetchJson doesn't always cleanly expose an HTTP status code -
// verified directly against this project's actual RPC endpoint
// (ethereum-sepolia.publicnode.com) that under real concurrent load it
// often drops the connection (ECONNRESET / "missing response") before a
// full 429 response is even parsed, alongside cases where a clean 429
// status does come through. Both are the same underlying cause (the
// endpoint shedding load under too many concurrent requests), so both are
// treated as rate-limiting for diagnostic/backoff purposes rather than
// undercounting real throttling as generic "SERVER_ERROR".
function isRateLimited(err) {
  const status = err?.error?.status ?? err?.status;
  const msg = String(err?.message || err?.error?.message || "");
  return (
    status === 429 ||
    /429/.test(msg) ||
    /rate limit/i.test(msg) ||
    /too many requests/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /missing response/i.test(msg)
  );
}

// Fetches one (address, block range) slice of logs. A 429/rate-limit error
// gets real exponential backoff (500ms, 1s, 2s, 4s...) before retrying -
// hammering an already-throttled endpoint again immediately just extends
// the throttling. After MAX_RETRY_ATTEMPTS, the range is halved and each
// half gets its own fresh attempt budget, which narrows down to just the
// specific sub-range that's actually failing instead of giving up on an
// entire 5000-block chunk over one bad response. Returns null (never a
// fabricated empty array) if a range genuinely can't be read, so the caller
// can honestly mark that slice as incomplete rather than silently showing
// undercounted data as if it were complete.
async function queryRangeWithBackoff(provider, address, topics, from, to, scanStats) {
  let delay = BASE_BACKOFF_MS;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(
        provider.getLogs({
          address,
          topics,
          fromBlock: ethers.utils.hexlify(from),
          toBlock: ethers.utils.hexlify(to),
        }),
        CHUNK_TIMEOUT_MS,
        "eth_getLogs"
      );
    } catch (err) {
      lastErr = err;
      if (scanStats) {
        scanStats.retries++;
        if (isRateLimited(err)) scanStats.rateLimitHits++;
      }
      if (attempt === MAX_RETRY_ATTEMPTS - 1) break;
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
  }
  if (to - from >= MIN_SPLIT_SIZE * 2) {
    const mid = from + Math.floor((to - from) / 2);
    const [left, right] = await Promise.all([
      queryRangeWithBackoff(provider, address, topics, from, mid, scanStats),
      queryRangeWithBackoff(provider, address, topics, mid + 1, to, scanStats),
    ]);
    if (left === null && right === null) return null;
    return [...(left || []), ...(right || [])];
  }
  console.warn(
    `getLogs gave up on ${address} blocks ${from}-${to} after ${MAX_RETRY_ATTEMPTS} attempts` +
      `${isRateLimited(lastErr) ? " (rate-limited / 429)" : ""}:`,
    lastErr?.message
  );
  return null;
}

// Scans a block range for a set of addresses in chunks, processing ONE
// chunk (all addresses, that block range) at a time - not one giant
// Promise.all covering every address x chunk combination for the whole
// historical range at once. This bounds how many concurrent eth_getLogs
// requests are ever in flight to roughly `addresses.length`, is kinder to
// a rate-limited RPC, and lets progress be reported and folded into a
// running total incrementally: chunk 1 resolves and is accumulated before
// chunk 2 even starts, instead of everything resolving in one lump at the
// very end (or not at all, if any single piece of a huge batch hangs).
// Measured directly against this project's RPC endpoint: a 20-way
// concurrent eth_getLogs burst (10 pools x 2 event topics, the exact shape
// this scan produces per chunk) took over 2 minutes and still had a ~35%
// failure rate even with ethers' own internal retries, run from a plain
// Node process with zero other load. A 10-12-way burst against the same
// endpoint completed in under 4 seconds. The endpoint's real limit is
// concurrency, not request count - so address batches within a chunk are
// capped rather than firing all of them (or the combined swap+mint total)
// at once.
const MAX_CONCURRENT_REQUESTS = 6;

async function scanLogsIncremental(provider, addresses, topics, fromBlock, toBlock, onChunkDone, label = "scan") {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    ranges.push([start, Math.min(start + CHUNK_SIZE - 1, toBlock)]);
  }

  const allLogs = [];
  let anyFailed = false;
  const failedRanges = [];
  const scanStats = { retries: 0, rateLimitHits: 0, chunkDurationsMs: [] };
  const scanStartedAt = performance.now();

  for (let i = 0; i < ranges.length; i++) {
    const [from, to] = ranges[i];
    const chunkStartedAt = performance.now();
    const chunkResults = [];
    for (let b = 0; b < addresses.length; b += MAX_CONCURRENT_REQUESTS) {
      const batch = addresses.slice(b, b + MAX_CONCURRENT_REQUESTS);
      const batchResults = await Promise.all(
        batch.map((address) => queryRangeWithBackoff(provider, address, topics, from, to, scanStats))
      );
      chunkResults.push(...batchResults);
    }
    for (let j = 0; j < chunkResults.length; j++) {
      const logs = chunkResults[j];
      if (logs === null) {
        anyFailed = true;
        failedRanges.push({ address: addresses[j], from, to });
      } else {
        allLogs.push(...logs);
      }
    }
    const chunkDurationMs = Math.round(performance.now() - chunkStartedAt);
    scanStats.chunkDurationsMs.push(chunkDurationMs);
    if (onChunkDone) {
      onChunkDone({ chunkIndex: i + 1, chunkCount: ranges.length, logsSoFar: allLogs.length });
    }
  }

  const totalDurationMs = Math.round(performance.now() - scanStartedAt);
  const avgChunkMs =
    scanStats.chunkDurationsMs.length > 0
      ? Math.round(scanStats.chunkDurationsMs.reduce((a, b) => a + b, 0) / scanStats.chunkDurationsMs.length)
      : 0;
  console.debug(
    `[Activity] ${label} scan completed | totalEvents=${allLogs.length} | chunks=${ranges.length} | avgChunkMs=${avgChunkMs} | retries=${scanStats.retries} | 429s=${scanStats.rateLimitHits} | totalDuration=${totalDurationMs}ms | anyFailed=${anyFailed}`
  );

  return {
    logs: allLogs,
    anyFailed,
    failedRanges,
    scanStats: {
      chunkCount: ranges.length,
      blocksPerChunk: CHUNK_SIZE,
      rpcRequestsPerChunk: addresses.length,
      avgChunkMs,
      retries: scanStats.retries,
      rateLimitHits: scanStats.rateLimitHits,
      totalDurationMs,
    },
  };
}

// Retries ONLY the specific (address, block-range) slices a previous scan
// recorded as failed - not the whole historical range. This is what lets a
// single bad chunk recover on the next attempt without re-running the other
// 9 (or however many) chunks that already succeeded and don't need to be
// touched again.
async function rescanFailedRanges(provider, topics, failedRanges) {
  const recoveredLogs = [];
  const stillFailed = [];
  const scanStats = { retries: 0, rateLimitHits: 0, chunkDurationsMs: [] };

  for (let i = 0; i < failedRanges.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = failedRanges.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const results = await Promise.all(
      batch.map((r) => queryRangeWithBackoff(provider, r.address, topics, r.from, r.to, scanStats))
    );
    results.forEach((logs, idx) => {
      if (logs === null) {
        stillFailed.push(batch[idx]);
      } else {
        recoveredLogs.push(...logs);
      }
    });
  }

  return { recoveredLogs, stillFailed, scanStats };
}

// Shared entry point for both a fresh full scan and a "retry just the
// chunks that failed last time" pass. When `previous` carries a nonempty
// failedRanges list, this skips scanLogsIncremental entirely and only
// re-queries those specific ranges, merging any newly-recovered logs into
// the previously-successful ones instead of throwing away and re-fetching
// everything that already worked.
async function scanOrRetry(provider, addresses, topics, fromBlock, toBlock, onProgress, label, previous) {
  if (previous && previous.failedRanges && previous.failedRanges.length > 0) {
    console.debug(`[Activity] ${label} retrying ${previous.failedRanges.length} previously-failed range(s) only (not a full rescan)`);
    const { recoveredLogs, stillFailed, scanStats: retryStats } = await rescanFailedRanges(provider, topics, previous.failedRanges);
    const logs = [...previous.logs, ...recoveredLogs];
    console.debug(
      `[Activity] ${label} retry completed | recovered=${recoveredLogs.length} events | stillFailing=${stillFailed.length}/${previous.failedRanges.length} range(s)`
    );
    onProgress?.({ section: label, chunkIndex: 1, chunkCount: 1, logsSoFar: logs.length });
    return {
      logs,
      anyFailed: stillFailed.length > 0,
      failedRanges: stillFailed,
      scanStats: {
        chunkCount: previous.failedRanges.length,
        blocksPerChunk: CHUNK_SIZE,
        rpcRequestsPerChunk: 1,
        avgChunkMs: 0,
        retries: retryStats.retries,
        rateLimitHits: retryStats.rateLimitHits,
        totalDurationMs: 0,
      },
    };
  }

  return scanLogsIncremental(provider, addresses, topics, fromBlock, toBlock, (p) => onProgress?.({ section: label, ...p }), label);
}

// Computes real spot prices in USDC for tokens directly from their Uniswap V3 USDC pools slot0
export async function fetchOnChainPrices(provider) {
  const prices = { USDC: 1.0 };
  const usdcPools = analyticsConfig.pools.filter((p) => p.tokenB === "USDC" || p.tokenA === "USDC");

  await Promise.all(
    usdcPools.map(async (p) => {
      try {
        const tokenTicker = p.tokenA === "USDC" ? p.tokenB : p.tokenA;
        const poolContract = new ethers.Contract(p.address, POOL_ABI, provider);
        const [slot0, liquidity, token0Addr] = await Promise.all([
          poolContract.slot0(),
          poolContract.liquidity(),
          poolContract.token0(),
        ]);

        if (liquidity.isZero() || slot0.sqrtPriceX96.isZero()) {
          prices[tokenTicker] = null;
          return;
        }

        const ratio = Number(slot0.sqrtPriceX96) / 2 ** 96;
        const priceToken1PerToken0 = ratio * ratio;
        const token0IsUsdc = token0Addr.toLowerCase() === analyticsConfig.usdcAddress.toLowerCase();

        let usdcPrice;
        if (token0IsUsdc) {
          // token0 is USDC (6 dec), token1 is custom token (18 dec)
          usdcPrice = (1 / priceToken1PerToken0) * 10 ** (18 - 6);
        } else {
          // token0 is custom token (18 dec), token1 is USDC (6 dec)
          usdcPrice = priceToken1PerToken0 * 10 ** (18 - 6);
        }

        if (Number.isFinite(usdcPrice) && usdcPrice > 0) {
          prices[tokenTicker] = usdcPrice;
        } else {
          prices[tokenTicker] = null;
        }
      } catch (err) {
        console.warn(`Could not fetch slot0 price for pool ${p.pair}:`, err.message);
        const tokenTicker = p.tokenA === "USDC" ? p.tokenB : p.tokenA;
        prices[tokenTicker] = null;
      }
    })
  );

  return prices;
}

async function fetchSupplyAndBalances(provider) {
  const results = await Promise.all(
    analyticsConfig.tokens.map(async (t) => {
      const token = new ethers.Contract(t.address, ERC20_ABI, provider);
      const [totalSupply, deployerBalance, faucetBalance] = await Promise.all([
        token.totalSupply(),
        token.balanceOf(analyticsConfig.deployerAddress),
        token.balanceOf(analyticsConfig.faucetAddress),
      ]);
      return {
        ticker: t.ticker,
        totalSupply: ethers.utils.formatUnits(totalSupply, t.decimals),
        deployerBalance: ethers.utils.formatUnits(deployerBalance, t.decimals),
        faucetReserve: ethers.utils.formatUnits(faucetBalance, t.decimals),
      };
    })
  );
  return Object.fromEntries(results.map((r) => [r.ticker, r]));
}

async function fetchPoolBalances(provider, pricesUsd) {
  const results = await Promise.all(
    analyticsConfig.pools.map(async (p) => {
      const decA = decimalsOf(p.tokenA);
      const decB = decimalsOf(p.tokenB);
      const tokenAContract = new ethers.Contract(
        analyticsConfig.tokens.find((t) => t.ticker === p.tokenA)?.address || analyticsConfig.usdcAddress,
        ERC20_ABI,
        provider
      );
      const tokenBContract = new ethers.Contract(
        analyticsConfig.tokens.find((t) => t.ticker === p.tokenB)?.address || analyticsConfig.usdcAddress,
        ERC20_ABI,
        provider
      );
      const poolContract = new ethers.Contract(p.address, POOL_ABI, provider);
      const [balA, balB, liquidity] = await Promise.all([
        tokenAContract.balanceOf(p.address),
        tokenBContract.balanceOf(p.address),
        poolContract.liquidity(),
      ]);
      const amountA = Number(ethers.utils.formatUnits(balA, decA));
      const amountB = Number(ethers.utils.formatUnits(balB, decB));

      const priceA = pricesUsd[p.tokenA] ?? null;
      const priceB = pricesUsd[p.tokenB] ?? null;

      let valueUsd = null;
      if (priceA !== null && priceB !== null) {
        valueUsd = amountA * priceA + amountB * priceB;
      }

      return {
        pair: p.pair,
        address: p.address,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
        fee: p.fee,
        amountA,
        amountB,
        valueUsd,
        liquidity: liquidity.toString(),
        healthy: !liquidity.isZero(),
      };
    })
  );
  return results;
}

function tickerToAddress(ticker) {
  if (ticker === "USDC") return analyticsConfig.usdcAddress;
  return analyticsConfig.tokens.find((t) => t.ticker === ticker)?.address;
}

// Real, read-only "10-unit reference trade" price impact, computed live
// against each configured pool's CURRENT on-chain state via QuoterV2's
// callStatic (simulates the swap fully on-chain - no transaction is ever
// broadcast, no gas is spent, no liquidity changes). This is deliberately
// NOT derived from historical Swap events - it's a fresh quote against
// whatever the pool's reserves/ticks look like right now.
//
// Method (same technique the Swap page already uses for its live impact
// display): quote a tiny reference amount to get an effectively
// zero-impact spot rate, quote the real 10-unit amount, and compare the
// real quote against what the tiny quote's rate would have implied for
// 10 units. The gap between "ideal" and "actual" output IS the price
// impact - this needs no external reference price at all, since the pool
// itself supplies the zero-impact rate via the tiny quote.
const PRICE_IMPACT_INPUT_UNITS = "10";
const PRICE_IMPACT_REF_UNITS = "0.0001";

async function quotePoolPriceImpact(quoter, pool) {
  const tokenInAddr = tickerToAddress(pool.tokenA);
  const tokenOutAddr = tickerToAddress(pool.tokenB);
  const decimalsIn = decimalsOf(pool.tokenA);
  const decimalsOut = decimalsOf(pool.tokenB);

  if (!tokenInAddr || !tokenOutAddr) {
    console.warn(`[PriceImpact] ${pool.pair} excluded - missing token address for ${pool.tokenA}/${pool.tokenB}`);
    return null;
  }

  const amountIn = ethers.utils.parseUnits(PRICE_IMPACT_INPUT_UNITS, decimalsIn);
  const refAmountIn = ethers.utils.parseUnits(PRICE_IMPACT_REF_UNITS, decimalsIn);

  let real, ref;
  try {
    [real, ref] = await Promise.all([
      quoter.callStatic.quoteExactInputSingle({
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn,
        fee: pool.fee,
        sqrtPriceLimitX96: 0,
      }),
      quoter.callStatic.quoteExactInputSingle({
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn: refAmountIn,
        fee: pool.fee,
        sqrtPriceLimitX96: 0,
      }),
    ]);
  } catch (err) {
    console.warn(`[PriceImpact] ${pool.pair} excluded - quoteExactInputSingle reverted/failed:`, err.message);
    return null;
  }

  const amountOut = real.amountOut ?? real[0];
  const refAmountOut = ref.amountOut ?? ref[0];

  if (refAmountOut.isZero()) {
    console.warn(`[PriceImpact] ${pool.pair} excluded - reference quote returned zero output (no usable liquidity at this fee tier)`);
    return null;
  }

  // What 10 units "should" produce at the tiny-trade (~zero-impact) rate.
  const idealOut = refAmountOut.mul(amountIn).div(refAmountIn);
  if (idealOut.isZero()) {
    console.warn(`[PriceImpact] ${pool.pair} excluded - computed zero-impact reference output was zero`);
    return null;
  }

  const diff = idealOut.sub(amountOut);
  const impactPct = Math.abs(diff.mul(1000000).div(idealOut).toNumber() / 10000);

  console.debug(
    `[PriceImpact] pool=${pool.pair} inputToken=${pool.tokenA} input=${PRICE_IMPACT_INPUT_UNITS} ${pool.tokenA} ` +
      `quotedOutput=${ethers.utils.formatUnits(amountOut, decimalsOut)} ${pool.tokenB} ` +
      `referenceSpotOutput=${ethers.utils.formatUnits(idealOut, decimalsOut)} ${pool.tokenB} ` +
      `priceImpactPct=${impactPct.toFixed(4)}%`
  );

  return impactPct;
}

async function fetchAvgPriceImpact(provider) {
  const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
  const results = [];

  for (let i = 0; i < analyticsConfig.pools.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = analyticsConfig.pools.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const batchResults = await Promise.all(batch.map((pool) => quotePoolPriceImpact(quoter, pool)));
    results.push(...batchResults);
  }

  const valid = results.filter((r) => r !== null);
  if (valid.length === 0) {
    console.debug("[PriceImpact] no pool could be quoted - avgPriceImpact = null (not fabricated)");
    return null;
  }

  const avg = valid.reduce((sum, v) => sum + v, 0) / valid.length;
  console.debug(`[PriceImpact] final average = ${avg.toFixed(4)}% across ${valid.length}/${analyticsConfig.pools.length} quotable pools`);
  return avg;
}

function buildPoolMeta() {
  const meta = {};
  for (const p of analyticsConfig.pools) {
    const addrA = tickerToAddress(p.tokenA);
    const addrB = tickerToAddress(p.tokenB);
    const aIsToken0 = addrA.toLowerCase() < addrB.toLowerCase();
    const ticker0 = aIsToken0 ? p.tokenA : p.tokenB;
    const ticker1 = aIsToken0 ? p.tokenB : p.tokenA;
    meta[p.address.toLowerCase()] = {
      pool: p,
      ticker0,
      ticker1,
      decimals0: decimalsOf(ticker0),
      decimals1: decimalsOf(ticker1),
    };
  }
  return meta;
}

// Scans all 10 configured Nexora pools for Swap history ONLY. Fully
// independent of the Mint scan below - different topic, its own
// scanLogsIncremental call, its own React state slice in the hook - so
// Total Swaps/24H Volume/swap-based Active Wallets can render the instant
// this one resolves instead of waiting on Mint or Faucet too.
async function fetchSwapStats(provider, pricesUsd, onProgress, previous) {
  const poolAddresses = analyticsConfig.pools.map((p) => p.address);
  const iface = new ethers.utils.Interface(POOL_ABI);
  const swapTopic = iface.getEventTopic("Swap");
  const poolMeta = buildPoolMeta();

  const latestBlock = await provider.getBlockNumber();
  const latestBlockData = await provider.getBlock(latestBlock).catch(() => null);
  const nowTimestamp = latestBlockData ? latestBlockData.timestamp : Math.floor(Date.now() / 1000);
  const cutoff24h = nowTimestamp - 86400;

  const swapResult = await scanOrRetry(
    provider,
    poolAddresses,
    [swapTopic],
    analyticsConfig.scanFromBlock,
    latestBlock,
    onProgress,
    "swap",
    previous
  );

  const perTokenSwaps = Object.fromEntries(analyticsConfig.tokens.map((t) => [t.ticker, 0]));
  const seenSwapKeys = new Set();
  const uniqueSwapWallets = new Set();
  let totalSwaps = 0;
  let totalVolumeUsd = 0;
  let volume24hUsd = 0;
  let swaps24hCount = 0;
  let hasUnpricedSwap = false;

  for (const log of swapResult.logs) {
    const logIdx = log.logIndex !== undefined ? log.logIndex : log.index;
    const logKey = `${log.transactionHash.toLowerCase()}-${logIdx}`;
    if (seenSwapKeys.has(logKey)) continue;
    seenSwapKeys.add(logKey);

    const meta = poolMeta[log.address.toLowerCase()];
    if (!meta) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }

    totalSwaps += 1;
    if (parsed.args.sender) uniqueSwapWallets.add(parsed.args.sender.toLowerCase());
    if (parsed.args.recipient) uniqueSwapWallets.add(parsed.args.recipient.toLowerCase());

    if (perTokenSwaps[meta.pool.tokenA] !== undefined) perTokenSwaps[meta.pool.tokenA] += 1;
    if (perTokenSwaps[meta.pool.tokenB] !== undefined) perTokenSwaps[meta.pool.tokenB] += 1;

    const amount0 = Number(ethers.utils.formatUnits(parsed.args.amount0.abs(), meta.decimals0));
    const amount1 = Number(ethers.utils.formatUnits(parsed.args.amount1.abs(), meta.decimals1));
    const amount0IsPositive = !parsed.args.amount0.isNegative();

    const price0 = pricesUsd?.[meta.ticker0] ?? null;
    const price1 = pricesUsd?.[meta.ticker1] ?? null;

    let tradeUsd = 0;
    if (amount0IsPositive && price0 !== null) {
      tradeUsd = amount0 * price0;
    } else if (!amount0IsPositive && price1 !== null) {
      tradeUsd = amount1 * price1;
    } else {
      // The input-side token's price wasn't available (e.g. the fast
      // price fetch that ran alongside this scan hadn't succeeded yet) -
      // this swap's USD value is genuinely unknown, not zero.
      hasUnpricedSwap = true;
    }

    totalVolumeUsd += tradeUsd;

    const approxLogTimestamp = nowTimestamp - (latestBlock - log.blockNumber) * 12;
    if (approxLogTimestamp >= cutoff24h) {
      swaps24hCount += 1;
      volume24hUsd += tradeUsd;
    }
  }

  // A swap that genuinely couldn't be priced (input-token price missing at
  // scan time) must show as unknown ("-"), not be silently folded into a
  // real $0 - the old `totalVolumeUsd > 0 ? ... : null` check couldn't
  // tell "no priced volume happened" apart from "volume happened but
  // couldn't be priced", so it nulled out both, and separately, would have
  // nulled out a genuinely-verified $0 too.
  const finalTotalVolumeUsd = hasUnpricedSwap && totalVolumeUsd === 0 ? null : totalVolumeUsd;
  console.debug(`[Activity] swap totalVolumeUsd = ${finalTotalVolumeUsd} (raw sum=${totalVolumeUsd}, hasUnpricedSwap=${hasUnpricedSwap}, totalSwaps=${totalSwaps})`);

  return {
    totalSwaps,
    totalVolumeUsd: finalTotalVolumeUsd,
    volume24hUsd: swaps24hCount > 0 ? volume24hUsd : 0,
    swaps24hCount,
    perTokenSwaps,
    uniqueSwapWallets: Array.from(uniqueSwapWallets),
    uniqueActiveWalletsCount: uniqueSwapWallets.size,
    swapDataIncomplete: swapResult.anyFailed,
    scanStats: swapResult.scanStats,
    // Retained (not shown in the UI) so a later retry can re-query only
    // swapResult.failedRanges instead of rescanning the whole history.
    logs: swapResult.logs,
    failedRanges: swapResult.failedRanges,
  };
}

// Scans all 10 pools for Mint (liquidity-provider) history ONLY - fully
// independent of the Swap scan above. Doesn't need pricesUsd at all, since
// liquidity-provider counting has no USD math.
async function fetchMintStats(provider, onProgress, previous) {
  const poolAddresses = analyticsConfig.pools.map((p) => p.address);
  const iface = new ethers.utils.Interface(POOL_ABI);
  const mintTopic = iface.getEventTopic("Mint");

  const latestBlock = await provider.getBlockNumber();

  const mintResult = await scanOrRetry(
    provider,
    poolAddresses,
    [mintTopic],
    analyticsConfig.scanFromBlock,
    latestBlock,
    onProgress,
    "mint",
    previous
  );

  const uniqueProviders = new Set();
  for (const log of mintResult.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.args.owner) uniqueProviders.add(parsed.args.owner.toLowerCase());
      if (parsed.args.sender) uniqueProviders.add(parsed.args.sender.toLowerCase());
    } catch {
      // skip
    }
  }

  return {
    liquidityProviders: uniqueProviders.size,
    uniqueProviders: Array.from(uniqueProviders),
    mintDataIncomplete: mintResult.anyFailed,
    scanStats: mintResult.scanStats,
    logs: mintResult.logs,
    failedRanges: mintResult.failedRanges,
  };
}

async function fetchFaucetStats(provider, pricesUsd, onProgress, previous) {
  const iface = new ethers.utils.Interface(CLAIMED_ABI);
  const topic = iface.getEventTopic("Claimed");
  const latestBlock = await provider.getBlockNumber();
  const { logs, anyFailed, scanStats, failedRanges } = await scanOrRetry(
    provider,
    [analyticsConfig.faucetAddress],
    [topic],
    analyticsConfig.scanFromBlock,
    latestBlock,
    onProgress,
    "faucet",
    previous
  );

  const uniqueWallets = new Set();
  const perTokenClaims = Object.fromEntries(analyticsConfig.tokens.map((t) => [t.ticker, 0]));
  const perTokenClaimedAmounts = Object.fromEntries(analyticsConfig.tokens.map((t) => [t.ticker, 0]));
  let hasUnpricedClaim = false;
  let totalDistributedUsd = 0;

  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.args.user) uniqueWallets.add(parsed.args.user.toLowerCase());
      const token = analyticsConfig.tokens.find((t) => t.address.toLowerCase() === parsed.args.token.toLowerCase());
      if (token) {
        perTokenClaims[token.ticker] += 1;
        const amount = Number(ethers.utils.formatUnits(parsed.args.amount, token.decimals));
        perTokenClaimedAmounts[token.ticker] += amount;

        const price = pricesUsd?.[token.ticker] ?? null;
        if (price !== null) {
          totalDistributedUsd += amount * price;
        } else {
          hasUnpricedClaim = true;
        }
      }
    } catch {
      // skip
    }
  }

  const finalTotalDistributedUsd = hasUnpricedClaim && totalDistributedUsd === 0 ? null : totalDistributedUsd;
  console.debug(
    `[Activity] faucet totalDistributedUsd = ${finalTotalDistributedUsd} (raw sum=${totalDistributedUsd}, hasUnpricedClaim=${hasUnpricedClaim}, totalClaims=${logs.length}, perTokenClaimedAmounts=${JSON.stringify(perTokenClaimedAmounts)})`
  );

  return {
    totalClaims: logs.length,
    activeWallets: uniqueWallets.size,
    uniqueWallets: Array.from(uniqueWallets),
    perTokenClaims,
    perTokenClaimedAmounts,
    totalDistributedUsd: finalTotalDistributedUsd,
    dataIncomplete: anyFailed,
    scanStats,
    logs,
    failedRanges,
  };
}

// ---------------------------------------------------------------------
// Two independent, separately-cached load paths:
//
//  - "fast" = wallet-independent contract reads that only take a handful
//    of round trips (prices, token supply/balances, pool balances). Fast
//    enough that the page should never sit on a blank loading screen
//    waiting on these.
//  - "activity" = the full historical Swap/Mint/Claimed event scan across
//    all 10 pools. Genuinely slow on a rate-limited RPC and has no reason
//    to block the fast section from rendering - it loads in the
//    background and the UI updates Total Swaps/Active Wallets/24H Volume/
//    Activity Analytics once it resolves, independently of the fast
//    section's own state.
//
// Both are module-level (not per-hook-instance) caches with a shared
// in-flight promise, for the same reason as before: Overview and
// Insights/Analytics both mount this hook with the same RPC URL, and
// shouldn't each independently re-run the same scans seconds apart.
// ---------------------------------------------------------------------

const FAST_CACHE_TTL_MS = 20000;
const FAST_TIMEOUT_MS = 20000;
let fastCache = null; // { data: {pricesUsd, supply, pools, blockNumber}, networkOnline, fetchedAt }
let fastInFlight = null;

// Runs one fast-section RPC group without letting its failure propagate -
// each group is independently try/caught so prices/supply/pools can each
// succeed or fail on their own (see loadFastData below).
async function runTraced(label, fn) {
  try {
    const result = await fn();
    return { ok: true, value: result, error: null };
  } catch (err) {
    const code = err?.code || err?.error?.code || err?.status || err?.error?.status;
    console.warn(`[FastData] ${label} failed${code ? ` (code=${code})` : ""}:`, err?.message);
    return { ok: false, value: null, error: err };
  }
}

// Prices, supply, and pool balances are three independent RPC groups with
// no dependency on each other succeeding - fetchPoolBalances only *uses*
// pricesUsd for optional USD valuation math it already null-guards
// internally (see `priceA !== null && priceB !== null` there), so it
// doesn't need prices to have fully succeeded to run. Each group gets its
// own try/catch and NEVER throws out of this function - a failure in one
// only nulls out that one field, it can never take the other two down
// with it or blank the whole page.
async function loadFastData(rpcUrl) {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  const blockNumber = await withTimeout(provider.getBlockNumber(), CHUNK_TIMEOUT_MS, "getBlockNumber").catch(() => null);
  const networkOnline = blockNumber !== null;

  const pricesResult = await runTraced("fetchOnChainPrices", () =>
    withTimeout(fetchOnChainPrices(provider), FAST_TIMEOUT_MS, "fetchOnChainPrices")
  );
  // fetchPoolBalances' own USD math already treats a missing price as null
  // per-token, so a fully-failed price fetch still lets real on-chain
  // balances/liquidity show up - it just can't value them in USD.
  const pricesUsdForPools = pricesResult.ok ? pricesResult.value : {};

  // Own timeout budget, separate from FAST_TIMEOUT_MS - quoting 10 pools via
  // QuoterV2's callStatic (a real simulated swap per call) is meaningfully
  // slower than a plain eth_call, so it gets more room to finish without
  // that slowness leaking into how long Total Supply/TVL/etc. take to show.
  const PRICE_IMPACT_TIMEOUT_MS = 45000;

  const [supplyResult, poolsResult, priceImpactResult] = await Promise.all([
    runTraced("fetchSupplyAndBalances", () => withTimeout(fetchSupplyAndBalances(provider), FAST_TIMEOUT_MS, "fetchSupplyAndBalances")),
    runTraced("fetchPoolBalances", () => withTimeout(fetchPoolBalances(provider, pricesUsdForPools), FAST_TIMEOUT_MS, "fetchPoolBalances")),
    runTraced("fetchAvgPriceImpact", () => withTimeout(fetchAvgPriceImpact(provider), PRICE_IMPACT_TIMEOUT_MS, "fetchAvgPriceImpact")),
  ]);

  return {
    data: {
      pricesUsd: pricesResult.ok ? pricesResult.value : null,
      supply: supplyResult.ok ? supplyResult.value : null,
      pools: poolsResult.ok ? poolsResult.value : null,
      avgPriceImpact: priceImpactResult.ok ? priceImpactResult.value : null,
      blockNumber,
    },
    fastErrors: {
      pricesUsd: pricesResult.ok ? null : pricesResult.error?.message || "unknown error",
      supply: supplyResult.ok ? null : supplyResult.error?.message || "unknown error",
      pools: poolsResult.ok ? null : poolsResult.error?.message || "unknown error",
      avgPriceImpact: priceImpactResult.ok ? null : priceImpactResult.error?.message || "unknown error",
    },
    networkOnline,
  };
}

function getFastData(rpcUrl, force) {
  if (!force && fastCache && Date.now() - fastCache.fetchedAt < FAST_CACHE_TTL_MS) {
    return Promise.resolve(fastCache);
  }
  if (fastInFlight) return fastInFlight;

  fastInFlight = loadFastData(rpcUrl)
    .then((r) => {
      fastCache = { ...r, fetchedAt: Date.now() };
      return fastCache;
    })
    .finally(() => {
      fastInFlight = null;
    });

  return fastInFlight;
}

const ACTIVITY_CACHE_TTL_MS = 20000;

// Swap, Mint, and Faucet each get their own module-level cache + in-flight
// promise - fully independent of one another, not bundled into one
// "activity" blob. This is what actually lets Total Swaps render the
// moment the Swap scan finishes without waiting on Mint or Faucet, and
// still means revisiting Overview/Insights within the TTL window reuses
// whichever of the three already finished instead of re-scanning it.
// `loadFn` receives the last cached result (even if it's aged out of the
// TTL window) as its argument, specifically so a caller can check whether
// that previous attempt left any failedRanges behind and, if so, retry only
// those instead of doing a fresh full scan.
function makeCachedLoader(ttlMs) {
  let cache = null;
  let inFlight = null;
  return function getData(loadFn, force) {
    if (!force && cache && Date.now() - cache.fetchedAt < ttlMs) {
      return Promise.resolve(cache);
    }
    if (inFlight) return inFlight;
    inFlight = loadFn(cache ? cache.data : null)
      .then((data) => {
        cache = { data, fetchedAt: Date.now() };
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

const getSwapData = makeCachedLoader(ACTIVITY_CACHE_TTL_MS);
const getMintData = makeCachedLoader(ACTIVITY_CACHE_TTL_MS);
const getFaucetData = makeCachedLoader(ACTIVITY_CACHE_TTL_MS);

export function useAnalytics(rpcUrl) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fastErrors, setFastErrors] = useState(null);
  const [networkOnline, setNetworkOnline] = useState(null);

  const [swapStats, setSwapStats] = useState(null);
  const [swapLoading, setSwapLoading] = useState(true);
  const [swapError, setSwapError] = useState(false);

  const [mintStats, setMintStats] = useState(null);
  const [mintLoading, setMintLoading] = useState(true);
  const [mintError, setMintError] = useState(false);

  const [faucetStats, setFaucetStats] = useState(null);
  const [faucetLoading, setFaucetLoading] = useState(true);
  const [faucetError, setFaucetError] = useState(false);

  const [activityProgress, setActivityProgress] = useState(null);

  const fastInFlightRef = useRef(false);
  const swapInFlightRef = useRef(false);
  const mintInFlightRef = useRef(false);
  const faucetInFlightRef = useRef(false);

  const loadFast = useCallback(
    async (opts = {}) => {
      if (fastInFlightRef.current) return null;
      fastInFlightRef.current = true;
      setLoading(true);
      setError(false);
      try {
        const cached = await getFastData(rpcUrl, opts.force === true);
        setNetworkOnline(cached.networkOnline);
        setData(cached.data);
        setFastErrors(cached.fastErrors);
        return cached.data;
      } catch (err) {
        console.error("Fast analytics load failed:", err);
        setError(true);
        return null;
      } finally {
        setLoading(false);
        fastInFlightRef.current = false;
      }
    },
    [rpcUrl]
  );

  const loadSwap = useCallback(
    async (pricesUsd, opts = {}) => {
      if (swapInFlightRef.current) return;
      swapInFlightRef.current = true;
      setSwapLoading(true);
      setSwapError(false);
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const cached = await getSwapData(
          (previous) => fetchSwapStats(provider, pricesUsd, (p) => setActivityProgress(p), previous),
          opts.force === true
        );
        console.debug("[Activity] eventStats state updated (swap section):", cached.data);
        setSwapStats(cached.data);
      } catch (err) {
        console.error("[Activity] swap scan failed:", err);
        setSwapError(true);
      } finally {
        setSwapLoading(false);
        swapInFlightRef.current = false;
      }
    },
    [rpcUrl]
  );

  const loadMint = useCallback(
    async (opts = {}) => {
      if (mintInFlightRef.current) return;
      mintInFlightRef.current = true;
      setMintLoading(true);
      setMintError(false);
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const cached = await getMintData(
          (previous) => fetchMintStats(provider, (p) => setActivityProgress(p), previous),
          opts.force === true
        );
        console.debug("[Activity] eventStats state updated (mint section):", cached.data);
        setMintStats(cached.data);
      } catch (err) {
        console.error("[Activity] mint scan failed:", err);
        setMintError(true);
      } finally {
        setMintLoading(false);
        mintInFlightRef.current = false;
      }
    },
    [rpcUrl]
  );

  const loadFaucet = useCallback(
    async (pricesUsd, opts = {}) => {
      if (faucetInFlightRef.current) return;
      faucetInFlightRef.current = true;
      setFaucetLoading(true);
      setFaucetError(false);
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const cached = await getFaucetData(
          (previous) => fetchFaucetStats(provider, pricesUsd, (p) => setActivityProgress(p), previous),
          opts.force === true
        );
        console.debug("[Activity] faucetStats state updated:", cached.data);
        setFaucetStats(cached.data);
      } catch (err) {
        console.error("[Activity] faucet scan failed:", err);
        setFaucetError(true);
      } finally {
        setFaucetLoading(false);
        faucetInFlightRef.current = false;
      }
    },
    [rpcUrl]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fast section renders as soon as it resolves. Swap/Mint/Faucet are
      // then fired together but are NOT awaited as a group - each is its
      // own independent async call with its own state, so whichever
      // finishes first updates its own cards immediately while the other
      // two keep scanning in the background. A fast-section failure still
      // lets all three attempt to run (with an empty price map for Swap,
      // if that's genuinely all that's available).
      const fast = await loadFast();
      if (cancelled) return;
      const pricesUsd = fast?.pricesUsd || {};
      loadSwap(pricesUsd);
      loadMint();
      loadFaucet(pricesUsd);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFast, loadSwap, loadMint, loadFaucet]);

  // The Refresh button has to bypass every cache - "Refresh" that could
  // just hand back a stale result silently would be a real, confusing bug.
  const refresh = useCallback(async () => {
    const fast = await loadFast({ force: true });
    const pricesUsd = fast?.pricesUsd || {};
    loadSwap(pricesUsd, { force: true });
    loadMint({ force: true });
    loadFaucet(pricesUsd, { force: true });
  }, [loadFast, loadSwap, loadMint, loadFaucet]);

  // Backward-compatible merged views for anything that still wants a single
  // combined object - each field is only populated once its own underlying
  // section has actually resolved, so consumers reading the granular
  // swapStats/mintStats/faucetStats + swapLoading/mintLoading/faucetLoading
  // below directly is what gives genuinely progressive rendering; this
  // merge exists for the pieces (e.g. "Total Transactions", "Data
  // Completeness") that legitimately do need all three.
  const eventStats =
    swapStats || mintStats
      ? {
          ...(swapStats || {}),
          ...(mintStats || {}),
          dataIncomplete: Boolean(swapStats?.swapDataIncomplete || mintStats?.mintDataIncomplete),
        }
      : null;
  const activityLoading = swapLoading || mintLoading || faucetLoading;
  const activityError = swapError && mintError && faucetError;

  return {
    data,
    loading,
    error,
    fastErrors,
    networkOnline,
    swapStats,
    swapLoading,
    swapError,
    mintStats,
    mintLoading,
    mintError,
    faucetStats,
    faucetLoading,
    faucetError,
    eventStats,
    activityLoading,
    activityError,
    activityProgress,
    refresh,
  };
}
