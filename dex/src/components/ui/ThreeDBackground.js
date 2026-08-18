import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import tokenList from "../../tokenList.json";
import "./ui.css";

const ThreeDScene = lazy(() => import("./ThreeDScene"));

// Brand glow color per token, matching the accent baked into each token's
// own SVG artwork (NOVA amber, FSN pink, VRTX cyan, ORBT green) so the coin
// rim-light ties back to the real Nexora identity instead of a random hue.
const ACCENTS = {
  NOVA: "#FFB020",
  FSN: "#FF3DAE",
  VRTX: "#2DD4FF",
  ORBT: "#2BFFA3",
  WETH: "#7dd3fc",
  USDC: "#6ee7b7",
  LINK: "#60a5fa",
};

function coinFor(ticker) {
  const meta = tokenList.find((t) => t.ticker === ticker);
  return { ticker, img: meta?.img, accent: ACCENTS[ticker] || "#22d3ee" };
}

const DEFAULT_TICKERS_BIG = ["BTC", "ETH", "SOL", "NOVA", "WETH"];
const DEFAULT_TICKERS_SMALL = ["BTC", "ETH", "SOL"];

function ThreeDBackground({ intensity = 4, fixed = true, className = "", coins, showGlass = false, layout = "pedestalFlow" }) {
  const [allow3d, setAllow3d] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isNarrow = window.innerWidth < 768;
    setAllow3d(!reduceMotion && !(isNarrow && intensity > 2));
  }, [intensity]);

  const resolvedCoins = useMemo(() => {
    if (coins && coins.length) {
      return coins
        .map((c) => (typeof c === "string" ? coinFor(c) : c.img ? c : coinFor(c.ticker) || c))
        .filter(Boolean);
    }
    const tickers = intensity >= 4 ? DEFAULT_TICKERS_BIG : DEFAULT_TICKERS_SMALL;
    return tickers.map(coinFor).filter(Boolean);
  }, [coins, intensity]);

  if (!allow3d) {
    return <div className={`nx-3d-fallback ${fixed ? "nx-3d-fallback-fixed" : ""} ${className}`} aria-hidden="true" />;
  }

  return (
    <Suspense fallback={<div className={`nx-3d-fallback ${fixed ? "nx-3d-fallback-fixed" : ""} ${className}`} aria-hidden="true" />}>
      <ThreeDScene intensity={intensity} fixed={fixed} coins={resolvedCoins} showGlass={showGlass} layout={layout} />
    </Suspense>
  );
}

export default ThreeDBackground;
