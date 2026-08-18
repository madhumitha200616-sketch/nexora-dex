import React, { useState } from "react";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import "./AddLiquidity.css";

const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

// Zap (single-token deposit that auto-balances into an LP pair) has no
// underlying contract in this codebase at all - not even the manual
// add-liquidity path AddLiquidity.js previews exists here. This page is
// the UI architecture only, per the "don't fake it" rule: real token/pool
// pickers, no invented preview numbers, action disabled with a clear
// explanation of exactly what's missing.
function Zap() {
  const [ticker, setTicker] = useState(SEPOLIA_TOKENS[0].ticker);
  const [pair, setPair] = useState(analyticsConfig.pools[0].pair);
  const [amount, setAmount] = useState("");

  const token = SEPOLIA_TOKENS.find((t) => t.ticker === ticker);
  const targetPool = analyticsConfig.pools.find((p) => p.pair === pair);
  const otherTicker = targetPool ? (targetPool.tokenA === ticker ? targetPool.tokenB : targetPool.tokenA) : null;
  const otherToken = otherTicker ? SEPOLIA_TOKENS.find((t) => t.ticker === otherTicker) : null;

  return (
    <PageShell
      eyebrow="One-Click Liquidity"
      title="Zap"
      subtitle="Deposit a single token and split it into an LP pair automatically — once a Zap router is deployed."
      background={
        <ThreeDBackground
          intensity={4}
          coins={[
            { ticker: token?.ticker, img: token?.img },
            otherToken ? { ticker: otherToken.ticker, img: otherToken.img } : null,
          ].filter(Boolean)}
        />
      }
    >
      <GlassCard glow pad="lg" className="nx-al-card" tilt>
        <div className="nx-al-summary-row" style={{ paddingBottom: 2 }}>
          <span>You deposit</span>
        </div>
        <div className="nx-al-token-row">
          <TokenIcon symbol={token?.ticker} src={token?.img} size={32} />
          <select className="nx-al-token-select" value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {SEPOLIA_TOKENS.map((t) => (
              <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
            ))}
          </select>
          <input className="nx-al-amount-input" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="nx-al-summary-row">
          <span>Target Pool</span>
          <select
            className="nx-al-token-select"
            style={{ fontSize: 13 }}
            value={pair}
            onChange={(e) => setPair(e.target.value)}
          >
            {analyticsConfig.pools.map((p) => (
              <option key={p.pair} value={p.pair}>{p.pair}</option>
            ))}
          </select>
        </div>
        <div className="nx-al-summary-row">
          <span>Fee Tier</span>
          <strong>{targetPool ? `${(targetPool.fee / 10000).toFixed(2)}%` : "—"}</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Estimated Split</span>
          <strong>—</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Price Impact</span>
          <strong>—</strong>
        </div>

        <button className="nx-btn nx-btn-primary nx-btn-full" style={{ marginTop: 14 }} disabled title="No Zap router deployed">
          Zap Into Pool
        </button>

        <div className="nx-al-banner">
          Zap requires a router contract that splits and deposits a single token automatically — Nexora doesn't
          have one deployed yet. This page shows the intended flow with real tokens and pools, but the action is
          disabled rather than simulating a swap-and-deposit that wouldn't actually happen on-chain.
        </div>
      </GlassCard>
    </PageShell>
  );
}

export default Zap;
