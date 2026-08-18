import React from "react";
import "./ui.css";

// Renders a token's real logo when one is supplied (from tokenList.json /
// faucetConfig.json), and otherwise falls back to the ticker's first
// letter on a brand-gradient disc - never invents a logo, just degrades
// gracefully when one isn't provided.
function TokenIcon({ symbol = "?", src, size = 40, style }) {
  return (
    <span
      className="nx-token-icon"
      style={{ width: size, height: size, fontSize: size * 0.42, ...style }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt={symbol} /> : symbol.charAt(0).toUpperCase()}
    </span>
  );
}

export default TokenIcon;
