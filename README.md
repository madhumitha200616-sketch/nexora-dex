# Nexora DEX

A full-featured decentralized exchange (DEX) built on the Ethereum Sepolia testnet, with a real-time wallet dashboard, transaction history, price charts, and a built-in AI assistant for Web3 questions. Built as a portfolio project to demonstrate end-to-end DApp development — smart contract interaction, wallet integration, and production-style frontend engineering.

**Live demo:** _add your Vercel URL here after deploying_
**Video walkthrough:** _optional — add a Loom/YouTube link here_

## Why this project

Most DEX tutorials stop at "connect wallet, swap tokens." Nexora goes further: real transaction history reconstructed from on-chain logs (including swaps sent to a custom recipient address), retry-safe RPC calls with timeouts, exact-amount token approvals instead of unlimited allowances, and an AI assistant that's actually useful instead of a gimmick. Every feature here was built to solve a real problem that came up during development, not just to check a box.

## Features

- **Token swaps** via Uniswap V3 on Sepolia — live price quotes, slippage protection, and a swap confirmation modal before anything executes
- **Exact-amount approvals** — approves only what's needed per swap instead of an unlimited spending cap, so MetaMask never shows a scary "Unlimited" warning
- **Wrap / unwrap ETH ⇄ WETH** on its own dedicated page
- **Wallet dashboard** — live ETH + token balances (WETH, USDC, LINK), each with its own accent color, gas availability, and one-click address copy
- **Transaction history** — reconstructed directly from on-chain Transfer events, with a fallback that parses raw transaction receipts to correctly detect swaps sent to a different recipient address
- **Live price chart** with 24h / 7d / 30d toggle
- **Testnet faucets** page for getting test tokens
- **AI Assistant**, three modes sharing one Gemini-backed endpoint:
  - **Blockchain Assistant** — answers general Web3/blockchain questions, politely declines anything off-topic
  - **Error Explanation** — paste a MetaMask/console error, get a plain-English explanation and fix
  - **Swap Advisor** — educational guidance on slippage, gas, and trade mechanics (no financial advice)

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, ethers.js v5, wagmi, antd, recharts |
| Backend | Node.js, Express |
| Blockchain | Ethereum Sepolia testnet, Uniswap V3 |
| AI | Google Gemini API |
| Deployment | Vercel (frontend), Render (backend) |

## Project Structure

```
dexStarter/
├── dex/        # React frontend
└── dexBack/    # Express backend — token prices, price history, AI assistant proxy
```

## Running Locally

**Backend:**
```bash
cd dexBack
npm install
cp .env.example .env   # add your GEMINI_API_KEY and COINGECKO_API_KEY
npm start
```

**Frontend** (in a separate terminal):
```bash
cd dex
npm install
cp .env.example .env   # add your Sepolia RPC URL (Infura/Alchemy/public RPC)
npm start
```

The app runs at `http://localhost:3000`, backend at `http://localhost:3001`.

## Notes

This runs entirely on Sepolia testnet — all tokens are testnet tokens with no real value, obtainable free from the in-app Faucets page. Built for demonstration and learning purposes.
