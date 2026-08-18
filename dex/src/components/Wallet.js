import React, { useState, useEffect } from 'react'
import { ethers } from "ethers";
import { message } from "antd";
import { Link } from "react-router-dom";
import { CopyOutlined, CheckOutlined, LogoutOutlined } from "@ant-design/icons";
import tokenList from "../tokenList.json";
import Sepolia from "../sepolia-badge.png";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import EmptyState from "./ui/EmptyState";
import ThreeDBackground from "./ui/ThreeDBackground";
import "./Wallet.css";

// Same "only tokens with a real Sepolia contract" filter used by Tokens.js -
// these are the only balances worth showing since they're the only tokens
// this app can actually swap.
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)"
];

function Wallet({ isConnected, address, disconnect }) {
  const [ethBalance, setEthBalance] = useState(null);
  const [tokenBalances, setTokenBalances] = useState({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setEthBalance(null);
      setTokenBalances({});
      return;
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  async function fetchAll() {
    setLoading(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);

      // ETH balance + every swappable token's balance, all fetched at once
      // instead of one after another - same pattern used to speed up the
      // Tokens and Wrap pages.
      const [rawEth, ...rawTokenBalances] = await Promise.all([
        provider.getBalance(address),
        ...SEPOLIA_TOKENS.map((token) =>
          new ethers.Contract(token.sepoliaAddress, ERC20_ABI, provider).balanceOf(address)
        ),
      ]);

      setEthBalance(ethers.utils.formatEther(rawEth));

      const balances = {};
      SEPOLIA_TOKENS.forEach((token, i) => {
        balances[token.ticker] = ethers.utils.formatUnits(rawTokenBalances[i], token.decimals);
      });
      setTokenBalances(balances);
    } catch (err) {
      console.error("Failed to load wallet balances:", err);
    } finally {
      setLoading(false);
    }
  }

  function copyAddress() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      message.success("Address copied");
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      message.error("Couldn't copy - copy it manually from below.");
    });
  }

  function handleDisconnect() {
    disconnect();
    message.info("Wallet disconnected");
  }

  // Presentation-only derived list - same balances already in state above,
  // just shaped into rows for the holdings list (no new fetch, no invented
  // fields).
  const holdings = [
    { ticker: "ETH", name: "Ethereum", balance: ethBalance !== null ? Number(ethBalance) : null, img: null },
    ...SEPOLIA_TOKENS.map((t) => ({
      ticker: t.ticker,
      name: t.name,
      balance: tokenBalances[t.ticker] !== undefined ? Number(tokenBalances[t.ticker]) : null,
      img: t.img,
    })),
  ];

  if (!isConnected || !address) {
    return (
      <PageShell
        eyebrow="Your Wallet"
        title="Wallet"
        subtitle="Connect your wallet to see your live Nexora balance and holdings."
        background={<ThreeDBackground intensity={3} />}
      >
        <EmptyState
          icon="👛"
          title="Wallet not connected"
          description="Connect MetaMask (top right) to view your dashboard."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Your Wallet"
      title="Wallet"
      subtitle="Real balances read live from Sepolia."
      background={<ThreeDBackground intensity={3} />}
    >
      <div className="nx-wallet-layout">
        <div className="nx-wallet-card">
          <div className="nx-wallet-card-glow" />
          <div className="nx-wallet-card-top">
            <span className="nx-wallet-card-label">Nexora Wallet</span>
            <span className="nx-wallet-network">
              <img src={Sepolia} alt="sepolia" />
              Sepolia
            </span>
          </div>

          <div className="nx-wallet-address-row">
            <span className="nx-wallet-address">{address.slice(0, 6)}...{address.slice(-4)}</span>
            <button className="nx-wallet-copy-btn" onClick={copyAddress} aria-label="Copy address">
              {copied ? <CheckOutlined /> : <CopyOutlined />}
            </button>
          </div>

          <div className="nx-wallet-balance-label">Balance</div>
          <div className="nx-wallet-balance-value">
            {ethBalance !== null ? `${Number(ethBalance).toFixed(5)}` : (loading ? "…" : "0.00000")}
            <span className="nx-wallet-balance-unit">ETH</span>
          </div>

          <div className="nx-wallet-card-status">
            <span className="walletDot"></span> Connected
          </div>

          <button className="nx-wallet-disconnect-btn" onClick={handleDisconnect}>
            <LogoutOutlined /> Disconnect
          </button>
        </div>

        <GlassCard pad="md" className="nx-wallet-holdings-card">
          <div className="nx-wallet-holdings-header">
            <h3 className="nx-section-heading" style={{ textAlign: "left", margin: 0 }}>Holdings</h3>
            <Link to="/portfolio" className="nx-wallet-portfolio-link">View full Portfolio →</Link>
          </div>
          <div className="nx-wallet-holdings-list">
            {loading && holdings.every((h) => h.balance === null) && (
              <div className="nx-wallet-loading">Loading balances…</div>
            )}
            {holdings.map((h) => (
              <div key={h.ticker} className="nx-wallet-holding-row">
                <TokenIcon symbol={h.ticker} src={h.img} size={36} />
                <div className="nx-wallet-holding-info">
                  <div className="nx-wallet-holding-symbol">{h.ticker}</div>
                  <div className="nx-wallet-holding-name">{h.name}</div>
                </div>
                <div className="nx-wallet-holding-balance">
                  {h.balance !== null ? h.balance.toFixed(6) : (loading ? "…" : "-")}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </PageShell>
  );
}

export default Wallet
