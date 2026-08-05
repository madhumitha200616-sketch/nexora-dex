const express = require("express");
const axios = require("axios");
const app = express();
const cors = require("cors");
require("dotenv").config();
// Render (and most hosts) assign the port dynamically via process.env.PORT -
// falls back to 3001 for local dev where nothing sets that env var.
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// CoinGecko free "Demo" API key (sign up free, no card needed) - keeps it testnet/free-friendly.
// tokenList.json uses Ethereum mainnet contract addresses (only for USD price lookup),
// while the actual swap happens on Sepolia testnet via Infura RPC.
app.get("/tokenPrice", async (req, res) => {
  const { query } = req;

  if (!query.addressOne || !query.addressTwo) {
    return res.status(400).json({ error: "addressOne and addressTwo are required" });
  }

  try {
    const url = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
    const { data } = await axios.get(url, {
      params: {
        contract_addresses: `${query.addressOne},${query.addressTwo}`,
        vs_currencies: "usd",
      },
      headers: {
        "x-cg-demo-api-key": process.env.COINGECKO_API_KEY,
      },
      timeout: 3000, // fail fast if network is slow/blocked, so mock kicks in quickly
    });

    const priceOne = data[query.addressOne.toLowerCase()]?.usd ?? null;
    const priceTwo = data[query.addressTwo.toLowerCase()]?.usd ?? null;

    return res.status(200).json({ tokenOne: priceOne, tokenTwo: priceTwo });
  } catch (err) {
    console.error("CoinGecko fetch failed:", err.response?.status, err.response?.data || err.message);

    // FALLBACK: network blocked (college wifi, no signal, etc.) -> return mock prices
    // so you can keep testing the app. Remove this block once you have working internet.
    console.warn("Using fallback mock prices - CoinGecko unreachable");
    return res.status(200).json({ tokenOne: 1, tokenTwo: 5, mock: true });
  }
});

// Price history for the chart - 24h / 7d / 30d, selectable via ?days=.
// Uses CoinGecko market_chart endpoint (mainnet address).
const ALLOWED_DAYS = { "1": 1, "7": 7, "30": 30 };

app.get("/priceHistory", async (req, res) => {
  const { query } = req;

  if (!query.address) {
    return res.status(400).json({ error: "address is required" });
  }

  // Only 1/7/30 are wired up on the frontend's 24H/7D/30D toggle - anything
  // else (missing, garbled) quietly falls back to 7d instead of erroring.
  const days = ALLOWED_DAYS[query.days] ?? 7;
  const isIntraday = days === 1;

  // CoinGecko returns denser (hourly-ish) data for days=1, so a date-only
  // label would just repeat "Jan 1" for every point - use a time-of-day
  // label instead whenever the whole range is inside one day.
  const formatLabel = (time) =>
    isIntraday
      ? new Date(time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  try {
    const url = `https://api.coingecko.com/api/v3/coins/ethereum/contract/${query.address}/market_chart`;
    const { data } = await axios.get(url, {
      params: { vs_currency: "usd", days },
      headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY },
      timeout: 3000,
    });

    // data.prices = [[timestamp, price], ...] -> simplify for the chart
    const points = data.prices.map(([time, price]) => ({
      time: formatLabel(time),
      price: Number(price.toFixed(4)),
    }));

    return res.status(200).json({ points });
  } catch (err) {
    console.error("Price history fetch failed:", err.response?.status, err.message);

    // FALLBACK: network blocked -> generate a small mock trend so the chart
    // still renders, sized and spaced to match whichever range was picked
    // (24 hourly points for 24h, N daily points for 7d/30d).
    const now = Date.now();
    const pointCount = isIntraday ? 24 : days;
    const intervalMs = isIntraday ? 3600000 : 86400000;
    const points = Array.from({ length: pointCount }, (_, i) => ({
      time: formatLabel(now - (pointCount - 1 - i) * intervalMs),
      price: Number((1 + Math.sin(i / 2.5) * 0.05).toFixed(4)),
    }));
    return res.status(200).json({ points, mock: true });
  }
});

app.listen(port, () => {
  console.log(`Listening for API Calls on port ${port}`);
});