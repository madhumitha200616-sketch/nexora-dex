import React, { useEffect, useState } from 'react'
import { Input, message } from "antd";
import { ethers } from "ethers";
import tokenList from "../tokenList.json";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";

// Only tokens with a real Sepolia contract can actually be pooled here -
// same filter used everywhere else in the app (Swap, Wallet, Markets).
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);
const WETH = SEPOLIA_TOKENS.find((t) => t.ticker === "WETH");
const USDC = SEPOLIA_TOKENS.find((t) => t.ticker === "USDC");
const LINK = SEPOLIA_TOKENS.find((t) => t.ticker === "LINK");

// The two pairs this app actually swaps (see Swap.js) - letting anyone add
// liquidity to these SAME pools is what deepens them for everyone, instead
// of one person alone trying to move the needle with faucet-limited tokens.
const PAIRS = [WETH && USDC ? { tokenA: WETH, tokenB: USDC, label: "WETH / USDC" } : null,
               LINK && USDC ? { tokenA: LINK, tokenB: USDC, label: "LINK / USDC" } : null]
  .filter(Boolean);

const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];
const FEE_TIERS = [500, 3000, 10000, 100];

// Uniswap V3 tick spacing is fixed per fee tier - required to compute valid
// tickLower/tickUpper (they must be exact multiples of this).
const TICK_SPACING = { 500: 10, 3000: 60, 10000: 200, 100: 1 };
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// Uniswap V3 NonfungiblePositionManager on Sepolia - the contract that
// actually mints/holds liquidity positions (as an NFT). Different address
// from mainnet, same pattern as QUOTER_ADDRESS/ROUTER_ADDRESS in Swap.js.
const POSITION_MANAGER_ADDRESS = "0x1238536071e1c677a632429e3655c799b22cda52";
const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)"
];

const TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Same lookback/chunking/timeout pattern as Tokens.js's transaction history -
// a liquidity deposit is just a Transfer of tokenA and tokenB INTO the pool
// contract's own address, so it can be found the exact same way a swap can.
const BLOCK_LOOKBACK = 20000;
const CHUNK_SIZE = 5000;
const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

async function queryFilterChunked(contract, filter, fromBlock, toBlock) {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    ranges.push([start, Math.min(start + CHUNK_SIZE - 1, toBlock)]);
  }
  const chunkResults = await Promise.all(
    ranges.map(([start, end]) =>
      withTimeout(contract.queryFilter(filter, start, end), REQUEST_TIMEOUT_MS, "eth_getLogs")
    )
  );
  return chunkResults.flat();
}

const POOL_LIQUIDITY_ABI = ["function liquidity() external view returns (uint128)"];

// Matches Swap.js's detectPool exactly: a fee tier only counts if a pool
// contract actually exists there AND it already has some liquidity in it.
// Without the liquidity check, this could return a real-but-empty pool at
// an earlier fee tier while Swap.js's quotes are running against a
// DIFFERENT (later) fee tier that actually has depth - meaning liquidity
// added here would go into a pool nobody's swap history ever touches.
async function findPoolFee(provider, tokenA, tokenB) {
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  for (const fee of FEE_TIERS) {
    const pool = await factory.getPool(tokenA, tokenB, fee);
    if (pool && pool !== ethers.constants.AddressZero) {
      const poolContract = new ethers.Contract(pool, POOL_LIQUIDITY_ABI, provider);
      const liquidity = await poolContract.liquidity();
      if (!liquidity.eq(0)) {
        return { fee, poolAddress: pool };
      }
      // Exists but empty - same as Swap.js, don't fall through to the next
      // tier automatically, since that could silently pick a pool the rest
      // of the app was never actually using either.
      return null;
    }
  }
  return null;
}

function fullRangeTicks(fee) {
  const spacing = TICK_SPACING[fee];
  const tickLower = Math.ceil(MIN_TICK / spacing) * spacing;
  const tickUpper = Math.floor(MAX_TICK / spacing) * spacing;
  return { tickLower, tickUpper };
}

function Pool({ isConnected, address }) {
  const [pairIndex, setPairIndex] = useState(0);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [balanceA, setBalanceA] = useState(null);
  const [balanceB, setBalanceB] = useState(null);
  const [fee, setFee] = useState(null);
  const [poolAddress, setPoolAddress] = useState(null);
  const [contributors, setContributors] = useState([]);
  const [isLoadingContributors, setIsLoadingContributors] = useState(false);
  const [contributorsError, setContributorsError] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  // Bumped after a successful addLiquidity() so the contributors effect
  // below (keyed on [poolAddress, pair, contributorsRefresh]) re-scans and
  // picks up the deposit that was just made, without needing poolAddress
  // itself to actually change.
  const [contributorsRefresh, setContributorsRefresh] = useState(0);

  const pair = PAIRS[pairIndex];

  useEffect(() => {
    setFee(null);
    setPoolAddress(null);
    setContributors([]);
    setContributorsError(null);
    if (!pair) return;
    let cancelled = false;
    (async () => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const detected = await findPoolFee(provider, pair.tokenA.sepoliaAddress, pair.tokenB.sepoliaAddress);
        if (cancelled) return;
        if (detected) {
          setFee(detected.fee);
          setPoolAddress(detected.poolAddress);
        }
      } catch (err) {
        console.error("Pool fee detection failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [pairIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Who's actually put tokens into this pool" - scans for Transfer events
  // of tokenA/tokenB INTO the pool contract's own address. Adding liquidity
  // always moves tokens there (via the position manager's transferFrom), so
  // this catches every deposit regardless of who made it or which app they
  // used - not just ones made through this page.
  useEffect(() => {
    if (!poolAddress || !pair) return;
    let cancelled = false;
    setIsLoadingContributors(true);
    setContributorsError(null);
    (async () => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const latestBlock = await withTimeout(provider.getBlockNumber(), REQUEST_TIMEOUT_MS, "getBlockNumber");
        const fromBlock = Math.max(0, latestBlock - BLOCK_LOOKBACK);

        const contractA = new ethers.Contract(pair.tokenA.sepoliaAddress, TRANSFER_ABI, provider);
        const contractB = new ethers.Contract(pair.tokenB.sepoliaAddress, TRANSFER_ABI, provider);

        const [depositsA, depositsB] = await Promise.all([
          queryFilterChunked(contractA, contractA.filters.Transfer(null, poolAddress), fromBlock, latestBlock),
          queryFilterChunked(contractB, contractB.filters.Transfer(null, poolAddress), fromBlock, latestBlock),
        ]);
        if (cancelled) return;

        const rows = [
          ...depositsA.map((log) => ({
            address: log.args.from,
            amount: ethers.utils.formatUnits(log.args.value, pair.tokenA.decimals),
            ticker: pair.tokenA.ticker,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          })),
          ...depositsB.map((log) => ({
            address: log.args.from,
            amount: ethers.utils.formatUnits(log.args.value, pair.tokenB.decimals),
            ticker: pair.tokenB.ticker,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          })),
        ].sort((a, b) => b.blockNumber - a.blockNumber);

        setContributors(rows);
      } catch (err) {
        console.error("Failed to load pool contributors:", err);
        if (!cancelled) setContributorsError(err.message || "Couldn't load contributors.");
      } finally {
        if (!cancelled) setIsLoadingContributors(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poolAddress, pair, contributorsRefresh]);

  useEffect(() => {
    if (!isConnected || !address || !pair) {
      setBalanceA(null);
      setBalanceB(null);
      return;
    }
    fetchBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, pairIndex]);

  async function fetchBalances() {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const tokenA = new ethers.Contract(pair.tokenA.sepoliaAddress, ERC20_ABI, provider);
      const tokenB = new ethers.Contract(pair.tokenB.sepoliaAddress, ERC20_ABI, provider);
      const [rawA, rawB] = await Promise.all([
        tokenA.balanceOf(address),
        tokenB.balanceOf(address),
      ]);
      setBalanceA(ethers.utils.formatUnits(rawA, pair.tokenA.decimals));
      setBalanceB(ethers.utils.formatUnits(rawB, pair.tokenB.decimals));
    } catch (err) {
      console.error("Balance fetch failed:", err);
    }
  }

  async function addLiquidity() {
    if (!isConnected) {
      message.error("Please connect your wallet first");
      return;
    }
    if (fee === null) {
      message.error("No live pool found for this pair on Sepolia testnet.");
      return;
    }
    if (!amountA || Number(amountA) <= 0 || !amountB || Number(amountB) <= 0) {
      message.error("Enter an amount for both tokens.");
      return;
    }

    setIsBusy(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();

      const amtA = ethers.utils.parseUnits(amountA, pair.tokenA.decimals);
      const amtB = ethers.utils.parseUnits(amountB, pair.tokenB.decimals);

      // Uniswap V3 requires token0 < token1 (sorted by address), and their
      // desired/min amounts have to line up with whichever token ends up
      // being token0 vs token1 - NOT necessarily tokenA/tokenB in the order
      // shown on screen.
      const aIsToken0 = pair.tokenA.sepoliaAddress.toLowerCase() < pair.tokenB.sepoliaAddress.toLowerCase();
      const token0 = aIsToken0 ? pair.tokenA : pair.tokenB;
      const token1 = aIsToken0 ? pair.tokenB : pair.tokenA;
      const amount0Desired = aIsToken0 ? amtA : amtB;
      const amount1Desired = aIsToken0 ? amtB : amtA;

      const tokenAContract = new ethers.Contract(pair.tokenA.sepoliaAddress, ERC20_ABI, signer);
      const tokenBContract = new ethers.Contract(pair.tokenB.sepoliaAddress, ERC20_ABI, signer);

      const [allowanceA, allowanceB] = await Promise.all([
        tokenAContract.allowance(address, POSITION_MANAGER_ADDRESS),
        tokenBContract.allowance(address, POSITION_MANAGER_ADDRESS),
      ]);

      if (allowanceA.lt(amtA)) {
        message.info(`Approve ${pair.tokenA.ticker} in MetaMask...`);
        const tx = await tokenAContract.approve(POSITION_MANAGER_ADDRESS, amtA);
        await tx.wait();
      }
      if (allowanceB.lt(amtB)) {
        message.info(`Approve ${pair.tokenB.ticker} in MetaMask...`);
        const tx = await tokenBContract.approve(POSITION_MANAGER_ADDRESS, amtB);
        await tx.wait();
      }

      const { tickLower, tickUpper } = fullRangeTicks(fee);
      const positionManager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 min

      message.info("Confirm in MetaMask to add liquidity...");
      const tx = await positionManager.mint({
        token0: token0.sepoliaAddress,
        token1: token1.sepoliaAddress,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        // Full-range positions accept whatever ratio the current price implies,
        // so a hard minimum here isn't meaningful the way it is for a swap -
        // any unused portion of either token (up to the Desired amount above)
        // is simply refunded to you by the contract, never lost.
        amount0Min: 0,
        amount1Min: 0,
        recipient: address,
        deadline,
      });
      await tx.wait();

      message.success("Liquidity added! This pool is now a little deeper for everyone, including your own future swaps.");
      setAmountA('');
      setAmountB('');
      fetchBalances();
      setContributorsRefresh((n) => n + 1); // pick up this deposit in the list below
    } catch (err) {
      console.error("Add liquidity failed:", err);
      const reason = err.reason || err.error?.message || err.message || "";
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        message.error("Cancelled");
      } else if (reason.includes("insufficient funds")) {
        message.error("Not enough balance for this amount plus gas.");
      } else {
        message.error(`Couldn't add liquidity: ${reason || "unknown error"}`);
      }
    } finally {
      setIsBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="tokensPage">
        <div className="tokensEmpty">Connect your wallet to add liquidity.</div>
      </div>
    );
  }

  if (!pair) {
    return (
      <div className="tokensPage">
        <div className="tokensEmpty">No poolable pairs configured.</div>
      </div>
    );
  }

  return (
    <>
    <div className="wrapBox" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
      <div className="wrapHeader">
        <h4>Add Liquidity</h4>
        <div className="wrapTabs">
          {PAIRS.map((p, i) => (
            <span
              key={p.label}
              className={i === pairIndex ? "wrapTab wrapTabActive" : "wrapTab"}
              onClick={() => { setPairIndex(i); setAmountA(''); setAmountB(''); }}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div className="poolNote">
        Anyone can add liquidity to this same pool - the more people deposit, the deeper
        it gets for every swap (including yours). Full-range position: your tokens cover
        the entire price curve, no range picking needed.
      </div>

      {fee === null && (
        <div className="poolNote poolNoteWarn">
          No live Uniswap pool found for {pair.label} on Sepolia yet - this pair can't be pooled here.
        </div>
      )}

      <div className="balanceRow">
        Available: {balanceA !== null ? Number(balanceA).toFixed(6) : "..."} {pair.tokenA.ticker}
      </div>
      <Input
        placeholder="0"
        value={amountA}
        onChange={(e) => setAmountA(e.target.value)}
      />

      <div className="balanceRow">
        Available: {balanceB !== null ? Number(balanceB).toFixed(6) : "..."} {pair.tokenB.ticker}
      </div>
      <Input
        placeholder="0"
        value={amountB}
        onChange={(e) => setAmountB(e.target.value)}
      />

      <button
        className="wrapButton"
        disabled={isBusy || fee === null || !amountA || !amountB}
        onClick={addLiquidity}
      >
        {isBusy ? "Processing..." : "Add Liquidity"}
      </button>
    </div>

    <div className="wrapBox poolContributorsBox">
      <div className="wrapHeader">
        <h4>Who's In This Pool</h4>
      </div>
      <div className="poolNote">
        Every wallet that has deposited {pair.label} into this pool recently, scanned
        directly from on-chain deposits - not just ones made through this page.
      </div>

      {isLoadingContributors && <div className="poolNote">Scanning recent deposits...</div>}
      {contributorsError && <div className="poolNote poolNoteWarn">{contributorsError}</div>}
      {!isLoadingContributors && !contributorsError && contributors.length === 0 && (
        <div className="poolNote">No deposits found in the last ~20,000 blocks yet - be the first!</div>
      )}

      {contributors.map((c, i) => (
        <div className="poolContributorRow" key={`${c.txHash}-${i}`}>
          <span className="poolContributorAddress">
            {c.address.slice(0, 6)}...{c.address.slice(-4)}
          </span>
          <span className="poolContributorAmount">
            {Number(c.amount).toFixed(6)} {c.ticker}
          </span>
          <a
            className="poolContributorLink"
            href={`https://sepolia.etherscan.io/tx/${c.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View
          </a>
        </div>
      ))}
    </div>
    </>
  );
}

export default Pool
