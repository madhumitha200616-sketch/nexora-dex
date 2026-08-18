import React from "react";
import ThreeDScene from "./ui/ThreeDScene";
import faucetConfig from "../faucetConfig.json";
import tokenList from "../tokenList.json";

// Rebuilt on top of the shared premium ThreeDScene system (real branded
// metal coins + glass lens discs + procedural studio lighting) instead of
// this page's original bespoke wireframe-cube/starfield scene - the exact
// 4 tokens this page lets you claim, rendered as real coins.
const ACCENTS = { NOVA: "#FFB020", FSN: "#FF3DAE", VRTX: "#2DD4FF", ORBT: "#2BFFA3" };

const FAUCET_COINS = faucetConfig.tokens
  .map((t) => {
    const meta = tokenList.find((x) => x.ticker === t.ticker);
    if (!meta) return null;
    return { ticker: t.ticker, img: meta.img, accent: ACCENTS[t.ticker] || "#a855f7" };
  })
  .filter(Boolean);

export default function NexoraFaucetScene() {
  return <ThreeDScene intensity={5} coins={FAUCET_COINS} showGlass />;
}
