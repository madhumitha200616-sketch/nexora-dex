import React, { useState, useEffect, useCallback } from 'react'
import { message } from "antd";
import { ethers } from "ethers";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import tokenList from "../tokenList.json";
import faucetConfig from "../faucetConfig.json";
import NexoraFaucetScene from "./NexoraFaucetScene";
import { useNotifications } from "../context/NotificationsContext";
import "./NexoraFaucet.css";

const FAUCET_ABI = [
  "function claim(address token) external",
  "function timeUntilNextClaim(address token, address user) view returns (uint256)",
  "error TooSoon(uint256 secondsRemaining)",
  "error InsufficientFaucetReserve(address token, uint256 needed, uint256 available)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

// Brand accent per Nexora-native token, matching the glow baked into each
// token's own SVG artwork (see ui/ThreeDBackground.js's ACCENTS map) so the
// claim card's glow ties back to the same identity as the 3D coin.
const TOKEN_ACCENTS = {
  NOVA: "#FFB020",
  FSN: "#FF3DAE",
  VRTX: "#2DD4FF",
  ORBT: "#2BFFA3",
};

function formatCooldown(totalSeconds) {
  if (totalSeconds <= 0) return null;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatAddress(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function NexoraFaucet({ isConnected, address, connect }) {
  // Per-ticker: { balance, cooldown (seconds remaining), isClaiming, txHash }
  const [state, setState] = useState(() =>
    Object.fromEntries(faucetConfig.tokens.map((t) => [t.ticker, { balance: null, cooldown: 0, isClaiming: false, txHash: null }]))
  );
  const [addressCopied, setAddressCopied] = useState(false);
  const { push: pushNotification } = useNotifications();

  const refresh = useCallback(async () => {
    if (!isConnected || !address) return;
    const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
    const faucet = new ethers.Contract(faucetConfig.address, FAUCET_ABI, provider);

    const results = await Promise.all(
      faucetConfig.tokens.map(async (t) => {
        const tokenContract = new ethers.Contract(t.address, ERC20_ABI, provider);
        const [balance, cooldown] = await Promise.all([
          tokenContract.balanceOf(address),
          faucet.timeUntilNextClaim(t.address, address),
        ]);
        return [t.ticker, { balance: ethers.utils.formatUnits(balance, t.decimals), cooldown: cooldown.toNumber() }];
      })
    );

    setState((prev) => {
      const next = { ...prev };
      for (const [ticker, data] of results) {
        next[ticker] = { ...next[ticker], ...data };
      }
      return next;
    });
  }, [isConnected, address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Local 1s countdown ticker - avoids re-hitting the RPC every second just
  // to display a number that only the block timestamp (not the network)
  // actually needs to confirm.
  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const ticker of Object.keys(next)) {
          if (next[ticker].cooldown > 0) {
            next[ticker] = { ...next[ticker], cooldown: next[ticker].cooldown - 1 };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleClaim(token) {
    if (!isConnected) {
      message.error("Connect your wallet first");
      return;
    }
    setState((prev) => ({ ...prev, [token.ticker]: { ...prev[token.ticker], isClaiming: true } }));
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const faucet = new ethers.Contract(faucetConfig.address, FAUCET_ABI, signer);

      message.info(`Confirm the ${token.ticker} claim in MetaMask...`);
      const tx = await faucet.claim(token.address);
      const receipt = await tx.wait();

      message.success(`Claimed ${faucetConfig.claimAmount} ${token.ticker}!`);
      setState((prev) => ({
        ...prev,
        [token.ticker]: { ...prev[token.ticker], isClaiming: false, txHash: receipt.transactionHash },
      }));
      pushNotification({
        kind: "claim",
        message: `Claimed ${faucetConfig.claimAmount} ${token.ticker} from the faucet`,
        txHash: receipt.transactionHash,
      });
      refresh();
    } catch (err) {
      console.error("Claim failed:", err);
      let msg = "Claim failed. Please try again.";
      if (err.errorName === "TooSoon" || /TooSoon/.test(err.message || "")) {
        msg = `You've already claimed ${token.ticker} in the last ${faucetConfig.cooldownHours}h. Try again later.`;
      } else if (err.errorName === "InsufficientFaucetReserve" || /InsufficientFaucetReserve/.test(err.message || "")) {
        msg = `The faucet is out of ${token.ticker} right now. Try again later.`;
      } else if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        msg = "Claim cancelled";
      }
      message.error(msg);
      setState((prev) => ({ ...prev, [token.ticker]: { ...prev[token.ticker], isClaiming: false } }));
      refresh();
    }
  }

  async function handleImportToMetaMask(token, img) {
    if (!window.ethereum) {
      message.error("MetaMask not detected");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: token.address,
            symbol: token.ticker,
            decimals: token.decimals,
            image: img,
          },
        },
      });
    } catch (err) {
      console.error("Import to MetaMask failed:", err);
    }
  }

  return (
    <div className="nf-page">
      <div className="nf-bg" />
      <NexoraFaucetScene />

      <div className="nf-content">
        <section className="nf-hero">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="nf-eyebrow"
          >
            <span className="nf-eyebrow-dot" />
            Ethereum Sepolia Testnet
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="nf-title"
          >
            Nexora Token Faucet
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16 }}
            className="nf-subtitle"
          >
            Claim free NOVA, FSN, VRTX and ORBT test tokens for the Nexora DEX — one claim per wallet,
            per token, every {faucetConfig.cooldownHours} hours.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
            className="nf-info-strip"
          >
            <div className="nf-glass nf-info-tile">
              <div className="nf-info-label">Faucet Contract</div>
              <div className="nf-info-value">
                {formatAddress(faucetConfig.address)}
                <button
                  type="button"
                  className="nf-btn nf-btn-secondary"
                  style={{ padding: "3px 10px", fontSize: 11 }}
                  onClick={() => {
                    navigator.clipboard.writeText(faucetConfig.address);
                    setAddressCopied(true);
                    setTimeout(() => setAddressCopied(false), 1500);
                  }}
                >
                  {addressCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="nf-glass nf-info-tile">
              <div className="nf-info-label">Claim Amount</div>
              <div className="nf-info-value">{faucetConfig.claimAmount} tokens / claim</div>
            </div>
            <div className="nf-glass nf-info-tile">
              <div className="nf-info-label">Network Status</div>
              <div className="nf-info-value">
                <span className="nf-status-dot" />
                Live
              </div>
            </div>
          </motion.div>
        </section>

        <section className="nf-section">
          {!isConnected ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="nf-glass nf-connect-card"
            >
              <div className="nf-connect-title">Connect your wallet</div>
              <div className="nf-connect-desc">
                You need to connect MetaMask before you can claim any Nexora tokens.
              </div>
              <button type="button" className="nf-btn nf-btn-primary nf-btn-full" onClick={connect}>
                Connect MetaMask
              </button>
            </motion.div>
          ) : (
            <>
              <h2 className="nf-section-heading">Claim Your Tokens</h2>
              <p className="nf-section-sub">Each token can be claimed once every {faucetConfig.cooldownHours} hours.</p>

              <div className="nf-grid">
                {faucetConfig.tokens.map((t, i) => {
                  const tokenMeta = tokenList.find((x) => x.ticker === t.ticker);
                  const s = state[t.ticker] || {};
                  const cooldownLabel = formatCooldown(s.cooldown);
                  const statusClass = s.isClaiming
                    ? "nf-status-claiming"
                    : s.cooldown > 0
                    ? "nf-status-cooldown"
                    : "nf-status-ready";
                  const statusLabel = s.isClaiming ? "Claiming" : s.cooldown > 0 ? "Cooldown" : "Ready";
                  return (
                    <motion.div
                      key={t.ticker}
                      initial={{ opacity: 0, y: 26 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ duration: 0.5, delay: i * 0.08 }}
                      className="nf-glass nf-card"
                      style={{ "--nf-card-accent": TOKEN_ACCENTS[t.ticker] || "#22d3ee" }}
                    >
                      <div className="nf-card-head">
                        {tokenMeta?.img && (
                          <img src={tokenMeta.img} alt={t.ticker} className="nf-card-icon nf-card-icon-accent" />
                        )}
                        <div>
                          <div className="nf-card-name">{t.name}</div>
                          <div className="nf-card-ticker">{t.ticker}</div>
                        </div>
                      </div>

                      <span className={`nf-status-pill ${statusClass}`}>
                        {statusLabel}
                        {statusClass === "nf-status-cooldown" && cooldownLabel ? ` · ${cooldownLabel}` : ""}
                      </span>

                      <div className="nf-card-balance">
                        <div className="nf-card-balance-label">Your Balance</div>
                        <div className="nf-card-balance-value">
                          {s.balance ? Number(s.balance).toFixed(2) : "—"} {t.ticker}
                        </div>
                      </div>

                      {s.txHash && (
                        <div className="nf-tx-row">
                          <span className="nf-tx-label">Last claim successful</span>
                          <span className="nf-tx-hash">{s.txHash.slice(0, 10)}...{s.txHash.slice(-8)}</span>
                          <a
                            className="nf-tx-link"
                            href={`https://sepolia.etherscan.io/tx/${s.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View on Etherscan
                          </a>
                        </div>
                      )}

                      <div className="nf-card-actions">
                        <button
                          type="button"
                          className="nf-btn nf-btn-primary nf-btn-full"
                          disabled={s.isClaiming || s.cooldown > 0}
                          onClick={() => handleClaim(t)}
                        >
                          {s.isClaiming ? "Claiming..." : cooldownLabel ? `Next claim in ${cooldownLabel}` : `Claim ${faucetConfig.claimAmount} ${t.ticker}`}
                        </button>
                        <button
                          type="button"
                          className="nf-btn nf-btn-secondary nf-btn-full"
                          onClick={() => handleImportToMetaMask(t, tokenMeta?.img)}
                        >
                          Import to MetaMask
                        </button>
                        <Link to={`/explorer/${t.ticker}`} className="nf-tx-link" style={{ textAlign: "center" }}>
                          View token details →
                        </Link>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default NexoraFaucet
