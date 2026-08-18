import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import ThreeDBackground from "./ui/ThreeDBackground";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import StatCard from "./ui/StatCard";
import PrimaryButton from "./ui/PrimaryButton";
import SecondaryButton from "./ui/SecondaryButton";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import { useAnalytics, DEFAULT_SEPOLIA_RPC_URL } from "../hooks/useAnalytics";
import "./Home.css";

// Configurable via REACT_APP_SEPOLIA_RPC_URL (.env) - falls back to the
// public endpoint otherwise. See useAnalytics.js for why REACT_APP_ (not
// VITE_) is the correct prefix for this Create React App project.
const RPC_URL = DEFAULT_SEPOLIA_RPC_URL;
const swappableTokens = tokenList.filter((t) => t.sepoliaAddress);
const ERC20_ABI = ["function balanceOf(address owner) external view returns (uint256)"];

const PREDEFINED_PRICES = {
  NOVA: 10000,
  FSN: 7500,
  VRTX: 5000,
  ORBT: 2500,
  USDC: 1.0,
};

function formatHeroBalance(num) {
  if (num === null || num === undefined || isNaN(num)) return "USD valuation unavailable";
  if (num === 0) return "$0.00";
  if (num >= 1e12) return `$${(num / 1e12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}T`;
  if (num >= 1e9) return `$${(num / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
  if (num >= 1e6) return `$${(num / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return "—";
  if (num === 0) return "$0.00";
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return "—";
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toLocaleString();
}

const STEPS = [
  {
    title: "Connect your wallet",
    desc: "Link MetaMask on the Sepolia testnet — no signup, no custody, you stay in control of your keys.",
  },
  {
    title: "Swap or provide liquidity",
    desc: "Trade across live Uniswap V3 pools with real quotes, or browse pool data before committing capital.",
  },
  {
    title: "Track everything on-chain",
    desc: "Every swap, claim, and balance shown in Nexora is read directly from Sepolia — nothing is simulated.",
  },
];

function Home(props) {
  const account = useAccount();
  const isConnected = props.isConnected ?? account.isConnected;
  const address = props.address ?? account.address;

  const { data, loading: analyticsLoading, swapStats, swapLoading } = useAnalytics(RPC_URL);

  const [walletBalanceUsd, setWalletBalanceUsd] = useState(null);
  const [hasUnpricedTokens, setHasUnpricedTokens] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const fetchWalletPortfolio = useCallback(async () => {
    if (!isConnected || !address || !window.ethereum) {
      setWalletBalanceUsd(null);
      setHasUnpricedTokens(false);
      return;
    }
    setBalanceLoading(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const [rawEth, ...rawTokenBalances] = await Promise.all([
        provider.getBalance(address),
        ...swappableTokens.map((t) =>
          new ethers.Contract(t.sepoliaAddress, ERC20_ABI, provider).balanceOf(address)
        ),
      ]);

      const ethBal = Number(ethers.utils.formatEther(rawEth));
      const livePrices = data?.pricesUsd || {};

      let totalUsd = 0;
      let unpriced = false;

      if (ethBal > 0) {
        const ethPrice = livePrices["ETH"] ?? null;
        if (ethPrice !== null) {
          totalUsd += ethBal * ethPrice;
        } else {
          unpriced = true;
        }
      }

      swappableTokens.forEach((token, i) => {
        const formatted = Number(ethers.utils.formatUnits(rawTokenBalances[i], token.decimals));
        if (formatted > 0) {
          if (PREDEFINED_PRICES[token.ticker] !== undefined) {
            totalUsd += formatted * PREDEFINED_PRICES[token.ticker];
          } else {
            const tokenPrice = livePrices[token.ticker] ?? null;
            if (tokenPrice !== null) {
              totalUsd += formatted * tokenPrice;
            } else {
              unpriced = true;
            }
          }
        }
      });

      setWalletBalanceUsd(totalUsd);
      setHasUnpricedTokens(unpriced);
    } catch (err) {
      console.error("Failed to fetch wallet USD balance:", err);
      setWalletBalanceUsd(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [isConnected, address, data?.pricesUsd]);

  useEffect(() => {
    if (isConnected && address) {
      fetchWalletPortfolio();
    } else {
      setWalletBalanceUsd(null);
      setHasUnpricedTokens(false);
    }
  }, [isConnected, address, fetchWalletPortfolio]);

  const tvlValue = data?.pools
    ? (() => {
        const validPools = data.pools.filter((p) => p.valueUsd !== null);
        if (validPools.length === 0) return "—";
        const sum = validPools.reduce((s, p) => s + p.valueUsd, 0);
        return formatCurrency(sum);
      })()
    : analyticsLoading
    ? "…"
    : "—";

  // Total Swaps / Active Wallets / 24H Volume all come purely from the Swap
  // scan (swapStats/swapLoading) - none of them need Mint or Faucet data at
  // all, so they render the instant the Swap scan itself resolves instead
  // of waiting on the (often slower) Mint/Faucet scans too.
  const swapsValue =
    swapStats && !swapStats.swapDataIncomplete ? formatNumber(swapStats.totalSwaps) : swapLoading ? "…" : "—";

  const walletsValue =
    swapStats && !swapStats.swapDataIncomplete
      ? formatNumber(swapStats.uniqueActiveWalletsCount)
      : swapLoading
      ? "…"
      : "—";

  const volume24hValue =
    swapStats && !swapStats.swapDataIncomplete ? formatCurrency(swapStats.volume24hUsd) : swapLoading ? "…" : "—";

  const activePoolsDisplay = data?.pools ? data.pools.length : analyticsConfig.pools.length;

  return (
    <div style={{ position: "relative" }}>
      <ThreeDBackground intensity={5} layout="pedestalFlow" fixed={true} />
      <section className="nx-home-hero">
        <svg className="nx-home-hero-swoosh" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="nxSwooshGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0" />
              <stop offset="50%" stopColor="#6d5efc" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 60 120 Q 600 260 1140 120" fill="none" stroke="url(#nxSwooshGrad)" strokeWidth="3.5" />
        </svg>

        <div className="nx-home-hero-split">
          <div className="nx-home-hero-copy">
            <div className="nx-eyebrow">
              <span className="nx-eyebrow-dot" />
              ⚡ POWERING THE NEXT FINANCIAL ERA
            </div>
            <h1 className="nx-home-title">
              THE NEW STANDARD<br />
              OF <span className="nx-home-title-accent">DIGITAL FINANCE</span><br />
              FOR EVERYONE.
            </h1>
            <p className="nx-home-sub">
              Where your digital assets are protected with advanced security, and your financial future is confidently secured — built on real Uniswap V3 Sepolia Infrastructure.
            </p>
            <div className="nx-home-cta-row">
              <Link to="/swap">
                <PrimaryButton>Get Started →</PrimaryButton>
              </Link>
              <Link to="/chart">
                <SecondaryButton>View Analytics</SecondaryButton>
              </Link>
            </div>
          </div>

          <div className="nx-home-wallet-column">
            <div className="nx-home-wallet-stack">
              <div className="nx-home-wallet-card">
                <div className="nx-home-wallet-top">
                  <span className="nx-home-wallet-name">{isConnected ? "Connected Wallet" : "Sepolia Wallet"}</span>
                  <span className="nx-home-live-dot" style={{ opacity: isConnected ? 1 : 0.6 }}>
                    <span className="nx-home-live-dot-inner" style={!isConnected ? { background: "#888", boxShadow: "none" } : undefined} />{" "}
                    {isConnected && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not Connected"}
                  </span>
                </div>
                <div className="nx-home-wallet-balance-label">BALANCE</div>
                <div className="nx-home-wallet-balance-value">
                  {(() => {
                    const balanceText = balanceLoading
                      ? "…"
                      : !isConnected
                      ? "Not connected"
                      : hasUnpricedTokens && (walletBalanceUsd === null || walletBalanceUsd === 0)
                      ? "USD valuation unavailable"
                      : walletBalanceUsd !== null
                      ? formatHeroBalance(walletBalanceUsd)
                      : "USD valuation unavailable";

                    const fullHover = walletBalanceUsd !== null
                      ? `$${walletBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : balanceText;

                    const dynamicFont = balanceText.length > 20
                      ? { fontSize: "1.15rem" }
                      : balanceText.length > 14
                      ? { fontSize: "1.35rem" }
                      : balanceText.length > 10
                      ? { fontSize: "1.65rem" }
                      : undefined;

                    return (
                      <span className="nx-home-wallet-balance-text" style={dynamicFont} title={fullHover}>
                        {balanceText}
                      </span>
                    );
                  })()}
                  <span className="nx-home-green-tag" style={{ opacity: 0.6, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}>
                    —
                  </span>
                </div>
                <div className="nx-home-live-rows">
                  <div className="nx-home-live-row">
                    <span>Supported Tokens</span>
                    <strong>{swappableTokens.length}</strong>
                  </div>
                  <div className="nx-home-live-row">
                    <span>Active Pools</span>
                    <strong>{activePoolsDisplay}</strong>
                  </div>
                  <div className="nx-home-live-row">
                    <span>Network</span>
                    <strong>Sepolia</strong>
                  </div>
                </div>
                <Link to="/chart" className="nx-home-live-card-link">
                  View full analytics →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="nx-home-snapshot-wrap" style={{ width: "100%", maxWidth: 1080, margin: "64px auto 0", textAlign: "center" }}>
          <div className="nx-eyebrow" style={{ display: "inline-flex", marginBottom: 16 }}>
            <span className="nx-eyebrow-dot" />
            LIVE SEPOLIA SNAPSHOT
          </div>
          <div className="nx-home-stats" style={{ marginTop: 0 }}>
            <StatCard label="TOTAL VALUE LOCKED" value={tvlValue} icon="📈" glow />
            <StatCard label="TOTAL SWAPS" value={swapsValue} icon="🔄" glow />
            <StatCard label="ACTIVE WALLETS" value={walletsValue} icon="👥" glow />
            <StatCard label="24H VOLUME" value={volume24hValue} icon="📊" glow />
          </div>
        </div>
      </section>

      <section className="nx-home-section">
        <h2 className="nx-section-heading">Supported Tokens</h2>
        <p className="nx-section-sub">Every asset below is swappable today with a real Sepolia contract address.</p>
        <div className="nx-home-tokens-grid">
          {swappableTokens.map((t) => (
            <GlassCard key={t.ticker} hoverable tilt pad="sm" className="nx-home-token-chip">
              <TokenIcon symbol={t.ticker} src={t.img} size={34} />
              <div>
                <div className="nx-token-symbol">{t.ticker}</div>
                <div className="nx-token-name">{t.name}</div>
              </div>
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="nx-home-section">
        <h2 className="nx-section-heading">Featured Pools</h2>
        <p className="nx-section-sub">A sample of the Uniswap V3 pools seeded on Nexora — browse all of them on the Pools page.</p>
        <div className="nx-home-tokens-grid">
          {analyticsConfig.pools.slice(0, 4).map((p) => (
            <Link key={p.pair} to={`/pools?pair=${encodeURIComponent(p.pair)}`} style={{ textDecoration: "none" }}>
              <GlassCard hoverable tilt pad="sm" className="nx-home-token-chip">
                <TokenIcon symbol={p.tokenA} size={34} />
                <div>
                  <div className="nx-token-symbol">{p.pair}</div>
                  <div className="nx-token-name">Fee {p.fee / 10000}%</div>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      </section>

      <section className="nx-home-section">
        <h2 className="nx-section-heading">How Nexora Works</h2>
        <p className="nx-section-sub">Three steps from wallet to on-chain trade.</p>
        <div className="nx-home-steps">
          {STEPS.map((s, i) => (
            <GlassCard key={s.title} hoverable pad="md">
              <div className="nx-home-step-num">{String(i + 1).padStart(2, "0")}</div>
              <div className="nx-home-step-title">{s.title}</div>
              <div className="nx-home-step-desc">{s.desc}</div>
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="nx-home-section">
        <GlassCard glow pad="lg" className="nx-home-final-cta">
          <h2 className="nx-section-heading" style={{ marginBottom: 4 }}>Ready to trade on Nexora?</h2>
          <p className="nx-section-sub">Connect your wallet and swap your first pair in seconds.</p>
          <Link to="/swap" className="nx-btn nx-btn-primary">
            Launch App →
          </Link>
        </GlassCard>
      </section>
    </div>
  );
}

export default Home;


