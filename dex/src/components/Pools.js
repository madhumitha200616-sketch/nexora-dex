import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import StatCard from "./ui/StatCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import { useAnalytics, DEFAULT_SEPOLIA_RPC_URL } from "../hooks/useAnalytics";
import "./Pools.css";

// Same dedicated RPC endpoint AnalyticsDashboard uses for its multi-address
// eth_getLogs scans (the app's usual REACT_APP_INFURA_URL rejects those) -
// reusing useAnalytics here means Pools shows the exact same real
// TVL/liquidity/health numbers as the Analytics page, not a re-derived copy.
// Configurable via REACT_APP_SEPOLIA_RPC_URL - see useAnalytics.js.
const RPC_URL = DEFAULT_SEPOLIA_RPC_URL;

const SORTS = [
  { key: "tvl", label: "TVL" },
  { key: "fee", label: "Fee Tier" },
  { key: "name", label: "Name" },
];

function tokenImg(ticker) {
  return tokenList.find((t) => t.ticker === ticker)?.img;
}

function Pools() {
  const { data, loading, error, refresh } = useAnalytics(RPC_URL);
  const [params] = useSearchParams();
  const highlightPair = params.get("pair");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("tvl");

  const pools = useMemo(() => data?.pools || [], [data?.pools]);

  const totals = useMemo(() => {
    const validPools = pools.filter((p) => p.valueUsd !== null);
    const tvl = validPools.length > 0 ? validPools.reduce((sum, p) => sum + p.valueUsd, 0) : null;
    return { tvl, count: pools.length };
  }, [pools]);

  const topPool = useMemo(() => {
    if (!pools.length) return null;
    return [...pools].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))[0];
  }, [pools]);

  const featuredPools = useMemo(() => {
    return [...pools].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0)).slice(0, 3);
  }, [pools]);

  const filteredSorted = useMemo(() => {
    let list = pools.filter((p) => p.pair.toLowerCase().includes(query.toLowerCase()));
    list = [...list].sort((a, b) => {
      if (sortKey === "tvl") return (b.valueUsd || 0) - (a.valueUsd || 0);
      if (sortKey === "fee") return a.fee - b.fee;
      return a.pair.localeCompare(b.pair);
    });
    return list;
  }, [pools, query, sortKey]);

  return (
    <PageShell
      eyebrow="Uniswap V3 Liquidity"
      title="Pools"
      subtitle="Browse every Nexora liquidity pool on Sepolia — real on-chain balances, fee tiers, and health."
      background={<ThreeDBackground intensity={4} />}
    >
      <div className="nx-pools-spotlight-layout">
        {topPool && (
          <GlassCard glow pad="lg" className="nx-pools-spotlight">
            <div className="nx-pools-spotlight-label">Deepest Pool Right Now</div>
            <div className="nx-pools-spotlight-pair">
              <div className="nx-pool-icons">
                <TokenIcon symbol={topPool.tokenA} src={tokenImg(topPool.tokenA)} size={46} />
                <TokenIcon symbol={topPool.tokenB} src={tokenImg(topPool.tokenB)} size={46} />
              </div>
              <div>
                <div className="nx-pools-spotlight-name">{topPool.pair}</div>
                <span className="nx-pool-fee-badge">{(topPool.fee / 10000).toFixed(2)}% fee tier</span>
              </div>
            </div>
            <div className="nx-pools-spotlight-value">
              {topPool.valueUsd !== null ? `$${topPool.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            </div>
            <Link to={`/add-liquidity?pair=${encodeURIComponent(topPool.pair)}`} className="nx-btn nx-btn-primary nx-btn-sm">
              Add Liquidity →
            </Link>
          </GlassCard>
        )}
        <div className="nx-pools-stats-col">
          <StatCard label="Total TVL" value={loading ? "…" : totals.tvl !== null ? `$${totals.tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} glow />
          <StatCard label="Total Pools" value={totals.count || (loading ? "…" : 0)} glow />
        </div>
      </div>

      {error && (
        <GlassCard pad="md" style={{ marginBottom: 20 }}>
          Couldn't load live pool data from Sepolia right now.{" "}
          <button className="nx-btn nx-btn-secondary nx-btn-sm" onClick={refresh}>Retry</button>
        </GlassCard>
      )}

      <div className="nx-pools-toolbar">
        <input
          className="nx-pools-search"
          placeholder="Search pools (e.g. NOVA/USDC)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="nx-pools-sort">
          {SORTS.map((s) => (
            <button
              key={s.key}
              className={sortKey === s.key ? "nx-active" : ""}
              onClick={() => setSortKey(s.key)}
            >
              Sort: {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="nx-pools-loading-skeleton" style={{ marginTop: 24 }}>
          <h2 className="nx-section-heading" style={{ textAlign: "left", marginTop: 8 }}>Featured Pools</h2>
          <p className="nx-section-sub" style={{ textAlign: "left" }}>Scanning live Sepolia pool contracts…</p>
          <div className="nx-pools-grid">
            {[1, 2, 3].map((i) => (
              <GlassCard key={i} pad="md" className="nx-pool-card" style={{ opacity: 0.6 }}>
                <div className="nx-pool-card-topline">
                  <div className="nx-pool-icons">
                    <span className="nx-shimmer-circle" style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "inline-block" }} />
                    <span className="nx-shimmer-circle" style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "inline-block", marginLeft: -12 }} />
                  </div>
                  <span className="nx-pool-tvl-pill" style={{ background: "rgba(255,255,255,0.05)", width: 80, height: 22, borderRadius: 12, display: "inline-block" }} />
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", height: 20, width: "60%", borderRadius: 6, marginTop: 14 }} />
                <div style={{ background: "rgba(255,255,255,0.05)", height: 16, width: "40%", borderRadius: 6, marginTop: 8 }} />
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      {!loading && featuredPools.length > 0 && (
        <>
          <h2 className="nx-section-heading" style={{ textAlign: "left", marginTop: 8 }}>Featured Pools</h2>
          <p className="nx-section-sub" style={{ textAlign: "left" }}>The deepest liquidity on Nexora right now.</p>
          <div className="nx-pools-grid">
            {featuredPools.map((p) => (
              <GlassCard
                key={p.address}
                hoverable
                pad="md"
                className={`nx-pool-card ${highlightPair === p.pair ? "nx-pool-highlight" : ""}`}
              >
                <div className="nx-pool-card-topline">
                  <div className="nx-pool-icons">
                    <TokenIcon symbol={p.tokenA} src={tokenImg(p.tokenA)} size={38} />
                    <TokenIcon symbol={p.tokenB} src={tokenImg(p.tokenB)} size={38} />
                  </div>
                  <span className="nx-pool-tvl-pill">
                    {p.valueUsd !== null ? `$${p.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL` : "— TVL"}
                  </span>
                </div>
                <div className="nx-pool-pair-name" style={{ marginTop: 10 }}>{p.pair}</div>
                <span className="nx-pool-fee-badge">{(p.fee / 10000).toFixed(2)}% fee tier</span>

                <span className={`nx-pool-health ${p.healthy ? "nx-healthy" : "nx-unhealthy"}`}>
                  <span>●</span> {p.healthy ? "Pool active" : "No liquidity"}
                </span>

                <div className="nx-pool-actions">
                  <Link to={`/add-liquidity?pair=${encodeURIComponent(p.pair)}`} className="nx-btn nx-btn-primary nx-btn-sm nx-btn-full">
                    Add Liquidity ↗
                  </Link>
                  <Link to="/portfolio" className="nx-btn nx-btn-secondary nx-btn-sm">
                    My Position
                  </Link>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {!loading && (
        <>
          <h2 className="nx-section-heading" style={{ textAlign: "left", marginTop: 36 }}>All Pools</h2>
          <GlassCard pad="sm" className="nx-pools-table-card">
            {filteredSorted.length === 0 ? (
              <div style={{ padding: "28px 8px" }}>No pools match "{query}".</div>
            ) : (
              <div className="nx-pools-table-scroll">
                <table className="nx-pools-table">
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th>Type</th>
                      <th>TVL</th>
                      <th>Volume</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSorted.map((p) => (
                      <tr key={p.address} className={highlightPair === p.pair ? "nx-pools-row-highlight" : ""}>
                        <td>
                          <div className="nx-pools-row-pool">
                            <div className="nx-pool-icons">
                              <TokenIcon symbol={p.tokenA} src={tokenImg(p.tokenA)} size={26} />
                              <TokenIcon symbol={p.tokenB} src={tokenImg(p.tokenB)} size={26} />
                            </div>
                            <span>{p.pair}</span>
                          </div>
                        </td>
                        <td>{(p.fee / 10000).toFixed(2)}%</td>
                        <td>{p.valueUsd !== null ? `$${p.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                        <td>—</td>
                        <td>
                          <div className="nx-pools-row-actions">
                            <Link to={`/add-liquidity?pair=${encodeURIComponent(p.pair)}`} className="nx-btn nx-btn-primary nx-btn-sm">
                              Deposit
                            </Link>
                            <Link to="/portfolio" className="nx-btn nx-btn-secondary nx-btn-sm">
                              Manage
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </>
      )}

      <p className="nx-section-sub" style={{ marginTop: 28 }}>
        Volume isn't tracked per-pool in this build (only aggregate protocol volume — see Analytics), so it's shown
        as unavailable rather than estimated.
      </p>
    </PageShell>
  );
}

export default Pools;
