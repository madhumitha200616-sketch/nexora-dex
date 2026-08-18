import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ethers } from "ethers";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import "./AddLiquidity.css";

const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

// Same Uniswap V3 Factory used throughout this project (Swap.js, Pools.js,
// useMarketData.js, useAnalytics.js) - re-verified live against all 10
// configured Nexora pools in the prior audit turn, not assumed.
const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
const FEE_TIERS = [500, 3000, 10000, 100];
const TICK_SPACING = { 500: 10, 3000: 60, 10000: 200, 100: 1 };

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
];

// Same NonfungiblePositionManager already relied on in Portfolio.js for
// reading positions and sending real collect()/decreaseLiquidity()
// transactions - mint() is the same standard INonfungiblePositionManager
// interface, just not previously included in that ABI subset.
const POSITION_MANAGER_ADDRESS = "0x1238536071E1c677A632429e3655c799b22cDA52";
const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// Fixed internal slippage margin used for amount0Min/amount1Min - matches
// Swap.js's DEFAULT_SLIPPAGE_PCT convention (also not user-configurable
// there). Never zero: a zero minimum would accept literally any output,
// which is exactly the "force it through" shortcut the spec explicitly
// disallows.
const DEFAULT_SLIPPAGE_PCT = 2.5;

const MIN_TICK = -887272;
const MAX_TICK = 887272;
// Exact bounds already used by this project's real, previously-seeded
// full-range USDC-pool positions (verified via on-chain position reads
// earlier this session) - reused as-is for the fee-3000 pools rather than
// re-derived, so a new full-range position looks identical to the existing
// ones.
const FULL_RANGE_3000 = { tickLower: -887220, tickUpper: 887220 };

function tickSqrtRatio(tick) {
  return Math.sqrt(Math.pow(1.0001, tick));
}

// Sensible default range per fee tier: full-range for the 0.3% USDC pools
// (mirrors the existing seeded positions exactly), a wide-but-genuinely-
// concentrated band for everything else (mirrors the ~moderate ranges the
// existing seeded cross-token positions actually use), rounded to the
// pool's real tick spacing so it's a valid mintable range.
function defaultTickRange(fee, currentTick) {
  if (fee === 3000) return FULL_RANGE_3000;
  const spacing = TICK_SPACING[fee] || 60;
  const halfWidthTicks = 3000; // ~+/-35% price band around the current price
  let tickLower = Math.floor((currentTick - halfWidthTicks) / spacing) * spacing;
  let tickUpper = Math.ceil((currentTick + halfWidthTicks) / spacing) * spacing;
  tickLower = Math.max(tickLower, MIN_TICK);
  tickUpper = Math.min(tickUpper, MAX_TICK);
  return { tickLower, tickUpper };
}

// Standard Uniswap V3 "amount-for-liquidity" math, inverted to solve for
// liquidity (and the paired amount) from ONE desired input amount - the
// real current price and real tick range, never an invented ratio. Mirrors
// the same tick-math family already used elsewhere in this project
// (Portfolio.js's getAmountsForLiquidity, useAnalytics.js's price-impact
// quoting) rather than introducing a new math approach.
function amountsFromAmount0(amount0, sqrtPriceCurrent, sqrtRatioA, sqrtRatioB) {
  if (sqrtPriceCurrent <= sqrtRatioA) {
    // Current price is below the whole range - position would be 100%
    // token0, no token1 needed at all.
    const liquidity = amount0 / (1 / sqrtRatioA - 1 / sqrtRatioB);
    return { liquidity, amount0, amount1: 0, onlyToken0: true };
  }
  if (sqrtPriceCurrent >= sqrtRatioB) {
    // Current price is above the whole range - this range needs ONLY
    // token1; a token0 input can't be used to size this position at all.
    return { liquidity: 0, amount0: 0, amount1: 0, onlyToken1: true };
  }
  const liquidity = amount0 / (1 / sqrtPriceCurrent - 1 / sqrtRatioB);
  const amount1 = liquidity * (sqrtPriceCurrent - sqrtRatioA);
  return { liquidity, amount0, amount1 };
}

function findToken(ticker) {
  return SEPOLIA_TOKENS.find((t) => t.ticker === ticker);
}

function explorerTxUrl(hash) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function AddLiquidity({ isConnected, address }) {
  const [params] = useSearchParams();
  const presetPair = params.get("pair");
  const presetToken = params.get("token");

  const [tickerA, setTickerA] = useState(() => {
    if (presetPair) return presetPair.split("/")[0];
    if (presetToken) return presetToken;
    return SEPOLIA_TOKENS[0].ticker;
  });
  const [tickerB, setTickerB] = useState(() => {
    if (presetPair) return presetPair.split("/")[1];
    return SEPOLIA_TOKENS.find((t) => t.ticker !== (presetToken || SEPOLIA_TOKENS[0].ticker))?.ticker || SEPOLIA_TOKENS[1].ticker;
  });
  const [amountA, setAmountA] = useState("");

  const tokenA = findToken(tickerA);
  const tokenB = findToken(tickerB);

  // ---- Pool detection + live pool state (real, re-fetched whenever the
  // pair changes) ----
  const [poolState, setPoolState] = useState({ status: "idle" }); // idle | loading | none | found | error
  const [balances, setBalances] = useState({ a: null, b: null });
  const [allowances, setAllowances] = useState({ a: null, b: null });
  const [approving, setApproving] = useState(null); // "a" | "b" | null
  const [minting, setMinting] = useState(false);
  const [txError, setTxError] = useState(null);
  const [mintResult, setMintResult] = useState(null); // { txHash, tokenId, liquidity, amount0, amount1 }
  const [balancesReloadKey, setBalancesReloadKey] = useState(0);

  const readProvider = useMemo(() => new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL), []);

  useEffect(() => {
    let cancelled = false;
    setPoolState({ status: "loading" });
    setMintResult(null);
    setTxError(null);
    setAmountA("");

    async function detect() {
      if (!tokenA?.sepoliaAddress || !tokenB?.sepoliaAddress) {
        if (!cancelled) setPoolState({ status: "none" });
        return;
      }
      try {
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        let poolAddress = null;
        let fee = null;
        for (const f of FEE_TIERS) {
          const addr = await factory.getPool(tokenA.sepoliaAddress, tokenB.sepoliaAddress, f);
          if (addr && addr !== ethers.constants.AddressZero) {
            poolAddress = addr;
            fee = f;
            break;
          }
        }
        if (cancelled) return;
        if (!poolAddress) {
          setPoolState({ status: "none" });
          return;
        }

        const pool = new ethers.Contract(poolAddress, POOL_ABI, readProvider);
        const [slot0, liquidity, token0Addr] = await Promise.all([pool.slot0(), pool.liquidity(), pool.token0()]);
        if (cancelled) return;

        if (slot0.sqrtPriceX96.isZero()) {
          setPoolState({ status: "error", message: "Pool exists but has never been initialized with a starting price - liquidity cannot be added yet." });
          return;
        }

        const token0IsA = tokenA.sepoliaAddress.toLowerCase() === token0Addr.toLowerCase();
        const decimals0 = token0IsA ? tokenA.decimals : tokenB.decimals;
        const decimals1 = token0IsA ? tokenB.decimals : tokenA.decimals;

        // slot0().sqrtPriceX96 is token1-per-token0 in raw (undecimalized)
        // units - adjust by the real decimal difference, same formula
        // already used in useAnalytics.js/useMarketData.js.
        const ratio = Number(slot0.sqrtPriceX96) / 2 ** 96;
        const rawPriceToken1PerToken0 = ratio * ratio;
        const priceToken1PerToken0 = rawPriceToken1PerToken0 * 10 ** (decimals0 - decimals1);

        const { tickLower, tickUpper } = defaultTickRange(fee, slot0.tick);

        setPoolState({
          status: "found",
          poolAddress,
          fee,
          token0Addr,
          token0IsA,
          decimals0,
          decimals1,
          currentTick: slot0.tick,
          sqrtPriceX96: slot0.sqrtPriceX96,
          poolLiquidity: liquidity,
          priceToken1PerToken0,
          tickLower,
          tickUpper,
        });
      } catch (err) {
        console.error("Pool detection failed:", err);
        if (!cancelled) setPoolState({ status: "error", message: "Couldn't read pool state from Sepolia right now." });
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, [tokenA, tokenB, readProvider]);

  // ---- Real wallet balances + real allowances against the Position
  // Manager (only meaningful once a pool is actually found) ----
  useEffect(() => {
    let cancelled = false;
    async function loadWalletState() {
      if (!isConnected || !address || !tokenA?.sepoliaAddress || !tokenB?.sepoliaAddress || poolState.status !== "found") {
        setBalances({ a: null, b: null });
        setAllowances({ a: null, b: null });
        return;
      }
      try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const contractA = new ethers.Contract(tokenA.sepoliaAddress, ERC20_ABI, provider);
        const contractB = new ethers.Contract(tokenB.sepoliaAddress, ERC20_ABI, provider);
        const [balA, balB, allowA, allowB] = await Promise.all([
          contractA.balanceOf(address),
          contractB.balanceOf(address),
          contractA.allowance(address, POSITION_MANAGER_ADDRESS),
          contractB.allowance(address, POSITION_MANAGER_ADDRESS),
        ]);
        if (cancelled) return;
        setBalances({
          a: ethers.utils.formatUnits(balA, tokenA.decimals),
          b: ethers.utils.formatUnits(balB, tokenB.decimals),
        });
        setAllowances({ a: allowA, b: allowB });
      } catch (err) {
        console.error("Failed to load wallet balances/allowances:", err);
      }
    }
    loadWalletState();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, tokenA, tokenB, poolState.status, balancesReloadKey]);

  // ---- Required-amount calculation, driven by amountA, from the REAL
  // current pool price and REAL tick range - never an invented ratio ----
  const calc = useMemo(() => {
    if (poolState.status !== "found" || !amountA || Number(amountA) <= 0) return null;
    const { token0IsA, decimals0, decimals1, sqrtPriceX96, tickLower, tickUpper } = poolState;
    const sqrtPriceCurrent = Number(sqrtPriceX96) / 2 ** 96;
    const sqrtRatioA = tickSqrtRatio(tickLower);
    const sqrtRatioB = tickSqrtRatio(tickUpper);

    // sqrtPriceCurrent/sqrtRatioA/sqrtRatioB above are derived directly from
    // sqrtPriceX96 and ticks, which encode the RAW (wei-unit) token1/token0
    // ratio. They are only comparable to human-readable amounts when both
    // tokens share the same decimals - for pairs like NOVA(18)/USDC(6) that
    // is false, so amounts are converted to raw-unit scale before the
    // Uniswap math and back to human-readable scale after, to avoid a
    // 10^(decimals diff) error.
    const scale0 = 10 ** decimals0;
    const scale1 = 10 ** decimals1;

    // amountA corresponds to token0 or token1 depending on real on-chain
    // ordering - the math below always works in terms of amount0, so flip
    // as needed and flip the result back for display.
    if (token0IsA) {
      const amount0RawUnits = Number(amountA) * scale0;
      const { amount1: amount1RawUnits, onlyToken0, onlyToken1 } = amountsFromAmount0(amount0RawUnits, sqrtPriceCurrent, sqrtRatioA, sqrtRatioB);
      return { amount0Display: amountA, amount1Display: amount1RawUnits / scale1, decimals0, decimals1, onlyToken0, onlyToken1 };
    }
    // amountA is actually token1 - invert the price to reuse the same
    // amount0-driven formula, then flip amount0/amount1 back for display.
    const amount1RawUnits = Number(amountA) * scale1;
    // Solve using the symmetric formula in "token1 terms" by treating
    // 1/sqrtPrice as the driving ratio (equivalent derivation, same
    // underlying Uniswap V3 math, just entering from the other side).
    const sqrtPriceCurrentInv = 1 / sqrtPriceCurrent;
    const sqrtRatioAInv = 1 / sqrtRatioB;
    const sqrtRatioBInv = 1 / sqrtRatioA;
    const { amount1: amount0RawUnits, onlyToken0: onlyToken1, onlyToken1: onlyToken0 } = amountsFromAmount0(
      amount1RawUnits,
      sqrtPriceCurrentInv,
      sqrtRatioAInv,
      sqrtRatioBInv
    );
    return { amount0Display: amount0RawUnits / scale0, amount1Display: amountA, decimals0, decimals1, onlyToken0, onlyToken1 };
  }, [poolState, amountA]);

  const requiredAmountBDisplay = calc
    ? (poolState.token0IsA ? calc.amount1Display : calc.amount0Display)
    : null;

  const refreshBalances = useCallback(() => setBalancesReloadKey((k) => k + 1), []);

  async function handleApprove(which) {
    if (!calc || !isConnected) return;
    setTxError(null);
    setApproving(which);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const token = which === "a" ? tokenA : tokenB;
      const rawAmount =
        which === "a"
          ? ethers.utils.parseUnits(Number(amountA).toFixed(token.decimals), token.decimals)
          : ethers.utils.parseUnits(Number(requiredAmountBDisplay).toFixed(token.decimals), token.decimals);
      const contract = new ethers.Contract(token.sepoliaAddress, ERC20_ABI, signer);
      const tx = await contract.approve(POSITION_MANAGER_ADDRESS, rawAmount);
      await tx.wait();
      refreshBalances();
    } catch (err) {
      console.error("Approve failed:", err);
      const reason = err.reason || err.error?.message || err.message || "Approval failed";
      setTxError(err.code === "ACTION_REJECTED" || err.code === 4001 ? "Approval cancelled" : reason);
    } finally {
      setApproving(null);
    }
  }

  async function handleAddLiquidity() {
    if (!calc || poolState.status !== "found" || !isConnected) return;
    setTxError(null);
    setMinting(true);
    try {
      const { poolAddress, fee, token0IsA, decimals0, decimals1, tickLower, tickUpper } = poolState;
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();

      const token0Addr = token0IsA ? tokenA.sepoliaAddress : tokenB.sepoliaAddress;
      const token1Addr = token0IsA ? tokenB.sepoliaAddress : tokenA.sepoliaAddress;

      const amount0Desired = ethers.utils.parseUnits(Number(calc.amount0Display).toFixed(decimals0), decimals0);
      const amount1Desired = ethers.utils.parseUnits(Number(calc.amount1Display).toFixed(decimals1), decimals1);

      const slippageBps = Math.round(DEFAULT_SLIPPAGE_PCT * 100);
      const amount0Min = amount0Desired.mul(10000 - slippageBps).div(10000);
      const amount1Min = amount1Desired.mul(10000 - slippageBps).div(10000);

      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

      const manager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);
      const tx = await manager.mint({
        token0: token0Addr,
        token1: token1Addr,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: address,
        deadline,
      });

      const receipt = await tx.wait();

      // Read the real return values from the mint call's own logs (the
      // IncreaseLiquidity event / Transfer event carry the actual tokenId
      // and amounts the chain recorded - not re-derived from our own
      // pre-transaction estimate).
      let tokenId = null;
      let mintedLiquidity = null;
      let mintedAmount0 = null;
      let mintedAmount1 = null;
      try {
        const managerIface = new ethers.utils.Interface([
          "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        ]);
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== POSITION_MANAGER_ADDRESS.toLowerCase()) continue;
          try {
            const parsed = managerIface.parseLog(log);
            tokenId = parsed.args.tokenId.toString();
            mintedLiquidity = parsed.args.liquidity.toString();
            mintedAmount0 = ethers.utils.formatUnits(parsed.args.amount0, decimals0);
            mintedAmount1 = ethers.utils.formatUnits(parsed.args.amount1, decimals1);
            break;
          } catch {
            // not the IncreaseLiquidity log, keep scanning
          }
        }
      } catch (err) {
        console.warn("Could not decode mint result from receipt logs:", err.message);
      }

      setMintResult({
        txHash: tx.hash,
        poolAddress,
        tokenId,
        liquidity: mintedLiquidity,
        amount0: mintedAmount0,
        amount1: mintedAmount1,
        token0Ticker: token0IsA ? tokenA.ticker : tokenB.ticker,
        token1Ticker: token0IsA ? tokenB.ticker : tokenA.ticker,
      });
      setAmountA("");
      refreshBalances();
    } catch (err) {
      console.error("Add Liquidity failed:", err);
      const reason = err.reason || err.error?.message || err.message || "";
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxError("Transaction cancelled");
      } else if (reason.includes("insufficient funds")) {
        setTxError("Insufficient ETH for gas fees. Get more Sepolia test ETH from a faucet.");
      } else if (reason) {
        setTxError(`Transaction failed: ${reason}`);
      } else {
        setTxError("Transaction failed. Please try again.");
      }
    } finally {
      setMinting(false);
    }
  }

  // ---- Derived UI state ----
  const needsAmountA = poolState.status === "found" && (!amountA || Number(amountA) <= 0);
  const balanceANum = balances.a !== null ? Number(balances.a) : null;
  const balanceBNum = balances.b !== null ? Number(balances.b) : null;
  const insufficientBalanceA = calc && balanceANum !== null && Number(amountA) > balanceANum;
  const insufficientBalanceB = calc && balanceBNum !== null && requiredAmountBDisplay !== null && Number(requiredAmountBDisplay) > balanceBNum;

  const requiredRawA = calc && tokenA ? ethers.utils.parseUnits(Number(amountA).toFixed(tokenA.decimals), tokenA.decimals) : null;
  const requiredRawB =
    calc && tokenB && requiredAmountBDisplay !== null
      ? ethers.utils.parseUnits(Number(requiredAmountBDisplay).toFixed(tokenB.decimals), tokenB.decimals)
      : null;

  const allowanceOkA = requiredRawA && allowances.a !== null ? allowances.a.gte(requiredRawA) : null;
  const allowanceOkB = requiredRawB && allowances.b !== null ? allowances.b.gte(requiredRawB) : null;

  const readyToMint =
    calc &&
    !calc.onlyToken1 &&
    !insufficientBalanceA &&
    !insufficientBalanceB &&
    allowanceOkA === true &&
    allowanceOkB === true &&
    !minting;

  const poolRatioDisplay =
    poolState.status === "found"
      ? poolState.token0IsA
        ? `1 ${tickerA} = ${poolState.priceToken1PerToken0.toFixed(6)} ${tickerB}`
        : `1 ${tickerA} = ${(1 / poolState.priceToken1PerToken0).toFixed(6)} ${tickerB}`
      : null;

  return (
    <PageShell
      eyebrow="Provide Liquidity"
      title="Add Liquidity"
      subtitle="Pick a pair and provide real on-chain liquidity to an existing Nexora pool on Sepolia."
      background={
        <ThreeDBackground
          intensity={4}
          coins={[
            { ticker: tokenA?.ticker, img: tokenA?.img },
            { ticker: tokenB?.ticker, img: tokenB?.img },
          ]}
        />
      }
    >
      <GlassCard glow pad="lg" className="nx-al-card">
        <div className="nx-al-token-row">
          <TokenIcon symbol={tokenA?.ticker} src={tokenA?.img} size={32} />
          <select
            className="nx-al-token-select"
            value={tickerA}
            onChange={(e) => {
              setTickerA(e.target.value);
              setMintResult(null);
            }}
          >
            {SEPOLIA_TOKENS.map((t) => (
              <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
            ))}
          </select>
          <input
            className="nx-al-amount-input"
            placeholder="0.0"
            value={amountA}
            onChange={(e) => setAmountA(e.target.value)}
            disabled={poolState.status !== "found"}
          />
        </div>
        {isConnected && balances.a !== null && (
          <div className="nx-al-summary-row" style={{ marginTop: -6, marginBottom: 6 }}>
            <span>Wallet Balance ({tickerA})</span>
            <strong>{Number(balances.a).toFixed(6)}</strong>
          </div>
        )}

        <div className="nx-al-plus">+</div>

        <div className="nx-al-token-row">
          <TokenIcon symbol={tokenB?.ticker} src={tokenB?.img} size={32} />
          <select
            className="nx-al-token-select"
            value={tickerB}
            onChange={(e) => {
              setTickerB(e.target.value);
              setMintResult(null);
            }}
          >
            {SEPOLIA_TOKENS.map((t) => (
              <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
            ))}
          </select>
          <input
            className="nx-al-amount-input"
            placeholder="0.0"
            value={requiredAmountBDisplay !== null ? Number(requiredAmountBDisplay).toFixed(6) : ""}
            disabled
            title="Calculated automatically from the real current pool price"
          />
        </div>
        {isConnected && balances.b !== null && (
          <div className="nx-al-summary-row" style={{ marginTop: -6, marginBottom: 6 }}>
            <span>Wallet Balance ({tickerB})</span>
            <strong>{Number(balances.b).toFixed(6)}</strong>
          </div>
        )}

        <div className="nx-al-summary-row">
          <span>Fee Tier</span>
          <strong>{poolState.status === "found" ? `${(poolState.fee / 10000).toFixed(2)}%` : "—"}</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Current Pool Price</span>
          <strong>{poolRatioDisplay || "—"}</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Pool Liquidity</span>
          <strong>{poolState.status === "found" ? poolState.poolLiquidity.toString() : "—"}</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Slippage</span>
          <strong>{DEFAULT_SLIPPAGE_PCT.toFixed(2)}%</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Your Estimated Position</span>
          <strong>
            {calc ? `${Number(calc.amount0Display).toFixed(6)} / ${Number(calc.amount1Display).toFixed(6)}` : "—"}
          </strong>
        </div>

        {/* ---- Status / help banner, replacing the old permanently-disabled notice ---- */}
        {!isConnected && (
          <div className="nx-al-banner">Connect your wallet to add liquidity.</div>
        )}
        {isConnected && poolState.status === "loading" && (
          <div className="nx-al-banner">Checking Sepolia for a live {tickerA}/{tickerB} pool…</div>
        )}
        {isConnected && poolState.status === "none" && (
          <div className="nx-al-banner">
            No Uniswap V3 pool exists for {tickerA}/{tickerB} on Sepolia at any standard fee tier. Liquidity cannot be
            added to this pair - a new pool is not created automatically. Try a different pair.
          </div>
        )}
        {isConnected && poolState.status === "error" && (
          <div className="nx-al-banner">{poolState.message}</div>
        )}
        {isConnected && poolState.status === "found" && needsAmountA && (
          <div className="nx-al-banner">Enter an amount of {tickerA} - the required {tickerB} amount is calculated from the real current pool price.</div>
        )}
        {isConnected && poolState.status === "found" && calc?.onlyToken1 && (
          <div className="nx-al-banner">
            The current price is outside this position's range on the {tickerA} side - this range only accepts{" "}
            {tickerB}. Try entering an amount of {tickerB} instead, or pick a different pair.
          </div>
        )}
        {isConnected && calc && insufficientBalanceA && (
          <div className="nx-al-banner">Insufficient {tickerA} balance - you have {Number(balances.a).toFixed(6)}.</div>
        )}
        {isConnected && calc && !insufficientBalanceA && insufficientBalanceB && (
          <div className="nx-al-banner">Insufficient {tickerB} balance - you have {Number(balances.b).toFixed(6)}.</div>
        )}
        {txError && <div className="nx-al-banner nx-al-banner-error">{txError}</div>}

        {mintResult && (
          <div className="nx-al-banner nx-al-banner-success">
            Liquidity added! Position NFT #{mintResult.tokenId ?? "?"}
            {mintResult.amount0 !== null && (
              <> — deposited {Number(mintResult.amount0).toFixed(6)} {mintResult.token0Ticker} + {Number(mintResult.amount1).toFixed(6)} {mintResult.token1Ticker}</>
            )}
            <br />
            <a href={explorerTxUrl(mintResult.txHash)} target="_blank" rel="noreferrer">
              View transaction on Sepolia Etherscan →
            </a>
          </div>
        )}

        {/* ---- Approve buttons (only shown once a real amount + real allowance shortfall are known) ---- */}
        {isConnected && calc && !calc.onlyToken1 && !insufficientBalanceA && allowanceOkA === false && (
          <button
            className="nx-btn nx-btn-secondary nx-btn-full"
            style={{ marginTop: 10 }}
            disabled={approving === "a"}
            onClick={() => handleApprove("a")}
          >
            {approving === "a" ? "Approving..." : `Approve ${tickerA}`}
          </button>
        )}
        {isConnected && calc && !calc.onlyToken1 && !insufficientBalanceB && allowanceOkA !== false && allowanceOkB === false && (
          <button
            className="nx-btn nx-btn-secondary nx-btn-full"
            style={{ marginTop: 10 }}
            disabled={approving === "b"}
            onClick={() => handleApprove("b")}
          >
            {approving === "b" ? "Approving..." : `Approve ${tickerB}`}
          </button>
        )}

        <button
          className="nx-btn nx-btn-primary nx-btn-full"
          style={{ marginTop: 14 }}
          disabled={!readyToMint}
          onClick={handleAddLiquidity}
        >
          {minting ? "Adding Liquidity..." : "Add Liquidity"}
        </button>
      </GlassCard>
    </PageShell>
  );
}

export default AddLiquidity;
