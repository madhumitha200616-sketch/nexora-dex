import React, { useMemo, useState } from "react";
import { motion, animate } from "framer-motion";
import { Link } from "react-router-dom";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import { useAnalytics, DEFAULT_SEPOLIA_RPC_URL } from "../hooks/useAnalytics";
import GlassCard from "./ui/GlassCard";
import "./AnalyticsDashboard.css";

// Dedicated RPC endpoint for this page only (not the app-wide
// REACT_APP_INFURA_URL used elsewhere) - the analytics scans need
// multi-address eth_getLogs queries (one call covering all 10 pools at
// once, instead of 10 separate scans), and the app's usual endpoint
// actively rejects those with a 403. Configurable via REACT_APP_SEPOLIA_RPC_URL
// (.env) if the default public endpoint's rate limits become the
// bottleneck - see useAnalytics.js.
const RPC_URL = DEFAULT_SEPOLIA_RPC_URL;

function formatCompact(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: opts.decimals ?? 0 });
}

function CountUp({ value, prefix = "", suffix = "", decimals = 0 }) {
  // Animates as soon as a real value arrives, rather than gating on
  // useInView - these cards sit at the top of the page (already in the
  // initial viewport on load), and IntersectionObserver-based triggers
  // proved unreliable there in testing, silently leaving the counter stuck
  // at its initial 0 instead of showing the real number.
  const [display, setDisplay] = useState(0);

  React.useEffect(() => {
    if (value === null || value === undefined) return;
    const controls = animate(0, value, {
      duration: 1.3,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    // requestAnimationFrame-driven animation can be throttled/suspended by
    // the browser (backgrounded tabs, reduced-motion, low-power mode), which
    // would otherwise leave the counter stuck below the real value - these
    // are protocol stats, so correctness can't depend on the animation
    // actually ticking. Force the true value once the animation should be done.
    const fallback = setTimeout(() => setDisplay(value), 1400);
    return () => {
      controls.stop();
      clearTimeout(fallback);
    };
  }, [value]);

  if (value === null || value === undefined) {
    return <span className="an-stat-unavailable">—</span>;
  }

  return (
    <span>
      {prefix}
      {display.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

function RingProgress({ percent, label, color }) {
  const size = 108;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = percent === null || Number.isNaN(percent) ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div className="an-glass an-ring-card">
      <svg width={size} height={size} className="an-ring-svg">
        <circle className="an-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <motion.circle
          className="an-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={color}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={{ duration: 1.3, ease: "easeOut" }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="an-ring-value" transform={`rotate(90 ${size / 2} ${size / 2})`}>
          {percent === null ? "—" : `${clamped.toFixed(0)}%`}
        </text>
      </svg>
      <div className="an-ring-label">{label}</div>
    </div>
  );
}

function StatCard({ icon, color, label, value, sub, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.45, delay }}
      className="an-glass an-stat-card"
    >
      <div className="an-stat-icon" style={{ background: `${color}1f`, color }}>
        {icon}
      </div>
      <div className="an-stat-label">{label}</div>
      <div className="an-stat-value">{value}</div>
      {sub && <div className="an-stat-sub">{sub}</div>}
    </motion.div>
  );
}

function ParticleField() {
  const particles = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 2 + Math.random() * 3,
        duration: 14 + Math.random() * 16,
        delay: -Math.random() * 20,
        color: ["#22d3ee", "#a855f7", "#34d399", "#3b82f6"][i % 4],
      })),
    []
  );
  return (
    <div className="an-particles">
      {particles.map((p) => (
        <span
          key={p.id}
          className="an-particle"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            boxShadow: `0 0 6px ${p.color}`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function AnalyticsDashboard() {
  const {
    data,
    loading,
    error,
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
    activityProgress,
    refresh,
  } = useAnalytics(RPC_URL);

  // `data` (fast: supply/pools/prices) and eventStats/faucetStats (slow:
  // historical Swap/Mint/Claimed scan) resolve independently now - and as
  // of the fast-data independence fix, supply/pools/pricesUsd are each
  // independently try/caught too (see loadFastData in useAnalytics.js), so
  // `data` itself being non-null no longer guarantees any of its three
  // sub-fields are. Everything below has to null-guard each of
  // supply/pools/pricesUsd on its own - a failed price fetch must not blank
  // out real pool balances, and vice versa.
  const computed = useMemo(() => {
    if (!data) return null;
    const { supply, pools, pricesUsd, avgPriceImpact } = data;

    let totalSupplyUsd = 0;
    let circulatingSupplyUsd = 0;
    let faucetReserveUsd = 0;
    let deployerHoldingsUsd = 0;
    let faucetReserveTokens = 0;
    let hasUnpricedToken = false;

    const perToken = {};
    for (const t of analyticsConfig.tokens) {
      const s = supply ? supply[t.ticker] : null;
      const total = s ? Number(s.totalSupply) : null;
      const deployerBal = s ? Number(s.deployerBalance) : null;
      const faucetBal = s ? Number(s.faucetReserve) : null;
      const circulating = s ? Math.max(0, total - deployerBal - faucetBal) : null;

      const price = pricesUsd?.[t.ticker] ?? null;
      if (s) {
        if (price !== null) {
          totalSupplyUsd += total * price;
          circulatingSupplyUsd += circulating * price;
          faucetReserveUsd += faucetBal * price;
          deployerHoldingsUsd += deployerBal * price;
        } else {
          hasUnpricedToken = true;
        }
        faucetReserveTokens += faucetBal;
      }

      const liquidityAvailable = pools
        ? pools.reduce((sum, p) => {
            if (p.tokenA === t.ticker) return sum + p.amountA;
            if (p.tokenB === t.ticker) return sum + p.amountB;
            return sum;
          }, 0)
        : null;

      const tokenFeeTiers = pools
        ? [...new Set(pools.filter((p) => p.tokenA === t.ticker || p.tokenB === t.ticker).map((p) => p.fee))].sort(
            (a, b) => a - b
          )
        : [];

      perToken[t.ticker] = {
        ...t,
        priceUsd: price,
        totalSupply: total,
        circulatingSupply: circulating,
        faucetReserve: faucetBal,
        liquidityAvailable,
        claims: faucetStats?.perTokenClaims[t.ticker] ?? null,
        swaps: swapStats?.perTokenSwaps[t.ticker] ?? null,
        feeTiers: tokenFeeTiers,
      };
    }

    const validPools = pools ? pools.filter((p) => p.valueUsd !== null) : [];
    const tvl = validPools.reduce((sum, p) => sum + p.valueUsd, 0);
    const healthyPools = pools ? pools.filter((p) => p.healthy).length : 0;
    const feeTiers = pools ? [...new Set(pools.map((p) => p.fee))].sort((a, b) => a - b) : [];

    const hasSupply = Boolean(supply);
    return {
      perToken,
      totalSupplyUsd: !hasSupply || (hasUnpricedToken && totalSupplyUsd === 0) ? null : totalSupplyUsd,
      circulatingSupplyUsd: !hasSupply || (hasUnpricedToken && circulatingSupplyUsd === 0) ? null : circulatingSupplyUsd,
      faucetReserveUsd: !hasSupply || (hasUnpricedToken && faucetReserveUsd === 0) ? null : faucetReserveUsd,
      faucetReserveTokens: hasSupply ? faucetReserveTokens : null,
      tvl: pools && validPools.length > 0 ? tvl : null,
      totalPools: pools ? pools.length : null,
      liquidityProviders: mintStats ? mintStats.liquidityProviders : null,
      totalSwaps: swapStats ? swapStats.totalSwaps : null,
      totalVolumeUsd: swapStats ? swapStats.totalVolumeUsd : null,
      // Use whichever of swap-wallets/faucet-wallets is already available
      // rather than requiring both to have resolved - if swap finishes
      // first with a real nonzero count, show that immediately; otherwise
      // fall back to faucet's count once (if) that's what's ready first.
      activeWallets:
        swapStats && swapStats.uniqueActiveWalletsCount > 0
          ? swapStats.uniqueActiveWalletsCount
          : faucetStats
          ? faucetStats.activeWallets
          : null,
      totalClaims: faucetStats ? faucetStats.totalClaims : null,
      totalTokensDistributedUsd: faucetStats ? faucetStats.totalDistributedUsd : null,
      // Genuinely needs all three - it's a sum across swap+claim+LP counts.
      totalTransactions:
        swapStats && faucetStats && mintStats
          ? swapStats.totalSwaps + faucetStats.totalClaims + mintStats.liquidityProviders
          : null,
      feeTiers,
      // Only meaningful once the historical scans have actually run -
      // before that, swapStats/mintStats/faucetStats are null because
      // they're still loading, not because anything failed.
      dataIncomplete: Boolean(swapStats?.swapDataIncomplete || mintStats?.mintDataIncomplete || faucetStats?.dataIncomplete),
      faucetUtilizationPct: hasSupply
        ? (faucetReserveTokens / (analyticsConfig.faucetInitialFundingPerToken * analyticsConfig.tokens.length)) * 100
        : null,
      liquidityUtilizationPct: totalSupplyUsd > 0 && tvl > 0 ? (tvl / totalSupplyUsd) * 100 : null,
      distributionPct: totalSupplyUsd > 0 ? ((totalSupplyUsd - deployerHoldingsUsd) / totalSupplyUsd) * 100 : null,
      poolHealthPct: pools && pools.length > 0 ? (healthyPools / pools.length) * 100 : null,
      // Real, live "10-unit reference trade" quote from fetchAvgPriceImpact
      // in useAnalytics.js - genuinely null (not a fabricated 0) if every
      // configured pool's QuoterV2 simulation failed or timed out.
      avgPriceImpact,
    };
  }, [data, swapStats, mintStats, faucetStats]);

  // A fast-section failure/timeout must not take the activity-derived
  // numbers down with it (and vice versa) - this mirrors just the
  // activity-derived subset of `computed` from swapStats/mintStats/
  // faucetStats alone, so Total Swaps/Volume/Active Wallets/etc. can still
  // render even when `computed` itself is null because the fast contract
  // reads failed.
  const activityOnly = useMemo(() => {
    if (!swapStats && !mintStats && !faucetStats) return null;
    return {
      liquidityProviders: mintStats ? mintStats.liquidityProviders : null,
      totalSwaps: swapStats ? swapStats.totalSwaps : null,
      totalVolumeUsd: swapStats ? swapStats.totalVolumeUsd : null,
      activeWallets:
        swapStats && swapStats.uniqueActiveWalletsCount > 0
          ? swapStats.uniqueActiveWalletsCount
          : faucetStats
          ? faucetStats.activeWallets
          : null,
      totalClaims: faucetStats ? faucetStats.totalClaims : null,
      totalTokensDistributedUsd: faucetStats ? faucetStats.totalDistributedUsd : null,
      totalTransactions:
        swapStats && faucetStats && mintStats
          ? swapStats.totalSwaps + faucetStats.totalClaims + mintStats.liquidityProviders
          : null,
      dataIncomplete: Boolean(swapStats?.swapDataIncomplete || mintStats?.mintDataIncomplete || faucetStats?.dataIncomplete),
    };
  }, [swapStats, mintStats, faucetStats]);

  const stats = computed || activityOnly;

  return (
    <div className="an-page">
      <div className="an-bg" />
      <ParticleField />

      <div className="an-content">
        <div className="an-header">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="an-eyebrow">
            <span className={`an-dot ${networkOnline === null ? "an-dot-wait" : networkOnline ? "an-dot-on" : "an-dot-off"}`} />
            {networkOnline === null ? "Connecting to Sepolia..." : networkOnline ? "Live On-Chain Data · Sepolia" : "Network Unavailable"}
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }} className="an-title">
            Nexora Analytics
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }} className="an-subtitle">
            Real-time protocol statistics read directly from the deployed contracts and Sepolia blockchain state —
            no price charts, no simulated data. NOVA, FSN, VRTX and ORBT are reference-priced demonstration tokens
            without external markets, so there's nothing meaningful to chart here.
          </motion.p>
          <div className="an-refresh-row">
            {data?.blockNumber && <span>Block #{data.blockNumber.toLocaleString()}</span>}
            <button className="an-refresh-btn" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {loading && !data && (
          <div className="an-loading">
            Reading live contract state — balances, supply, and pool reserves.
            <div className="an-loading-bar">
              <div className="an-loading-bar-fill" />
            </div>
          </div>
        )}

        {error && !data && (
          <div className="an-glass" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ marginBottom: 14, color: "rgba(232,235,247,0.6)" }}>
              Couldn't load on-chain data right now (the RPC endpoint may be slow or rate-limited).
            </div>
            <button className="an-refresh-btn" onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {/* Fast-section failure/timeout must not hide the historical
            section, and vice versa - gate on either being available, not
            both, and fall back to `stats` (activityOnly when computed is
            null) for the activity-derived fields below. */}
        {(computed || activityOnly) && (
          <>
            {/* Swap/Mint/Faucet are three fully independent scans now, each
                with its own loading/error state - this banner only names
                whichever of the three is still actually running, and each
                StatCard below gates on its own specific section instead of
                one shared activityLoading flag. */}
            {(swapLoading || mintLoading || faucetLoading || swapError || mintError || faucetError) && (
              <div className="an-glass" style={{ padding: "14px 20px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12 }}>
                <span className={`an-dot ${swapError && mintError && faucetError ? "an-dot-off" : "an-dot-wait"}`} />
                <span style={{ color: "rgba(232,235,247,0.75)", fontSize: 14 }}>
                  {(() => {
                    const running = [swapLoading && "Swap", mintLoading && "Mint", faucetLoading && "Faucet"].filter(Boolean);
                    if (running.length > 0) {
                      const progressSuffix =
                        activityProgress && running.some((r) => r.toLowerCase() === activityProgress.section)
                          ? ` — ${activityProgress.section} chunk ${activityProgress.chunkIndex} of ${activityProgress.chunkCount}`
                          : "";
                      return `Scanning ${running.join(" / ")}${progressSuffix}...`;
                    }
                    return "Some historical data couldn't be fully loaded (RPC rate-limited) — hit Refresh to retry.";
                  })()}
                </span>
              </div>
            )}

            <section className="an-section">
              <h2 className="an-section-heading">Protocol Overview</h2>
              <p className="an-section-sub">Aggregated across all 4 Nexora tokens and 10 live pools.</p>
              <div className="an-stat-grid">
                <StatCard icon="◆" color="#22d3ee" label="Total Supply" value={<CountUp value={computed?.totalSupplyUsd ?? null} prefix="$" />} sub="across NOVA, FSN, VRTX, ORBT" delay={0} />
                <StatCard icon="◇" color="#7dd3fc" label="Circulating Supply" value={<CountUp value={computed?.circulatingSupplyUsd ?? null} prefix="$" />} sub="outside deployer & faucet" delay={0.03} />
                <StatCard icon="◈" color="#a855f7" label="Total Value Locked" value={<CountUp value={computed?.tvl ?? null} prefix="$" />} sub="in liquidity pools" delay={0.06} />
                <StatCard icon="⬡" color="#c084fc" label="Liquidity Pools" value={<CountUp value={computed?.totalPools ?? null} />} sub="live on Uniswap V3" delay={0.09} />
                <StatCard icon="◎" color="#34d399" label="Liquidity Providers" value={mintLoading ? "…" : mintStats?.mintDataIncomplete ? "—" : <CountUp value={stats.liquidityProviders} />} sub="unique addresses" delay={0.12} />
                <StatCard icon="⇄" color="#6ee7b7" label="Total Swaps" value={swapLoading ? "…" : swapStats?.swapDataIncomplete ? "—" : <CountUp value={stats.totalSwaps} />} sub="across all pools" delay={0.15} />
                <StatCard icon="$" color="#3b82f6" label="Total Swap Volume" value={swapLoading ? "…" : swapStats?.swapDataIncomplete ? "—" : <CountUp value={stats.totalVolumeUsd} prefix="$" />} sub="cumulative" delay={0.18} />
                <StatCard icon="⛃" color="#60a5fa" label="Faucet Distributed" value={faucetLoading ? "…" : faucetStats?.dataIncomplete ? "—" : <CountUp value={stats.totalTokensDistributedUsd} prefix="$" />} sub="total value claimed" delay={0.21} />
                <StatCard icon="⛁" color="#facc15" label="Faucet Reserve" value={<CountUp value={computed?.faucetReserveUsd ?? null} prefix="$" />} sub="remaining to claim" delay={0.24} />
                <StatCard icon="◉" color="#f472b6" label="Active Wallets" value={stats.activeWallets === null && (swapLoading || faucetLoading) ? "…" : <CountUp value={stats.activeWallets} />} sub="have claimed at least once" delay={0.27} />
                <StatCard icon="✓" color="#fb923c" label="Number of Claims" value={faucetLoading ? "…" : <CountUp value={stats.totalClaims} />} sub="faucet claims processed" delay={0.3} />
                <StatCard icon="Σ" color="#a3e635" label="Total Transactions" value={swapLoading || mintLoading || faucetLoading ? "…" : stats.dataIncomplete ? "—" : <CountUp value={stats.totalTransactions} />} sub="swaps + claims + LP deposits" delay={0.33} />
                <StatCard
                  icon="●"
                  color={networkOnline ? "#34d399" : "#ef4444"}
                  label="Network Status"
                  value={networkOnline ? "Live" : "Offline"}
                  sub={networkOnline ? "Sepolia · chain 11155111" : "check connection"}
                  delay={0.36}
                />
                <StatCard icon="%" color="#38bdf8" label="Fee Tiers" value={computed ? computed.feeTiers.map((f) => `${(f / 10000).toFixed(2)}%`).join(" / ") : "—"} sub="cross-token · USDC pairs" delay={0.39} />
                <StatCard
                  icon="⚠"
                  color="#f59e0b"
                  label="Avg. Price Impact"
                  value={!computed || computed.avgPriceImpact === null ? "—" : <CountUp value={computed.avgPriceImpact} suffix="%" decimals={2} />}
                  sub="live 10-unit reference trade"
                  delay={0.42}
                />
              </div>
            </section>

            {/* Everything below (Protocol Health rings, glance panel,
                per-token breakdown) is derived from the fast section's
                supply/pool/price data - skip it gracefully rather than
                crash if that section hasn't resolved (or failed) while the
                activity section above is what's actually rendering. */}
            {computed && (
              <>
                <section className="an-section">
                  <h2 className="an-section-heading">Protocol Health</h2>
                  <p className="an-section-sub">Derived ratios, computed live from the numbers above.</p>
                  {/* No real historical/bucketed volume data is scanned anywhere in
                      useAnalytics, so there's nothing honest to plot as a line/bar
                      chart here - these derived-percentage rings are the real
                      visual centerpiece instead of a fabricated time series. */}
                  <div className="an-health-layout">
                    <div className="an-ring-grid">
                      <RingProgress percent={computed.faucetUtilizationPct} label="Faucet Reserve Remaining" color="#facc15" />
                      <RingProgress percent={computed.liquidityUtilizationPct} label="Liquidity Utilization" color="#a855f7" />
                      <RingProgress percent={computed.distributionPct} label="Token Distribution" color="#22d3ee" />
                      <RingProgress percent={computed.poolHealthPct} label="Pool Health" color="#34d399" />
                    </div>

                    <GlassCard pad="lg" className="an-glance-panel">
                      <div className="an-glance-header">At a Glance</div>
                      {[
                        { label: "Block Number", value: data?.blockNumber ? `#${data.blockNumber.toLocaleString()}` : "—" },
                        { label: "Network", value: networkOnline ? "Live · Sepolia" : "Offline" },
                        { label: "Total Value Locked", value: `$${formatCompact(computed.tvl, { decimals: 2 })}` },
                        { label: "Liquidity Pools", value: computed.totalPools },
                        {
                          label: "Fee Tiers",
                          value: computed.feeTiers.map((f) => `${(f / 10000).toFixed(2)}%`).join(" / "),
                        },
                        {
                          label: "Avg. Price Impact",
                          value: computed.avgPriceImpact === null ? "—" : `${computed.avgPriceImpact.toFixed(2)}%`,
                        },
                        { label: "Faucet Reserve", value: `${formatCompact(computed.faucetReserveTokens, { decimals: 2 })} tokens` },
                        {
                          label: "Data Completeness",
                          value:
                            swapLoading || mintLoading || faucetLoading
                              ? "Scanning…"
                              : stats.dataIncomplete
                              ? "Partial (rate-limited)"
                              : "Complete",
                        },
                      ].map((row) => (
                        <div className="an-glance-row" key={row.label}>
                          <span className="an-glance-label">{row.label}</span>
                          <span className="an-glance-value">{row.value}</span>
                        </div>
                      ))}
                    </GlassCard>
                  </div>
                </section>

                <section className="an-section">
                  <h2 className="an-section-heading">Per-Token Breakdown</h2>
                  <p className="an-section-sub">Individual stats for each Nexora token.</p>
                  <div className="an-token-grid">
                    {analyticsConfig.tokens.map((t, i) => {
                      const tokenMeta = tokenList.find((x) => x.ticker === t.ticker);
                      const pt = computed.perToken[t.ticker];
                      return (
                    <motion.div
                      key={t.ticker}
                      initial={{ opacity: 0, y: 24 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-30px" }}
                      transition={{ duration: 0.45, delay: i * 0.06 }}
                      className="an-glass an-token-card"
                    >
                      <div className="an-token-head">
                        {tokenMeta?.img && <img src={tokenMeta.img} alt={t.ticker} className="an-token-icon" />}
                        <div>
                          <div className="an-token-name">
                            <Link to={`/explorer/${t.ticker}`} style={{ color: "inherit", textDecoration: "none" }}>
                              {t.name} ({t.ticker})
                            </Link>
                          </div>
                          <div className="an-token-addr" title={t.address}>{t.address.slice(0, 10)}...{t.address.slice(-6)}</div>
                        </div>
                      </div>
                      <div className="an-token-rows">
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Symbol</div>
                          <div className="an-token-stat-value">{t.ticker}</div>
                        </div>
                        <div className="an-token-stat an-token-stat-wide">
                          <div className="an-token-stat-label">Contract Address</div>
                          <div className="an-token-stat-value an-token-stat-mono" title={t.address}>{t.address}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Total Supply</div>
                          <div className="an-token-stat-value">{formatCompact(pt.totalSupply)}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Circulating</div>
                          <div className="an-token-stat-value">{formatCompact(pt.circulatingSupply)}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Current Liquidity</div>
                          <div className="an-token-stat-value">{formatCompact(pt.liquidityAvailable, { decimals: 2 })}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Faucet Reserve</div>
                          <div className="an-token-stat-value">{formatCompact(pt.faucetReserve, { decimals: 2 })}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Total Claims</div>
                          <div className="an-token-stat-value">{faucetLoading ? "…" : pt.claims === null ? "—" : pt.claims}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Total Swaps</div>
                          <div className="an-token-stat-value">{swapLoading ? "…" : pt.swaps === null ? "—" : pt.swaps}</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Network</div>
                          <div className="an-token-stat-value">Sepolia</div>
                        </div>
                        <div className="an-token-stat">
                          <div className="an-token-stat-label">Fee Tier</div>
                          <div className="an-token-stat-value">
                            {pt.feeTiers.length ? pt.feeTiers.map((f) => `${(f / 10000).toFixed(2)}%`).join(" / ") : "—"}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
                </section>
              </>
            )}

            <section className="an-section">
              <h2 className="an-section-heading">Top Pools</h2>
              <p className="an-section-sub">The Uniswap V3 pools backing Nexora's liquidity — browse all of them on the Pools page.</p>
              <div className="an-token-grid">
                {analyticsConfig.pools.slice(0, 4).map((p) => (
                  <Link
                    key={p.pair}
                    to={`/pools?pair=${encodeURIComponent(p.pair)}`}
                    className="an-glass an-token-card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div className="an-token-head">
                      <div>
                        <div className="an-token-name">{p.pair}</div>
                        <div className="an-token-addr" title={p.address}>{p.address.slice(0, 10)}...{p.address.slice(-6)}</div>
                      </div>
                    </div>
                    <div className="an-token-stat">
                      <div className="an-token-stat-label">Fee Tier</div>
                      <div className="an-token-stat-value">{(p.fee / 10000).toFixed(2)}%</div>
                    </div>
                  </Link>
                ))}
              </div>
              <div style={{ textAlign: "center", marginTop: 18 }}>
                <Link to="/pools" className="nx-btn nx-btn-secondary nx-btn-sm">View all pools →</Link>
              </div>
            </section>

            <p className="an-footnote">
              Every number above is read live from the deployed contracts and Sepolia blockchain state — total
              supply and balances via direct contract calls, swap/liquidity/claim counts via on-chain event logs.
              Nothing here is simulated or historical price data.
              {stats.dataIncomplete && " Some event-log figures may be temporarily incomplete due to RPC rate limits — hit Refresh to retry."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
