import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { message } from "antd";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import EmptyState from "./ui/EmptyState";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import { fetchOnChainPrices } from "../hooks/useAnalytics";
import "./Portfolio.css";

const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);
const ERC20_ABI = ["function balanceOf(address owner) external view returns (uint256)"];

const POSITION_MANAGER_ADDRESS = "0x1238536071E1c677A632429e3655c799b22cDA52";
const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
];
const FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
];

const Q128 = ethers.BigNumber.from(2).pow(128);
const MASK256 = ethers.BigNumber.from(2).pow(256);

// Solidity's unchecked subtraction wraps mod 2^256 - Uniswap V3 core relies
// on this for fee-growth accounting, so it has to be replicated exactly
// here or the live accrual math silently goes wrong whenever a difference
// is negative (very common - fee growth counters wrap constantly).
function wrapSub(a, b) {
  let r = a.sub(b);
  if (r.isNegative()) r = r.add(MASK256);
  return r;
}

// Mirrors Uniswap V3 core's Tick.getFeeGrowthInside - computes the live
// fee growth inside a position's tick range from the pool's current global
// accumulator and the two boundary ticks' feeGrowthOutside snapshots.
function computeFeeGrowthInside(tickCurrent, tickLower, tickUpper, feeGrowthGlobalX128, lowerOutsideX128, upperOutsideX128) {
  const below = tickCurrent >= tickLower ? lowerOutsideX128 : wrapSub(feeGrowthGlobalX128, lowerOutsideX128);
  const above = tickCurrent < tickUpper ? upperOutsideX128 : wrapSub(feeGrowthGlobalX128, upperOutsideX128);
  return wrapSub(wrapSub(feeGrowthGlobalX128, below), above);
}

// Standard Uniswap V3 amount0/amount1-for-liquidity math (see Uniswap V3
// core LiquidityAmounts.getAmountsForLiquidity): converts the position's
// raw `liquidity` value into the actual token0/token1 amounts it
// represents at the pool's current price, given the position's tick range.
function getAmountsForLiquidity(sqrtPriceX96Current, tickLower, tickUpper, liquidityStr) {
  const sqrtRatioA = Math.sqrt(Math.pow(1.0001, tickLower));
  const sqrtRatioB = Math.sqrt(Math.pow(1.0001, tickUpper));
  const sqrtPriceCurrent = Number(sqrtPriceX96Current) / 2 ** 96;
  const L = Number(liquidityStr);

  let amount0Raw = 0;
  let amount1Raw = 0;

  if (sqrtPriceCurrent <= sqrtRatioA) {
    amount0Raw = L * (1 / sqrtRatioA - 1 / sqrtRatioB);
  } else if (sqrtPriceCurrent >= sqrtRatioB) {
    amount1Raw = L * (sqrtRatioB - sqrtRatioA);
  } else {
    amount0Raw = L * (1 / sqrtPriceCurrent - 1 / sqrtRatioB);
    amount1Raw = L * (sqrtPriceCurrent - sqrtRatioA);
  }

  return { amount0Raw, amount1Raw };
}

// Only positions on the pools Nexora currently tracks (analyticsConfig.json)
// should surface on the Assets page - a wallet may hold plenty of other
// Sepolia Uniswap V3 LP NFTs (other fee tiers, unrelated tokens) that are
// real but out of scope for this dashboard.
const NEXORA_POOL_ADDRESSES = new Set(analyticsConfig.pools.map((p) => p.address.toLowerCase()));

const SLICE_COLORS = ["#22d3ee", "#a855f7", "#34d399", "#3b82f6", "#facc15", "#fb923c", "#ff2ee6", "#6ee7b7"];
const RPC_URL = "https://ethereum-sepolia.publicnode.com";

function Portfolio({ isConnected, address }) {
  const [ethBalance, setEthBalance] = useState(null);
  const [tokenBalances, setTokenBalances] = useState({});
  const [pricesUsd, setPricesUsd] = useState({});
  const [lpPositions, setLpPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLp, setLoadingLp] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!isConnected || !address) return;
    setLoading(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const jsonRpcProvider = new ethers.providers.JsonRpcProvider(RPC_URL);

      const [rawEth, livePrices, ...rawTokenBalances] = await Promise.all([
        provider.getBalance(address),
        fetchOnChainPrices(jsonRpcProvider).catch(() => ({})),
        ...SEPOLIA_TOKENS.map((token) =>
          new ethers.Contract(token.sepoliaAddress, ERC20_ABI, provider).balanceOf(address)
        ),
      ]);
      setEthBalance(ethers.utils.formatEther(rawEth));
      setPricesUsd(livePrices || {});
      const balances = {};
      SEPOLIA_TOKENS.forEach((token, i) => {
        balances[token.ticker] = ethers.utils.formatUnits(rawTokenBalances[i], token.decimals);
      });
      setTokenBalances(balances);
    } catch (err) {
      console.error("Failed to load portfolio balances:", err);
    } finally {
      setLoading(false);
    }
  }, [isConnected, address]);

  const fetchLpPositions = useCallback(async () => {
    if (!isConnected || !address) return;
    setLoadingLp(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const manager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);
      const factory = new ethers.Contract(analyticsConfig.factoryAddress, FACTORY_ABI, provider);

      const countBN = await manager.balanceOf(address);
      const count = countBN.toNumber();

      const loadedPositions = [];
      for (let i = 0; i < count; i++) {
        const tokenIdBN = await manager.tokenOfOwnerByIndex(address, i);
        const tokenId = tokenIdBN.toString();
        const rawPos = await manager.positions(tokenIdBN);

        const poolAddress = await factory.getPool(rawPos.token0, rawPos.token1, rawPos.fee).catch(() => null);
        const isNexoraPool = poolAddress && NEXORA_POOL_ADDRESSES.has(poolAddress.toLowerCase());
        if (!isNexoraPool) continue;

        const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
        const slot0 = await poolContract.slot0().catch(() => null);

        // Live fee accrual: NonfungiblePositionManager.positions() only
        // returns a snapshot that's stale until the position is next
        // "poked" (collect/increaseLiquidity/decreaseLiquidity) - a swap
        // updates the pool's global fee-growth accumulator but never
        // touches an individual position's stored tokensOwed. Recompute
        // the true current accrued fee the same way the pool itself would
        // on a poke, using its live feeGrowthGlobal + the two boundary
        // ticks' feeGrowthOutside.
        let liveTokensOwed0 = rawPos.tokensOwed0;
        let liveTokensOwed1 = rawPos.tokensOwed1;
        let feeReadFailed = false;
        if (!rawPos.liquidity.isZero()) {
          try {
            const [feeGrowthGlobal0, feeGrowthGlobal1, lowerTick, upperTick] = await Promise.all([
              poolContract.feeGrowthGlobal0X128(),
              poolContract.feeGrowthGlobal1X128(),
              poolContract.ticks(rawPos.tickLower),
              poolContract.ticks(rawPos.tickUpper),
            ]);
            if (!slot0) throw new Error("slot0 unavailable");

            const feeGrowthInside0Now = computeFeeGrowthInside(
              slot0.tick, rawPos.tickLower, rawPos.tickUpper,
              feeGrowthGlobal0, lowerTick.feeGrowthOutside0X128, upperTick.feeGrowthOutside0X128
            );
            const feeGrowthInside1Now = computeFeeGrowthInside(
              slot0.tick, rawPos.tickLower, rawPos.tickUpper,
              feeGrowthGlobal1, lowerTick.feeGrowthOutside1X128, upperTick.feeGrowthOutside1X128
            );

            const deltaGrowth0 = wrapSub(feeGrowthInside0Now, rawPos.feeGrowthInside0LastX128);
            const deltaGrowth1 = wrapSub(feeGrowthInside1Now, rawPos.feeGrowthInside1LastX128);

            liveTokensOwed0 = rawPos.tokensOwed0.add(rawPos.liquidity.mul(deltaGrowth0).div(Q128));
            liveTokensOwed1 = rawPos.tokensOwed1.add(rawPos.liquidity.mul(deltaGrowth1).div(Q128));
          } catch (err) {
            console.warn(`Live fee accrual calc failed for tokenId ${tokenId}:`, err.message);
            feeReadFailed = true;
          }
        }

        const token0Meta = SEPOLIA_TOKENS.find(
          (t) => t.sepoliaAddress.toLowerCase() === rawPos.token0.toLowerCase()
        );
        const token1Meta = SEPOLIA_TOKENS.find(
          (t) => t.sepoliaAddress.toLowerCase() === rawPos.token1.toLowerCase()
        );

        const token0Decimals = token0Meta ? token0Meta.decimals : 18;
        const token1Decimals = token1Meta ? token1Meta.decimals : 18;

        const token0Symbol = token0Meta ? token0Meta.ticker : `${rawPos.token0.slice(0, 6)}...`;
        const token1Symbol = token1Meta ? token1Meta.ticker : `${rawPos.token1.slice(0, 6)}...`;

        const owed0Formatted = ethers.utils.formatUnits(liveTokensOwed0, token0Decimals);
        const owed1Formatted = ethers.utils.formatUnits(liveTokensOwed1, token1Decimals);

        let amount0 = null;
        let amount1 = null;
        if (slot0 && !rawPos.liquidity.isZero()) {
          const { amount0Raw, amount1Raw } = getAmountsForLiquidity(
            slot0.sqrtPriceX96,
            rawPos.tickLower,
            rawPos.tickUpper,
            rawPos.liquidity.toString()
          );
          amount0 = amount0Raw / 10 ** token0Decimals;
          amount1 = amount1Raw / 10 ** token1Decimals;
        } else if (rawPos.liquidity.isZero()) {
          amount0 = 0;
          amount1 = 0;
        }

        loadedPositions.push({
          tokenId,
          token0: rawPos.token0,
          token1: rawPos.token1,
          token0Symbol,
          token1Symbol,
          token0Img: token0Meta?.img,
          token1Img: token1Meta?.img,
          fee: rawPos.fee,
          feePercent: (rawPos.fee / 10000).toFixed(2),
          liquidity: rawPos.liquidity.toString(),
          isActive: !rawPos.liquidity.isZero(),
          amount0,
          amount1,
          owed0: owed0Formatted,
          owed1: owed1Formatted,
          feeReadFailed,
          rawOwed0: liveTokensOwed0,
          rawOwed1: liveTokensOwed1,
        });
      }

      setLpPositions(loadedPositions);
    } catch (err) {
      console.error("Failed to load Sepolia LP positions:", err);
    } finally {
      setLoadingLp(false);
    }
  }, [isConnected, address]);

  useEffect(() => {
    if (!isConnected || !address) {
      setEthBalance(null);
      setTokenBalances({});
      setLpPositions([]);
      return;
    }
    fetchAll();
    fetchLpPositions();
  }, [isConnected, address, fetchAll, fetchLpPositions]);

  async function handleCollectFees(pos) {
    if (!window.ethereum || !address) return;
    setProcessingId(pos.tokenId);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const manager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);

      message.info(`Confirm fee collection for Position #${pos.tokenId} in MetaMask...`);
      const MaxUint128 = ethers.BigNumber.from("340282366920938463463374607431768211455");

      const tx = await manager.collect({
        tokenId: pos.tokenId,
        recipient: address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      });
      const receipt = await tx.wait();
      message.success(`Collected fees for Position #${pos.tokenId}! Tx: ${receipt.transactionHash.slice(0, 10)}...`);
      fetchLpPositions();
    } catch (err) {
      console.error("Collect fees error:", err);
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        message.error("Collect fees cancelled");
      } else {
        message.error(err.reason || err.message || "Failed to collect fees");
      }
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRemoveLiquidity(pos) {
    if (!window.ethereum || !address) return;
    if (pos.liquidity === "0") {
      message.info("Position has 0 liquidity");
      return;
    }
    setProcessingId(pos.tokenId);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const manager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);

      message.info(`Confirm removing liquidity for Position #${pos.tokenId} in MetaMask...`);
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const MaxUint128 = ethers.BigNumber.from("340282366920938463463374607431768211455");

      const tx1 = await manager.decreaseLiquidity({
        tokenId: pos.tokenId,
        liquidity: pos.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: deadline,
      });
      await tx1.wait();

      const tx2 = await manager.collect({
        tokenId: pos.tokenId,
        recipient: address,
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      });
      const receipt2 = await tx2.wait();

      message.success(`Removed liquidity for Position #${pos.tokenId}! Tx: ${receipt2.transactionHash.slice(0, 10)}...`);
      fetchLpPositions();
    } catch (err) {
      console.error("Remove liquidity error:", err);
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        message.error("Remove liquidity cancelled");
      } else {
        message.error(err.reason || err.message || "Failed to remove liquidity");
      }
    } finally {
      setProcessingId(null);
    }
  }

  const holdings = useMemo(() => {
    const rows = [];
    if (ethBalance !== null) {
      rows.push({ ticker: "ETH", name: "Ethereum", balance: Number(ethBalance), img: null });
    }
    SEPOLIA_TOKENS.forEach((t) => {
      if (tokenBalances[t.ticker] !== undefined) {
        rows.push({ ticker: t.ticker, name: t.name, balance: Number(tokenBalances[t.ticker]), img: t.img });
      }
    });
    return rows.map((r) => {
      const price = pricesUsd[r.ticker] ?? null;
      return { ...r, priceUsd: price, usd: price !== null && r.balance > 0 ? r.balance * price : null };
    });
  }, [ethBalance, tokenBalances, pricesUsd]);

  const totalUsd = holdings.reduce((sum, h) => (h.usd !== null ? sum + h.usd : sum), 0);
  const hasUnpricedTokens = holdings.some((h) => h.balance > 0 && h.usd === null);
  const pieData = holdings.filter((h) => h.usd !== null && h.usd > 0).map((h) => ({ name: h.ticker, value: h.usd }));

  const heldCoins = holdings
    .filter((h) => h.balance > 0 && h.img)
    .slice(0, 4)
    .map((h) => ({ ticker: h.ticker, img: h.img }));

  if (!isConnected || !address) {
    return (
      <PageShell
        eyebrow="Your Assets"
        title="Portfolio"
        subtitle="Connect your wallet to see real balances across every Nexora-supported token."
        background={<ThreeDBackground intensity={3} />}
      >
        <EmptyState icon="👛" title="Wallet not connected" description="Connect MetaMask from the navbar to view your portfolio." />
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Your Assets"
      title="Portfolio"
      subtitle="Real balances read live from Sepolia testnet — nothing here is estimated."
      background={<ThreeDBackground intensity={3} coins={heldCoins.length ? heldCoins : undefined} />}
    >
      <div className="nx-portfolio-hero-card">
        <div className="nx-portfolio-hero-top">
          <span>Connected Wallet</span>
          <span className="nx-portfolio-hero-addr">{address.slice(0, 6)}...{address.slice(-4)}</span>
        </div>
        <div className="nx-portfolio-hero-label">Estimated Portfolio Value (Sepolia Testnet)</div>
        <div className="nx-portfolio-hero-value">
          {loading
            ? "…"
            : totalUsd > 0
            ? `~$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${hasUnpricedTokens ? " *" : ""}`
            : "USD valuation unavailable"}
        </div>
        <div className="nx-portfolio-hero-chips">
          <span className="nx-swap-chip">{holdings.filter((h) => h.balance > 0).length} assets held</span>
          <span className="nx-swap-chip">Sepolia Testnet</span>
          <span className="nx-swap-chip">Live On-Chain Data</span>
        </div>
      </div>

      <div className="nx-portfolio-layout">
        <GlassCard pad="md">
          <h3 className="nx-section-heading" style={{ textAlign: "left", marginBottom: 16 }}>Token Balances</h3>
          <div className="nx-portfolio-holdings">
            {loading && <div>Loading balances…</div>}
            {!loading && holdings.map((h) => (
              <div key={h.ticker} className="nx-glass-card nx-holding-row">
                <TokenIcon symbol={h.ticker} src={h.img} size={34} />
                <div className="nx-holding-info">
                  <div className="nx-holding-symbol">{h.ticker}</div>
                  <div className="nx-holding-name">{h.name}</div>
                </div>
                <div>
                  <div className="nx-holding-balance">{h.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>
                  <div className="nx-holding-usd">{h.usd !== null ? `~$${h.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard pad="md" className="nx-portfolio-chart-wrap">
          <h3 className="nx-section-heading" style={{ marginBottom: 8 }}>Asset Allocation</h3>
          {pieData.length === 0 ? (
            <EmptyState icon="📊" title="No balances yet" description="Claim some tokens from the Faucet to see your allocation here." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `~$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    contentStyle={{ background: "#0c0c10", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="nx-portfolio-legend">
                {pieData.map((d, i) => (
                  <div key={d.name} className="nx-portfolio-legend-row">
                    <span className="nx-portfolio-legend-dot" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </GlassCard>
      </div>

      <div style={{ marginTop: 28 }}>
        <GlassCard pad="lg">
          <div className="nx-lp-section-header">
            <div>
              <h3 className="nx-section-heading" style={{ textAlign: "left", marginBottom: 2 }}>Your Liquidity Positions</h3>
              <p className="nx-section-sub" style={{ textAlign: "left", margin: 0 }}>
                Uniswap V3 NFT LP positions read directly from Sepolia NonfungiblePositionManager.
              </p>
            </div>
            <Link to="/add-liquidity" className="nx-btn nx-btn-primary nx-btn-sm">
              + Add Liquidity
            </Link>
          </div>

          {loadingLp && <div style={{ padding: "20px 0", color: "var(--nx-text-secondary)" }}>Querying Sepolia for LP NFT positions…</div>}

          {!loadingLp && lpPositions.length === 0 && (
            <EmptyState
              icon="💧"
              title="No Active LP Positions"
              description="You haven't deposited liquidity into any Uniswap V3 pools on Sepolia yet. Provide liquidity to earn trading fees across Nexora pools."
              badge="Sepolia LP Tracking"
              action={
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <Link to="/pools" className="nx-btn nx-btn-secondary nx-btn-sm">Browse Pools</Link>
                  <Link to="/add-liquidity" className="nx-btn nx-btn-primary nx-btn-sm">+ Add Liquidity</Link>
                </div>
              }
            />
          )}

          {!loadingLp && lpPositions.length > 0 && (
            <div className="nx-lp-positions-grid">
              {lpPositions.map((pos) => (
                <div key={pos.tokenId} className="nx-lp-card">
                  <div className="nx-lp-card-header">
                    <div className="nx-lp-pair-info">
                      <div className="nx-lp-pair-icons">
                        <TokenIcon symbol={pos.token0Symbol} src={pos.token0Img} size={28} />
                        <TokenIcon symbol={pos.token1Symbol} src={pos.token1Img} size={28} />
                      </div>
                      <div>
                        <div className="nx-lp-pair-title">{pos.token0Symbol} / {pos.token1Symbol}</div>
                        <div className="nx-lp-pair-sub">NFT #{pos.tokenId}</div>
                      </div>
                    </div>
                    <span className="nx-lp-badge-fee">{pos.feePercent}% Fee</span>
                  </div>

                  <div className="nx-lp-details-list">
                    <div className="nx-lp-detail-row">
                      <span>Status</span>
                      <span className={`nx-lp-status-pill ${pos.isActive ? "nx-status-active" : "nx-status-inactive"}`}>
                        {pos.isActive ? "● Active In-Range" : "○ 0 Liquidity"}
                      </span>
                    </div>

                    <div className="nx-lp-detail-row">
                      <span>Liquidity</span>
                      <span className="nx-lp-detail-value">
                        {pos.amount0 !== null && pos.amount1 !== null ? (
                          <>
                            {pos.amount0.toLocaleString(undefined, { maximumFractionDigits: 4 })} {pos.token0Symbol}
                            <br />
                            {pos.amount1.toLocaleString(undefined, { maximumFractionDigits: 4 })} {pos.token1Symbol}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>

                    <div className="nx-lp-detail-row">
                      <span>Uncollected Fees</span>
                      <span className="nx-lp-detail-value">
                        {pos.feeReadFailed
                          ? "—"
                          : `${Number(pos.owed0).toFixed(4)} ${pos.token0Symbol} + ${Number(pos.owed1).toFixed(4)} ${pos.token1Symbol}`}
                      </span>
                    </div>
                  </div>

                  <div className="nx-lp-actions">
                    <button
                      type="button"
                      className="nx-btn nx-btn-secondary nx-btn-sm"
                      disabled={processingId === pos.tokenId || pos.feeReadFailed || (pos.owed0 === "0.0" && pos.owed1 === "0.0")}
                      onClick={() => handleCollectFees(pos)}
                    >
                      {processingId === pos.tokenId ? "Processing..." : "Collect Fees"}
                    </button>
                    <button
                      type="button"
                      className="nx-btn nx-btn-secondary nx-btn-sm"
                      disabled={processingId === pos.tokenId || !pos.isActive}
                      onClick={() => handleRemoveLiquidity(pos)}
                    >
                      {processingId === pos.tokenId ? "Processing..." : "Remove Liquidity"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <Link to="/tokens" className="nx-btn nx-btn-secondary">View Recent Activity →</Link>
      </div>
    </PageShell>
  );
}

export default Portfolio;
