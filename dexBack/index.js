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

// Nexora AI Assistant - proxies to Google Gemini (free tier, no card
// required) so the frontend never needs (or exposes) the API key directly
// in the browser. Requires GEMINI_API_KEY in this folder's .env - if it's
// missing or the call fails for any reason, this responds with a clear
// error instead of a fake answer, and the frontend falls back to its own
// small local FAQ so the assistant never just goes blank.
// Three modes, one endpoint. The frontend has three tabs (Blockchain
// Assistant / Error Explanation / Swap Advisor) and sends which one is
// active as `mode` - that just swaps which system prompt gets used, so
// there's only one place talking to Gemini.
const SYSTEM_PROMPTS = {
  assistant:
    "You are Blockchain AI, an assistant inside Nexora, a Decentralized Exchange (DEX) demo app on the Ethereum " +
    "Sepolia testnet, built with React, ethers.js and Uniswap V3.\n\n" +
    "Your job is to answer ONLY blockchain and Web3 related questions. Topics include: Blockchain, Bitcoin, " +
    "Ethereum, Web3, Smart Contracts, Solidity, MetaMask, ERC-20, ERC-721, Gas Fees, DeFi, DEX, Liquidity Pools, " +
    "Token Swaps, Wallets, Transaction Hashes, Cryptography, Consensus, the Ethereum Sepolia Testnet, and this " +
    "app's own features (WETH/USDC/LINK, slippage, gas estimates, the Wallet dashboard, Faucets).\n\n" +
    "Rules:\n" +
    "1. Answer only blockchain-related questions.\n" +
    "2. Use simple English.\n" +
    "3. Give short and accurate answers (2-5 sentences unless the question genuinely needs more).\n" +
    "4. If asked about something unrelated to blockchain/Web3, politely say you only assist with blockchain and " +
    "DEX topics, and do not answer the unrelated part.\n" +
    "5. Never ask the user for their private key or seed phrase. If they mention one or ask you about sharing it, " +
    "remind them to never share their private key or seed phrase with anyone, including you or any website.",

  error:
    "You are the Nexora Error Explainer, embedded in a Sepolia testnet DEX (decentralized exchange) demo app built " +
    "with React, ethers.js and Uniswap V3. The user will paste a raw error - a MetaMask popup message, a browser " +
    "console error, or a reason a swap/transaction failed. Explain, in plain beginner-friendly language: (1) what " +
    "the error actually means, (2) the most likely reason it happened here (common causes: insufficient token or " +
    "gas balance, slippage tolerance exceeded, no liquidity pool for the pair, the user rejecting the MetaMask " +
    "popup, a stale nonce, sending to an unreachable recipient), and (3) a concrete next step to fix or avoid it. " +
    "Keep it tight - a short paragraph or a few bullet-style sentences, not an essay. If the pasted text isn't " +
    "actually an error, say so and ask them to paste the real message. Never ask the user for their private key or " +
    "seed phrase, and if one comes up, remind them to never share it with anyone.",

  advisor:
    "You are the Nexora Swap Advisor, embedded in a Sepolia testnet DEX (decentralized exchange) demo app built " +
    "with React, ethers.js and Uniswap V3. The user will describe a swap they're considering (token pair, amount, " +
    "slippage tolerance, recipient, etc). Give educational guidance about the MECHANICS and RISK PARAMETERS of the " +
    "trade only: whether the slippage tolerance they mentioned is unusually high or low for that kind of pair, " +
    "general price-impact and liquidity considerations, gas/timing tips, and testnet-specific notes (fake funds, " +
    "get more from the Faucets page). Do NOT predict prices, do NOT tell them whether the trade is a good idea " +
    "financially, and do NOT give investment advice - if asked directly, clarify you only cover the technical/" +
    "mechanical side and they should make trading decisions themselves. Keep answers practical and concise. " +
    "Never ask the user for their private key or seed phrase, and if one comes up, remind them to never share it " +
    "with anyone.",
};

// Model name is configurable via .env - this key's free-tier quota turned
// out to vary a LOT per model: gemini-2.5-flash is fully blocked for new
// keys (404), gemini-2.0-flash has a 0 free quota on this project, and
// gemini-3.6-flash (via the gemini-flash-latest alias) only allows 20
// requests/day. Trying the Lite variant instead - separate quota bucket,
// Lite tiers are usually given a more generous free daily allowance since
// they're cheaper for Google to serve. If this also runs out, switch to
// GEMINI_MODEL=gemini-flash-latest in dexBack/.env and wait for the daily
// reset (midnight Pacific time), or add billing for Tier 1 (no hard cap).
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

app.post("/askAI", async (req, res) => {
  const { question, history, mode } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "question is required" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "GEMINI_API_KEY is not configured on the server." });
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.assistant;

  try {
    // `history` is a short list of prior {role, content} turns from the
    // frontend (role is "user" or "assistant", OpenAI-style) - Gemini wants
    // "user" / "model" instead, so translate it here. Capped to keep the
    // request small and cheap.
    const priorTurns = (Array.isArray(history) ? history.slice(-6) : []).map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const { data } = await axios.post(
      url,
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [...priorTurns, { role: "user", parts: [{ text: question }] }],
        // gemini-2.0-flash has no "thinking" step, so no thinkingConfig is
        // needed here (and adding one would just risk a 400 on a model
        // that doesn't support it) - replies come back quickly by default.
        // maxOutputTokens is generous since some replies (Error Explainer
        // especially) run a bit longer.
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.4,
        },
      },
      {
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!answer) {
      return res.status(502).json({ error: "Gemini returned an empty response." });
    }
    return res.status(200).json({ answer });
  } catch (err) {
    console.error("AI Assistant request failed:", err.response?.status, err.response?.data || err.message);
    return res.status(502).json({ error: "Couldn't reach the AI service right now." });
  }
});

app.listen(port, () => {
  console.log(`Listening for API Calls on port ${port}`);
});