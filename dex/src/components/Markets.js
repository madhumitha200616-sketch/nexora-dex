import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import tokenList from "../tokenList.json";
import { useMarketData } from "../hooks/useMarketData";
import { filterByWindow, priceChangePct, bucketSecondsFor, buildOhlcRows } from "../utils/marketMath";
import MarketChart from "./MarketChart";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import StatCard from "./ui/StatCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import "./Markets.css";

// Only real, externally-traded assets appear here - the Nexora demo tokens
// (NOVA/FSN/VRTX/ORBT) use predefined reference prices with no real market,
// so they are deliberately excluded entirely. Each token is quoted against
// USDC as the closest thing to a USD reference on-chain, except USDC
// itself, which is quoted against WETH since it can't be priced against
// itself.
const REAL_TOKENS_CONFIG = [
  { ticker: "WETH", quote: "USDC" },
  { ticker: "LINK", quote: "USDC" },
  { ticker: "USDC", quote: "WETH" },
];

// 7D/1M were removed - the historical scan (useMarketData.js's
// MAX_RANGE_BLOCKS) only ever covers ~3 days of real Swap events on this
// testnet, so those windows had no real baseline trade to anchor a change
// %/chart/table against and just showed "-" or near-empty data. 24H is the
// one window this data genuinely supports.
const TIMEFRAME = { key: "24H", label: "24H", seconds: 24 * 3600 };

function fmt(n, decimals = 6) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function changeClass(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return n >= 0 ? "marketsCellUp" : "marketsCellDown";
}

function formatRowTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Markets() {
  const [tokenIndex, setTokenIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const active = REAL_TOKENS_CONFIG[tokenIndex];
  const baseToken = tokenList.find((t) => t.ticker === active.ticker);
  const quoteToken = tokenList.find((t) => t.ticker === active.quote);
  const timeframe = TIMEFRAME;

  const { loading, error, poolInfo, trades, spotPrice, liquidityBase, liquidityQuote } = useMarketData(
    baseToken,
    quoteToken,
    reloadKey
  );

  const chartPoints = useMemo(() => filterByWindow(trades, timeframe.seconds), [trades, timeframe]);
  const dayTrades = useMemo(() => filterByWindow(trades, 24 * 3600), [trades]);
  const rows = useMemo(() => buildOhlcRows(chartPoints, bucketSecondsFor(timeframe.key)), [chartPoints, timeframe]);

  const currentPrice = trades.length ? trades[trades.length - 1].price : spotPrice;
  const change24h = priceChangePct(trades, 24 * 3600);

  const dayHigh = dayTrades.length ? Math.max(...dayTrades.map((t) => t.price)) : null;
  const dayLow = dayTrades.length ? Math.min(...dayTrades.map((t) => t.price)) : null;
  const dayVolume = dayTrades.reduce((sum, t) => sum + t.volumeQuote, 0);
  const dayTradeCount = dayTrades.length;

  const tvlQuote =
    liquidityBase !== null && liquidityQuote !== null && currentPrice !== null
      ? liquidityBase * currentPrice + liquidityQuote
      : null;

  const isUp = change24h === null ? true : change24h >= 0;

  return (
    <PageShell
      eyebrow="Live Sepolia Markets"
      title="Markets"
      subtitle="Live on-chain market data for real Sepolia assets. NOVA, FSN, VRTX and ORBT use predefined reference prices and are not shown here."
      background={<ThreeDBackground intensity={3} />}
      contentClassName="marketsPage"
    >
      {!loading && !error && (
        <div className="marketsKpiRow">
          <StatCard
            label="Current Price"
            value={`${fmt(currentPrice)} ${quoteToken.ticker}`}
            glow
          />
          <StatCard
            label="24h Change"
            value={fmtPct(change24h)}
            trend={change24h === null ? "neutral" : change24h >= 0 ? "up" : "down"}
            trendLabel={change24h === null ? undefined : change24h >= 0 ? "Up" : "Down"}
            glow
          />
          <StatCard label="24h Volume" value={`${fmt(dayVolume, 2)} ${quoteToken.ticker}`} glow />
          <StatCard label="TVL" value={`${fmt(tvlQuote, 2)} ${quoteToken.ticker}`} glow />
        </div>
      )}

      <div className="marketsTokenTabs">
        {REAL_TOKENS_CONFIG.map((cfg, i) => {
          const t = tokenList.find((x) => x.ticker === cfg.ticker);
          return (
            <button
              key={cfg.ticker}
              className={i === tokenIndex ? "marketsTokenTab marketsTokenTabActive" : "marketsTokenTab"}
              onClick={() => setTokenIndex(i)}
            >
              <img src={t.img} alt={cfg.ticker} className="marketsTokenTabIcon" />
              {cfg.ticker}
            </button>
          );
        })}
      </div>

      {loading && <div className="marketsLoading">Loading {active.ticker} market data from Sepolia...</div>}
      {!loading && error === "no-pool" && (
        <div className="marketsLoading">
          No Uniswap V3 pool found for {active.ticker}/{active.quote} on Sepolia.
        </div>
      )}
      {!loading && error === "load-failed" && (
        <div className="marketsErrorBox">
          <div className="marketsErrorTitle">Unable to load Sepolia market data</div>
          <div className="marketsErrorSub">
            The RPC node didn't respond in time. This can happen on a busy public testnet endpoint.
          </div>
          <button className="marketsRetryBtn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="marketsLayout">
          <div className="marketsMainCol">
            <GlassCard pad="lg" className="marketsChartCard">
              <div className="marketsChartCardHeader">
                <div className="marketsPairInfo">
                  <img src={baseToken.img} alt={baseToken.ticker} className="marketsPairIcon" />
                  <div>
                    <div className="marketsPairName">
                      {baseToken.ticker} / {quoteToken.ticker}
                    </div>
                    <div className="marketsPairFee">{(poolInfo.fee / 10000).toFixed(2)}% pool · Sepolia</div>
                  </div>
                  <Link to="/swap" className="nx-swap-view-pool">Swap this pair →</Link>
                </div>
                <div className="marketsTimeframeTabs">
                  <span className="marketsTfBtn marketsTfBtnActive">{TIMEFRAME.label}</span>
                </div>
              </div>

              <div className="marketsStatRow">
                <div className="marketsBigPrice">
                  {fmt(currentPrice)} <span>{quoteToken.ticker}</span>
                </div>
                {change24h !== null && (
                  <div className={`marketsChangePill ${change24h >= 0 ? "marketsChangeUp" : "marketsChangeDown"}`}>
                    {change24h >= 0 ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}% (24h)
                  </div>
                )}
                <div className="marketsMiniStat">
                  <span>24h High</span>
                  {fmt(dayHigh)}
                </div>
                <div className="marketsMiniStat">
                  <span>24h Low</span>
                  {fmt(dayLow)}
                </div>
                <div className="marketsMiniStat">
                  <span>24h Volume</span>
                  {fmt(dayVolume, 2)} {quoteToken.ticker}
                </div>
                <div className="marketsMiniStat">
                  <span>Trades</span>
                  {dayTradeCount}
                </div>
              </div>

              <MarketChart points={chartPoints} timeframeKey={timeframe.key} isUp={isUp} />
            </GlassCard>

            <GlassCard pad="lg" className="marketsTableCard">
              <div className="marketsTableTitle">Historical Data</div>
              {rows.length === 0 ? (
                <div className="marketsLoading">No trades recorded in this window yet.</div>
              ) : (
                <div className="marketsTableScroll">
                  <table className="marketsTable">
                    <thead>
                      <tr>
                        <th>Date / Time</th>
                        <th>Open</th>
                        <th>High</th>
                        <th>Low</th>
                        <th>Close</th>
                        <th>Change</th>
                        <th>Change %</th>
                        <th>Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.timestamp}>
                          <td>{formatRowTime(r.timestamp)}</td>
                          <td>{fmt(r.open)}</td>
                          <td>{fmt(r.high)}</td>
                          <td>{fmt(r.low)}</td>
                          <td>{fmt(r.close)}</td>
                          <td className={changeClass(r.change)}>{r.change === null ? "—" : fmt(r.change)}</td>
                          <td className={changeClass(r.changePct)}>{fmtPct(r.changePct)}</td>
                          <td>{fmt(r.volume, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </div>

          <div className="marketsSideCol" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <GlassCard pad="md" className="marketsSidePanel">
              <div className="marketsSidePanelTitle">Watchlist (Sepolia Assets)</div>
              {REAL_TOKENS_CONFIG.map((cfg, i) => {
                const t = tokenList.find((x) => x.ticker === cfg.ticker);
                return (
                  <div
                    key={cfg.ticker}
                    className="marketsWatchlistRow"
                    style={{
                      display: "flex",
                      justify: "space-between",
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom: i < REAL_TOKENS_CONFIG.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      cursor: "pointer",
                    }}
                    onClick={() => setTokenIndex(i)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TokenIcon symbol={cfg.ticker} src={t?.img} size={22} />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{t?.name || cfg.ticker}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{cfg.ticker} / {cfg.quote}</div>
                      <span style={{ color: "#7dd3fc", fontSize: 11, fontWeight: 700 }}>On-Chain</span>
                    </div>
                  </div>
                );
              })}
            </GlassCard>

            <GlassCard pad="md" className="marketsSidePanel">
              <div className="marketsSidePanelTitle">Instant Trade</div>
              <div style={{ marginBottom: 12, marginTop: 10 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", color: "rgba(232,235,247,0.5)", marginBottom: 6, fontWeight: 700 }}>Amount</div>
                <input className="nx-pools-search" placeholder={`0.5 ${baseToken.ticker}`} style={{ width: "100%", boxSizing: "border-box" }} />
              </div>
              <Link to={`/swap?from=${baseToken.ticker}&to=${quoteToken.ticker}`} className="nx-btn nx-btn-primary nx-btn-sm nx-btn-full" style={{ marginTop: 4 }}>
                Place Order ↗
              </Link>
            </GlassCard>

            <GlassCard pad="md" className="marketsSidePanel">
              <div className="marketsSidePanelTitle">Market Details</div>
              <div className="marketsSideRow">
                <span>Current Price</span>
                <strong>
                  {fmt(currentPrice)} {quoteToken.ticker}
                </strong>
              </div>
              <div className="marketsSideRow">
                <span>Change (24h)</span>
                <strong className={changeClass(change24h)}>{fmtPct(change24h)}</strong>
              </div>
              <div className="marketsSideDivider" />
              <div className="marketsSideRow">
                <span>Liquidity ({baseToken.ticker})</span>
                <strong>{fmt(liquidityBase, 4)}</strong>
              </div>
              <div className="marketsSideRow">
                <span>Liquidity ({quoteToken.ticker})</span>
                <strong>{fmt(liquidityQuote, 2)}</strong>
              </div>
              <div className="marketsSideRow">
                <span>TVL (in {quoteToken.ticker})</span>
                <strong>{fmt(tvlQuote, 2)}</strong>
              </div>
              <div className="marketsSideRow">
                <span>Pool Fee</span>
                <strong>{(poolInfo.fee / 10000).toFixed(2)}%</strong>
              </div>
              <div className="marketsSideRow">
                <span>Volume (24h)</span>
                <strong>
                  {fmt(dayVolume, 2)} {quoteToken.ticker}
                </strong>
              </div>
              <div className="marketsSideRow">
                <span>Network</span>
                <strong>Sepolia</strong>
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </PageShell>
  );
}
