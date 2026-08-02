import React, { useState, useEffect } from 'react'
import { ethers } from "ethers";
import { message } from "antd";
import { CopyOutlined, CheckOutlined, LogoutOutlined } from "@ant-design/icons";
import tokenList from "../tokenList.json";
import Sepolia from "../sepolia-badge.png";
import EthIcon from "../eth.svg";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";

// Same "only tokens with a real Sepolia contract" filter used by Tokens.js -
// these are the only balances worth showing since they're the only tokens
// this app can actually swap.
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)"
];

// Each stat card gets its own accent color instead of every card in the
// grid looking identical - ETH stays cyan (matches the rest of the app's
// "native asset" color), each token gets a distinct hue, Gas gets the same
// amber already used for gas estimates on the Swap page, and anything not
// listed here (a future token) falls back to the page's violet accent.
// Applied via CSS custom properties so .walletStatCard in App.css can stay
// a single shared rule instead of one class per token.
const STAT_ACCENTS = {
  ETH: { border: "rgba(0, 217, 255, 0.4)", glow: "rgba(0, 217, 255, 0.22)" },
  WETH: { border: "rgba(109, 94, 252, 0.4)", glow: "rgba(109, 94, 252, 0.22)" },
  USDC: { border: "rgba(0, 230, 160, 0.4)", glow: "rgba(0, 230, 160, 0.22)" },
  LINK: { border: "rgba(59, 130, 246, 0.4)", glow: "rgba(59, 130, 246, 0.22)" },
  GAS: { border: "rgba(255, 182, 72, 0.4)", glow: "rgba(255, 182, 72, 0.22)" },
};
const DEFAULT_ACCENT = { border: "rgba(168, 85, 247, 0.35)", glow: "rgba(168, 85, 247, 0.18)" };

function accentStyle(key) {
  const accent = STAT_ACCENTS[key] || DEFAULT_ACCENT;
  return { "--statBorder": accent.border, "--statGlow": accent.glow };
}

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

  if (!isConnected || !address) {
    return (
      <div className="tokensPage">
        <div className="tokensEmpty">Connect your wallet (top right) to view your dashboard.</div>
      </div>
    );
  }

  return (
    <div className="tokensPage walletPage">
      <div className="tokensHeader">
        <h4>Wallet</h4>
        <span className="walletConnectedBadge">
          <span className="walletDot"></span> Connected
        </span>
      </div>

      <div className="walletAddressRow" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
        <span className="walletAddressFull">{address}</span>
        <span className="walletCopyBtn" onClick={copyAddress}>
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </span>
      </div>

      <div className="walletNetworkRow">
        <img src={Sepolia} alt="sepolia" className="eth" />
        Sepolia Testnet
      </div>

      <div className="walletStatsGrid">
        <div className="walletStatCard" style={accentStyle("ETH")} onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
          <img src={EthIcon} alt="ETH" className="walletStatIcon" />
          <div className="walletStatInfo">
            <div className="walletStatLabel">ETH Balance</div>
            <div className="walletStatValue">
              {ethBalance !== null ? `${Number(ethBalance).toFixed(5)} ETH` : (loading ? "..." : "-")}
            </div>
          </div>
        </div>

        {SEPOLIA_TOKENS.map((token) => (
          <div className="walletStatCard" key={token.ticker} style={accentStyle(token.ticker)} onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <img src={token.img} alt={token.ticker} className="walletStatIcon" />
            <div className="walletStatInfo">
              <div className="walletStatLabel">{token.ticker} Balance</div>
              <div className="walletStatValue">
                {tokenBalances[token.ticker] !== undefined
                  ? `${Number(tokenBalances[token.ticker]).toFixed(6)} ${token.ticker}`
                  : (loading ? "..." : "-")}
              </div>
            </div>
          </div>
        ))}

        <div className="walletStatCard" style={accentStyle("GAS")} onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
          <img src={EthIcon} alt="Gas" className="walletStatIcon" />
          <div className="walletStatInfo">
            <div className="walletStatLabel">Gas Available</div>
            <div className="walletStatValue">
              {ethBalance !== null ? `${Number(ethBalance).toFixed(5)} ETH` : (loading ? "..." : "-")}
            </div>
          </div>
        </div>
      </div>

      <button className="walletDisconnectBtn" onClick={handleDisconnect}>
        <LogoutOutlined /> Disconnect Wallet
      </button>
    </div>
  );
}

export default Wallet
