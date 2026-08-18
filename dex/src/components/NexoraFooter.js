import React from "react";
import { Link } from "react-router-dom";
import NexoraLogo from "./ui/NexoraLogo";
import "./NexoraFooter.css";

function NexoraFooter() {
  return (
    <footer className="nx-footer">
      <div className="nx-footer-inner">
        <div>
          <div className="nx-footer-brand">
            <Link to="/" style={{ textDecoration: "none" }}>
              <NexoraLogo variant="footer" size="sm" />
            </Link>
          </div>
          <p className="nx-footer-tagline">
            A decentralized exchange running on the Ethereum Sepolia testnet — real on-chain swaps,
            liquidity data, and faucets for testing and demonstration.
          </p>
        </div>
        <div className="nx-footer-cols">
          <div className="nx-footer-col">
            <div className="nx-footer-col-title">Trade</div>
            <Link to="/swap">Swap</Link>
            <Link to="/markets">Markets</Link>
            <Link to="/route">Route</Link>
          </div>
          <div className="nx-footer-col">
            <div className="nx-footer-col-title">Earn</div>
            <Link to="/pools">Pools</Link>
            <Link to="/add-liquidity">Add Liquidity</Link>
            <Link to="/zap">Zap</Link>
          </div>
          <div className="nx-footer-col">
            <div className="nx-footer-col-title">Resources</div>
            <Link to="/chart">Analytics</Link>
            <Link to="/explorer">Token Explorer</Link>
            <Link to="/nexora-faucet">Faucet</Link>
          </div>
        </div>
      </div>
      <div className="nx-footer-bottom">
        <span>© {new Date().getFullYear()} Nexora — Sepolia Testnet</span>
        <span>All tokens are testnet assets with no real-world value.</span>
      </div>
    </footer>
  );
}

export default NexoraFooter;
