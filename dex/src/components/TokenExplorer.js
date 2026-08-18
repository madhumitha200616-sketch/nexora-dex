import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ethers } from "ethers";
import { message } from "antd";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import faucetConfig from "../faucetConfig.json";
import "./TokenExplorer.css";

const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

// Real ERC20 reads against Sepolia - same JsonRpcProvider(REACT_APP_INFURA_URL)
// pattern Swap.js/Tokens.js already use for read-only calls, just querying
// symbol/decimals/totalSupply instead of balances/quotes.
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

function TokenExplorer() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const active = SEPOLIA_TOKENS.find((t) => t.ticker === symbol) || SEPOLIA_TOKENS[0];
  const [onchain, setOnchain] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol && active) {
      navigate(`/explorer/${active.ticker}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setOnchain(null);
    (async () => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const contract = new ethers.Contract(active.sepoliaAddress, ERC20_ABI, provider);
        const [onchainSymbol, decimals, totalSupply] = await Promise.all([
          contract.symbol(),
          contract.decimals(),
          contract.totalSupply(),
        ]);
        if (cancelled) return;
        setOnchain({
          symbol: onchainSymbol,
          decimals,
          totalSupply: ethers.utils.formatUnits(totalSupply, decimals),
        });
      } catch (err) {
        console.error("Token Explorer on-chain read failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  async function handleImport() {
    if (!window.ethereum) {
      message.error("MetaMask not detected");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: { address: active.sepoliaAddress, symbol: active.ticker, decimals: active.decimals, image: active.img },
        },
      });
    } catch (err) {
      console.error("Import to MetaMask failed:", err);
    }
  }

  if (!active) return null;

  const relatedPools = analyticsConfig.pools.filter((p) => p.tokenA === active.ticker || p.tokenB === active.ticker);
  const faucetToken = faucetConfig.tokens.find((t) => t.ticker === active.ticker);

  return (
    <PageShell
      eyebrow="Token Explorer"
      title="Explore a token"
      subtitle="Live contract data read directly from Sepolia — not cached, not simulated."
      background={
        <ThreeDBackground
          intensity={4}
          coins={[{ ticker: active.ticker, img: active.img }]}
        />
      }
    >
      <div className="nx-explorer-grid">
        <GlassCard pad="sm">
          <div className="nx-explorer-list">
            {SEPOLIA_TOKENS.map((t) => (
              <Link
                key={t.ticker}
                to={`/explorer/${t.ticker}`}
                className={`nx-explorer-list-item ${t.ticker === active.ticker ? "nx-active" : ""}`}
              >
                <TokenIcon symbol={t.ticker} src={t.img} size={28} />
                {t.ticker}
              </Link>
            ))}
          </div>
        </GlassCard>

        <GlassCard glow pad="lg">
          <div className="nx-explorer-hero">
            <TokenIcon symbol={active.ticker} src={active.img} size={64} />
            <div>
              <div className="nx-explorer-name">{active.name}</div>
              <div className="nx-explorer-ticker">{active.ticker} · Sepolia Testnet</div>
            </div>
          </div>

          <div className="nx-explorer-fields">
            <div>
              <div className="nx-explorer-field-label">Contract Address</div>
              <div className="nx-explorer-field-value">{active.sepoliaAddress}</div>
            </div>
            <div>
              <div className="nx-explorer-field-label">On-chain Symbol</div>
              <div className="nx-explorer-field-value">{loading ? "…" : onchain?.symbol || "—"}</div>
            </div>
            <div>
              <div className="nx-explorer-field-label">Decimals</div>
              <div className="nx-explorer-field-value">{loading ? "…" : onchain?.decimals ?? active.decimals}</div>
            </div>
            <div>
              <div className="nx-explorer-field-label">Total Supply</div>
              <div className="nx-explorer-field-value">
                {loading ? "…" : onchain ? Number(onchain.totalSupply).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
              </div>
            </div>
            <div>
              <div className="nx-explorer-field-label">Faucet Claimable</div>
              <div className="nx-explorer-field-value">{faucetToken ? "Yes — 100 / claim, 24h cooldown" : "No"}</div>
            </div>
            <div>
              <div className="nx-explorer-field-label">Reference Price</div>
              <div className="nx-explorer-field-value">{active.price ? `$${active.price.toLocaleString()}` : "No fixed reference"}</div>
            </div>
          </div>

          <div className="nx-explorer-actions">
            <Link to="/swap" className="nx-btn nx-btn-primary">Swap {active.ticker}</Link>
            <Link to={`/add-liquidity?token=${active.ticker}`} className="nx-btn nx-btn-secondary">Add Liquidity</Link>
            <button className="nx-btn nx-btn-secondary" onClick={handleImport}>Import to MetaMask</button>
            <a
              className="nx-btn nx-btn-secondary"
              href={`https://sepolia.etherscan.io/address/${active.sepoliaAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              View Contract ↗
            </a>
          </div>

          {relatedPools.length > 0 && (
            <>
              <div className="nx-explorer-field-label" style={{ marginTop: 24 }}>Pools featuring {active.ticker}</div>
              <div className="nx-explorer-pools">
                {relatedPools.map((p) => (
                  <Link key={p.pair} to={`/pools?pair=${encodeURIComponent(p.pair)}`} className="nx-explorer-list-item" style={{ background: "rgba(255,255,255,0.03)" }}>
                    {p.pair} · {(p.fee / 10000).toFixed(2)}% fee
                  </Link>
                ))}
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </PageShell>
  );
}

export default TokenExplorer;
