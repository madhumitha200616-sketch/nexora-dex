import React from 'react'
import { Link } from "react-router-dom";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import "./NexoraFaucet.css";

// Where to actually get free Sepolia testnet funds - matches the "Getting
// Test Funds" flow: Sepolia ETH (for gas + wrapping into WETH) comes from a
// faucet, WETH comes from the Wrap page here in the app, and USDC comes from
// Circle's official faucet. Real links only - nothing here is fabricated.
const FAUCETS = [
  {
    name: "Sepolia ETH",
    ticker: "ETH",
    accent: "#8a92b2",
    href: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
    description:
      "Free test ETH, used for gas fees and for wrapping into WETH. Most faucets cap you at a small amount per day.",
    cta: "Open faucet",
  },
  {
    name: "Circle USDC Faucet",
    ticker: "USDC",
    accent: "#6ee7b7",
    href: "https://faucet.circle.com",
    description:
      "Free test USDC on Sepolia. Paste your wallet address, pick the Sepolia network, and claim - no ETH balance required.",
    cta: "Open faucet",
  },
  {
    name: "Chainlink LINK Faucet",
    ticker: "LINK",
    accent: "#60a5fa",
    href: "https://faucets.chain.link/sepolia",
    description:
      "Free test LINK on Sepolia, straight from Chainlink. Note: swapping it here still depends on a live Uniswap LINK pool actually existing on testnet - if there's no liquidity, the app will tell you clearly instead of failing silently.",
    cta: "Open faucet",
  },
];

function Faucets() {
  return (
    <PageShell
      eyebrow="Sepolia Testnet"
      title="Get Test Funds"
      subtitle="This app runs on Sepolia testnet, so every token here is free. Grab ETH and USDC below, then use the Wrap page to turn ETH into WETH before swapping."
      background={<ThreeDBackground intensity={2} />}
    >
      <div className="nf-grid nf-faucets-grid">
        {FAUCETS.map((f) => {
          const meta = tokenList.find((t) => t.ticker === f.ticker);
          return (
            <GlassCard
              key={f.ticker}
              glow
              hoverable
              tilt
              pad="lg"
              className="nf-card nf-faucet-card"
              style={{ "--nf-faucet-accent": f.accent }}
            >
              <div className="nf-card-head">
                <TokenIcon symbol={f.ticker} src={meta?.img} size={44} style={{ borderRadius: 14 }} />
                <div>
                  <div className="nf-card-name">{f.name}</div>
                  <div className="nf-card-ticker">{f.ticker}</div>
                </div>
              </div>
              <p className="nf-faucet-card-desc">{f.description}</p>
              <a
                className="nf-btn nf-btn-primary nf-btn-full nf-faucet-card-cta"
                href={f.href}
                target="_blank"
                rel="noreferrer"
              >
                {f.cta} →
              </a>
            </GlassCard>
          );
        })}

        <GlassCard
          glow
          hoverable
          tilt
          pad="lg"
          className="nf-card nf-faucet-card"
          style={{ "--nf-faucet-accent": "#7dd3fc" }}
        >
          <div className="nf-card-head">
            <TokenIcon
              symbol="WETH"
              src={tokenList.find((t) => t.ticker === "WETH")?.img}
              size={44}
              style={{ borderRadius: 14 }}
            />
            <div>
              <div className="nf-card-name">Wrapped ETH</div>
              <div className="nf-card-ticker">WETH</div>
            </div>
          </div>
          <p className="nf-faucet-card-desc">
            Not a faucet - wrap your Sepolia ETH 1:1 into WETH on the Wrap page, then swap it for USDC.
          </p>
          <Link className="nf-btn nf-btn-primary nf-btn-full nf-faucet-card-cta" to="/wrap">
            Go to Wrap →
          </Link>
        </GlassCard>
      </div>
    </PageShell>
  );
}

export default Faucets
