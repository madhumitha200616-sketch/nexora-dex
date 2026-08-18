import React, { useState, useEffect } from 'react'
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { ArrowRightOutlined, CheckCircleFilled } from "@ant-design/icons";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import EmptyState from "./ui/EmptyState";
import ThreeDBackground from "./ui/ThreeDBackground";
import "./Tokens.css";

// Only tokens that actually have a Sepolia testnet contract are relevant -
// those are the only ones this app can ever swap, so they're the only ones
// worth scanning transfer history for.
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

const TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Previously a fixed 20,000-block lookback ("~2-3 days") - but this protocol
// was seeded well before that window on a long-lived testnet, so a real,
// already-confirmed swap can simply age out of a fixed recent-blocks lookback
// as more blocks are mined, with nothing wrong in the query logic itself.
// analyticsConfig.scanFromBlock is the actual real anchor Insights/Analytics
// already uses for "full history" (read-only import here, nothing in
// Analytics/Insights is touched) - reusing it means this page's "recent
// transactions" genuinely covers the protocol's whole real history instead
// of an arbitrary, silently-shrinking recent window.
const HISTORY_FROM_BLOCK = analyticsConfig.scanFromBlock;

// RPC providers (Infura included) cap how many blocks a single eth_getLogs
// call can cover - asking for the full history range in one request
// gets rejected outright ("query range too large" / "more than 10000
// results"). Splitting into smaller chunks avoids that.
//
// The chunks (and the sent/received directions, and the two tokens) are all
// independent read-only requests, so they're fired concurrently with
// Promise.all instead of one at a time - a JsonRpcProvider handles a handful
// of parallel eth_getLogs calls without issue, and this is what actually cut
// the "transaction history takes forever" delay down from ~16 sequential
// round-trips to the time of the single slowest one.
const CHUNK_SIZE = 5000;

// Adding LINK brought the token count from 2 to 3, which pushed this from
// 16 parallel eth_getLogs calls to 24 (3 tokens x 2 directions x 4 chunks).
// A free-tier RPC endpoint can silently stall on a burst that size instead
// of returning an error - and since nothing here had a timeout, one stuck
// request meant the whole Promise.all (and therefore the page) just hung on
// "Loading..." forever. This wraps any single request so it fails loudly
// after REQUEST_TIMEOUT_MS instead of hanging, which lets the page show a
// real error and a Refresh option rather than spinning indefinitely.
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Used to decode raw Transfer logs out of a transaction receipt (see below) -
// same event shape as TRANSFER_ABI, just wrapped as an Interface so it can
// parse logs that weren't fetched through a specific contract's queryFilter.
const transferInterface = new ethers.utils.Interface(TRANSFER_ABI);

// Retries one chunk with backoff instead of giving up on the first failure -
// a wider history range means more chunks, which means more surface area
// for a single RPC hiccup. Returns [] (never throws) if a chunk genuinely
// can't be read after all retries, logging which range was lost so it's
// visible rather than silently dropped, but critically WITHOUT rejecting
// the Promise.all the caller runs this inside - one bad chunk must not
// discard every other chunk that already succeeded.
async function queryRangeWithRetry(contract, filter, from, to) {
  let delay = BASE_BACKOFF_MS;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(contract.queryFilter(filter, from, to), REQUEST_TIMEOUT_MS, "eth_getLogs");
    } catch (err) {
      if (attempt === MAX_RETRY_ATTEMPTS - 1) {
        console.warn(`[History] chunk ${from}-${to} on ${contract.address} failed after ${MAX_RETRY_ATTEMPTS} attempts:`, err.message);
        return [];
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  return [];
}

async function queryFilterChunked(contract, filter, fromBlock, toBlock) {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    ranges.push([start, Math.min(start + CHUNK_SIZE - 1, toBlock)]);
  }
  const chunkResults = await Promise.all(
    ranges.map(([start, end]) => queryRangeWithRetry(contract, filter, start, end))
  );
  return chunkResults.flat();
}

// Sepolia mines a block roughly every 12s. Getting an exact timestamp per
// row would mean an extra provider.getBlock() call per unique block (dozens
// of additional RPC round-trips just for a "X mins ago" label) - instead
// this estimates age directly from how many blocks back the transfer
// happened, using the latest block already fetched in fetchHistory. Close
// enough for a relative-time label, no extra network calls.
const SEPOLIA_BLOCK_SECONDS = 12;

function formatRelativeTime(blockNumber, latestBlock) {
  if (latestBlock == null) return "";
  const secondsAgo = Math.max(0, latestBlock - blockNumber) * SEPOLIA_BLOCK_SECONDS;
  if (secondsAgo < 60) return "just now";
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo} min${minutesAgo === 1 ? "" : "s"} ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo} hour${hoursAgo === 1 ? "" : "s"} ago`;
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
}

function Tokens({ isConnected, address }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [latestBlock, setLatestBlock] = useState(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setRows([]);
      return;
    }
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  async function fetchHistory() {
    setLoading(true);
    setError(null);
    try {
      console.debug(`[History] RPC endpoint = ${process.env.REACT_APP_INFURA_URL}`);
      console.debug(`[History] connected wallet = ${address}`);

      const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
      const latestBlock = await withTimeout(provider.getBlockNumber(), REQUEST_TIMEOUT_MS, "getBlockNumber");
      setLatestBlock(latestBlock);
      const fromBlock = Math.max(0, HISTORY_FROM_BLOCK);

      console.debug(`[History] latest block = ${latestBlock}`);
      console.debug(`[History] from block = ${fromBlock} (${latestBlock - fromBlock} blocks of history scanned)`);

      // Pull every USDC/WETH Transfer event where this wallet is either the
      // sender or the receiver. Filtered by wallet address at the RPC topic
      // level (contract.filters.Transfer(address, null) / (null, address)
      // encode the wallet directly into the indexed-topic filter, so the
      // node does the filtering, not this code after the fact) - chunked to
      // stay under the RPC provider's per-request block-range limit, and
      // every token/direction/chunk runs concurrently (not one after
      // another) to keep this fast.
      const perTokenResults = await Promise.all(
        SEPOLIA_TOKENS.map(async (token) => {
          const contract = new ethers.Contract(token.sepoliaAddress, TRANSFER_ABI, provider);
          const [sent, received] = await Promise.all([
            queryFilterChunked(contract, contract.filters.Transfer(address, null), fromBlock, latestBlock),
            queryFilterChunked(contract, contract.filters.Transfer(null, address), fromBlock, latestBlock),
          ]);
          return [...sent, ...received].map((ev) => ({
            txHash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            logIndex: ev.logIndex,
            token,
            from: ev.args.from,
            to: ev.args.to,
            value: ev.args.value,
          }));
        })
      );

      // Dedupe by transactionHash + logIndex - the sent/received filters are
      // mutually exclusive for a normal transfer, but this guards against
      // any edge case (e.g. a self-transfer matching both) double-counting
      // the same on-chain log.
      const seenLogKeys = new Set();
      const transfers = [];
      for (const t of perTokenResults.flat()) {
        const key = `${t.txHash.toLowerCase()}-${t.logIndex}`;
        if (seenLogKeys.has(key)) continue;
        seenLogKeys.add(key);
        transfers.push(t);
      }
      console.debug(`[History] Transfer logs found = ${transfers.length}`);
      console.debug(`[History] matching wallet logs (post wallet-topic filter, deduped) = ${transfers.length}`);

      // A swap shows up as exactly one outgoing transfer (tokenIn, from you)
      // and one incoming transfer (tokenOut, to you) inside the same
      // transaction. Group by tx hash and pair those up.
      const byTx = {};
      for (const t of transfers) {
        if (!byTx[t.txHash]) byTx[t.txHash] = [];
        byTx[t.txHash].push(t);
      }

      // The "incoming" leg above only exists in `transfers` when it was sent
      // TO the connected wallet - but the Swap page lets you send output to
      // a different recipient address, and in that case its Transfer event
      // was never fetched at all (the received-events query only asked for
      // transfers TO the connected address). Those swaps would otherwise
      // silently vanish from the list. For any tx where we know we PAID
      // (outT exists) but can't find the matching incoming leg, pull that
      // one transaction's receipt and read its logs directly to recover the
      // real output leg, whoever it was sent to.
      const missingInLegTxHashes = Object.entries(byTx)
        .filter(([, group]) => {
          const outT = group.find((t) => t.from.toLowerCase() === address.toLowerCase());
          const inT = group.find((t) => t.to.toLowerCase() === address.toLowerCase() && t !== outT);
          return outT && !inT;
        })
        .map(([txHash]) => txHash);

      const resolvedInLegs = {};
      if (missingInLegTxHashes.length > 0) {
        const receipts = await Promise.all(
          missingInLegTxHashes.map((txHash) =>
            withTimeout(provider.getTransactionReceipt(txHash), REQUEST_TIMEOUT_MS, "getTransactionReceipt").catch(
              () => null
            )
          )
        );
        missingInLegTxHashes.forEach((txHash, i) => {
          const receipt = receipts[i];
          if (!receipt) return;
          const outT = byTx[txHash].find((t) => t.from.toLowerCase() === address.toLowerCase());
          for (const log of receipt.logs) {
            const token = SEPOLIA_TOKENS.find((t) => t.sepoliaAddress.toLowerCase() === log.address.toLowerCase());
            if (!token || token.sepoliaAddress.toLowerCase() === outT.token.sepoliaAddress.toLowerCase()) continue;
            try {
              const parsed = transferInterface.parseLog(log);
              resolvedInLegs[txHash] = { token, to: parsed.args.to, value: parsed.args.value };
              break;
            } catch {
              // Not a Transfer-shaped log (could be an Approval or another
              // event on the same contract) - keep scanning this receipt.
            }
          }
        });
      }

      const swapRows = [];
      for (const [txHash, group] of Object.entries(byTx)) {
        const outT = group.find((t) => t.from.toLowerCase() === address.toLowerCase());
        const inT =
          group.find((t) => t.to.toLowerCase() === address.toLowerCase() && t !== outT) ||
          resolvedInLegs[txHash];
        if (outT && inT) {
          const customRecipient = inT.to.toLowerCase() !== address.toLowerCase();
          swapRows.push({
            txHash,
            blockNumber: outT.blockNumber,
            tokenIn: outT.token,
            amountIn: ethers.utils.formatUnits(outT.value, outT.token.decimals),
            tokenOut: inT.token,
            amountOut: ethers.utils.formatUnits(inT.value, inT.token.decimals),
            recipient: customRecipient ? inT.to : null,
          });
        }
      }

      swapRows.sort((a, b) => b.blockNumber - a.blockNumber);
      console.debug(`[History] reconstructed swaps = ${swapRows.length}`);
      console.debug(`[History] final displayed swaps = ${swapRows.length}`);
      setRows(swapRows);
    } catch (err) {
      console.error("Failed to load swap history:", err);
      const reason = err.reason || err.error?.message || err.message || "Unknown error";
      setError(`Couldn't load your swap history (${reason}).`);
    } finally {
      setLoading(false);
    }
  }

  if (!isConnected) {
    return (
      <PageShell
        eyebrow="Activity"
        title="Recent Transactions"
        subtitle="Every swap you've made on Nexora, reconstructed live from on-chain Transfer events."
        background={<ThreeDBackground intensity={2} />}
      >
        <EmptyState
          icon="👛"
          title="Wallet not connected"
          description="Connect your wallet from the navbar to see your swap history."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Activity"
      title="Recent Transactions"
      subtitle="Every swap you've made on Nexora, reconstructed live from on-chain Transfer events."
      background={<ThreeDBackground intensity={2} />}
    >
      <div className="nx-tx-toolbar">
        <span className="nx-tx-count">
          {!loading && !error
            ? `${rows.length} swap${rows.length === 1 ? "" : "s"} · full history since block ${HISTORY_FROM_BLOCK.toLocaleString()}`
            : " "}
        </span>
        <button className="nx-btn nx-btn-secondary nx-btn-sm" onClick={fetchHistory} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <EmptyState
          icon="⏳"
          title="Loading swap history"
          description="Scanning on-chain Transfer events across the protocol's full history."
        />
      )}

      {!loading && error && (
        <EmptyState
          icon="⚠"
          title="Couldn't load activity"
          description={error}
          action={
            <button className="nx-btn nx-btn-secondary nx-btn-sm" onClick={fetchHistory}>
              Try again
            </button>
          }
        />
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon="📭"
          title="No swaps yet"
          description={`No swaps found since block ${HISTORY_FROM_BLOCK.toLocaleString()} (the protocol's full history). Make a swap to see it appear here.`}
          action={
            <Link to="/swap" className="nx-btn nx-btn-primary nx-btn-sm">
              Go to Swap
            </Link>
          }
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="nx-tx-list">
          {rows.map((row) => (
            <GlassCard key={row.txHash} hoverable tilt pad="sm" className="nx-tx-row">
              <div className="nx-tx-icons">
                <TokenIcon symbol={row.tokenIn.ticker} src={row.tokenIn.img} size={30} />
                <TokenIcon symbol={row.tokenOut.ticker} src={row.tokenOut.img} size={30} style={{ marginLeft: -10 }} />
              </div>

              <div className="nx-tx-info">
                <div className="nx-tx-pair">
                  <Link to={`/explorer/${row.tokenIn.ticker}`} className="nx-tx-pair-link">
                    {row.tokenIn.ticker}
                  </Link>
                  <ArrowRightOutlined className="nx-tx-arrow" />
                  <Link to={`/explorer/${row.tokenOut.ticker}`} className="nx-tx-pair-link">
                    {row.tokenOut.ticker}
                  </Link>
                </div>
                <div className="nx-tx-amounts">
                  {Number(row.amountIn).toFixed(6)} {row.tokenIn.ticker} → {Number(row.amountOut).toFixed(6)} {row.tokenOut.ticker}
                </div>
                {row.recipient && (
                  <div className="nx-tx-recipient">
                    Sent to {row.recipient.slice(0, 6)}...{row.recipient.slice(-4)}
                  </div>
                )}
              </div>

              <div className="nx-tx-meta">
                <span className="nx-tx-status">
                  <CheckCircleFilled /> Completed
                </span>
                <span className="nx-tx-time">{formatRelativeTime(row.blockNumber, latestBlock)}</span>
              </div>

              <a
                className="nx-btn nx-btn-secondary nx-btn-sm nx-tx-view"
                href={`https://sepolia.etherscan.io/tx/${row.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View
              </a>
            </GlassCard>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default Tokens
