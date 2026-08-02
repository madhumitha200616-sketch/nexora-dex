import React from 'react'
import { Link } from "react-router-dom";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";

// Where to actually get free Sepolia testnet funds - matches the "Getting
// Test Funds" flow: Sepolia ETH (for gas + wrapping into WETH) comes from a
// faucet, WETH comes from the Wrap page here in the app, and USDC comes from
// Circle's official faucet.
const FAUCETS = [
  {
    name: "Sepolia ETH",
    ticker: "ETH",
    href: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
    description:
      "Free test ETH, used for gas fees and for wrapping into WETH. Most faucets cap you at a small amount per day.",
  },
  {
    name: "Circle USDC Faucet",
    ticker: "USDC",
    href: "https://faucet.circle.com",
    description:
      "Free test USDC on Sepolia. Paste your wallet address, pick the Sepolia network, and claim - no ETH balance required.",
  },
  {
    name: "Chainlink LINK Faucet",
    ticker: "LINK",
    href: "https://faucets.chain.link/sepolia",
    description:
      "Free test LINK on Sepolia, straight from Chainlink. Note: swapping it here still depends on a live Uniswap LINK pool actually existing on testnet - if there's no liquidity, the app will tell you clearly instead of failing silently.",
  },
];

function Faucets() {
  return (
    <div className="tokensPage faucetsPage">
      <div className="tokensHeader">
        <h4>Get Test Funds</h4>
      </div>
      <div className="tokensEmpty faucetsIntro">
        This app runs on Sepolia testnet, so every token here is free. Grab ETH and USDC
        below, then use the Wrap page to turn ETH into WETH before swapping.
      </div>
      <div className="faucetList">
        {FAUCETS.map((f) => (
          <div className="faucetCard" key={f.ticker} onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
            <div className="faucetCardInfo">
              <div className="faucetCardTitle">{f.name}</div>
              <div className="faucetCardDesc">{f.description}</div>
            </div>
            <a
              className="faucetBtn"
              href={f.href}
              target="_blank"
              rel="noreferrer"
            >
              Open faucet
            </a>
          </div>
        ))}
        <div className="faucetCard" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
          <div className="faucetCardInfo">
            <div className="faucetCardTitle">WETH</div>
            <div className="faucetCardDesc">
              Not a faucet - wrap your Sepolia ETH 1:1 into WETH on the Wrap page, then swap it for USDC.
            </div>
          </div>
          <Link className="faucetBtn" to="/wrap">Go to Wrap</Link>
        </div>
      </div>
    </div>
  );
}

export default Faucets
