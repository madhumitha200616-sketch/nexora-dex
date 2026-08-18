import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import "./AddLiquidity.css";
import "./RoutePage.css";

const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

// Same Quoter/Factory addresses and ABIs Swap.js already uses (see
// Swap.js's own comments for why these specific Sepolia addresses, not the
// mainnet ones) - duplicated here rather than imported, matching this
// codebase's existing per-component inline-constants pattern. This page
// visualizes the REAL single-hop path Swap.js would execute for a pair -
// Nexora has no multi-hop routing, so it never shows a fabricated
// intermediate hop just to look more impressive.
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160, uint32, uint256)",
];
const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
const FEE_TIERS = [500, 3000, 10000, 100];

function RoutePage() {
  const [tickerIn, setTickerIn] = useState(SEPOLIA_TOKENS[0].ticker);
  const [tickerOut, setTickerOut] = useState(SEPOLIA_TOKENS[1].ticker);
  const [amountIn, setAmountIn] = useState("1");
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tokenIn = SEPOLIA_TOKENS.find((t) => t.ticker === tickerIn);
  const tokenOut = SEPOLIA_TOKENS.find((t) => t.ticker === tickerOut);

  useEffect(() => {
    if (!tokenIn || !tokenOut || tokenIn.ticker === tokenOut.ticker || !amountIn || Number(amountIn) <= 0) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
        let fee = null;
        for (const f of FEE_TIERS) {
          const pool = await factory.getPool(tokenIn.sepoliaAddress, tokenOut.sepoliaAddress, f);
          if (pool && pool !== ethers.constants.AddressZero) {
            fee = f;
            break;
          }
        }
        if (cancelled) return;
        if (fee === null) {
          setError("No live Sepolia pool exists for this pair on any fee tier.");
          setRoute(null);
          return;
        }
        const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
        const parsedAmountIn = ethers.utils.parseUnits(amountIn, tokenIn.decimals);
        const result = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokenIn.sepoliaAddress,
          tokenOut: tokenOut.sepoliaAddress,
          amountIn: parsedAmountIn,
          fee,
          sqrtPriceLimitX96: 0,
        });
        if (cancelled) return;
        const amountOut = ethers.utils.formatUnits(result.amountOut ?? result[0], tokenOut.decimals);
        setRoute({ fee, amountOut });
      } catch (err) {
        console.error("Route quote failed:", err);
        if (!cancelled) {
          setError("Couldn't fetch a live quote for this pair right now.");
          setRoute(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenIn, tokenOut, amountIn]);

  return (
    <PageShell
      eyebrow="Execution Path"
      title="Find the best route"
      subtitle="The real single-hop path Nexora's Swap would execute for this pair — not a fabricated multi-hop route."
      background={
        <ThreeDBackground
          intensity={4}
          coins={[
            { ticker: tokenIn?.ticker, img: tokenIn?.img },
            { ticker: tokenOut?.ticker, img: tokenOut?.img },
          ]}
        />
      }
    >
      <GlassCard glow pad="lg" className="nx-route-card" tilt>
        <div className="nx-route-rows">
          <div className="nx-al-token-row">
            <div className="nx-route-row-label">You sell</div>
            <TokenIcon symbol={tokenIn?.ticker} src={tokenIn?.img} size={32} />
            <select className="nx-al-token-select" value={tickerIn} onChange={(e) => setTickerIn(e.target.value)}>
              {SEPOLIA_TOKENS.map((t) => (
                <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
              ))}
            </select>
            <input
              className="nx-al-amount-input"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="nx-route-swap-btn"
            aria-label="Reverse direction"
            onClick={() => {
              setTickerIn(tickerOut);
              setTickerOut(tickerIn);
            }}
          >
            ↓↑
          </button>

          <div className="nx-al-token-row">
            <div className="nx-route-row-label">You pay</div>
            <TokenIcon symbol={tokenOut?.ticker} src={tokenOut?.img} size={32} />
            <select className="nx-al-token-select" value={tickerOut} onChange={(e) => setTickerOut(e.target.value)}>
              {SEPOLIA_TOKENS.map((t) => (
                <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
              ))}
            </select>
            <span className="nx-al-amount-input" style={{ color: "var(--nx-text-secondary)" }}>
              {route && !loading ? Number(route.amountOut).toFixed(6) : "—"}
            </span>
          </div>
        </div>

        {loading && <p className="nx-section-sub">Fetching the live route from Sepolia…</p>}
        {error && <p className="nx-section-sub" style={{ color: "var(--nx-red)" }}>{error}</p>}

        {route && !loading && tokenIn && tokenOut && (
          <>
            <div className="nx-al-summary-row">
              <span>Conversion rate</span>
              <strong>
                1 {tokenIn.ticker} = {(Number(route.amountOut) / Number(amountIn)).toFixed(6)} {tokenOut.ticker}
              </strong>
            </div>
            <div className="nx-al-summary-row">
              <span>Fee tier</span>
              <strong>{(route.fee / 10000).toFixed(2)}%</strong>
            </div>
            <div className="nx-al-summary-row">
              <span>Hops</span>
              <strong>1 (direct pool — Nexora doesn't route through intermediates)</strong>
            </div>

            <Link to="/swap" className="nx-btn nx-btn-primary nx-btn-full" style={{ marginTop: 14 }}>
              Execute this swap →
            </Link>
          </>
        )}
      </GlassCard>
    </PageShell>
  );
}

export default RoutePage;
