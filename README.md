# Nexora DEX

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black&labelColor=20232a)
![Node](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Ethereum](https://img.shields.io/badge/Ethereum-Sepolia_Testnet-3C3C3D?logo=ethereum&logoColor=white)
![Uniswap](https://img.shields.io/badge/Uniswap-V3-FF007A?logo=uniswap&logoColor=white)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

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
├── dex/            # React frontend (deploys to Vercel)
├── dexBack/        # Express backend — token prices, price history, AI assistant proxy (deploys to Render)
└── render.yaml     # Render blueprint for one-click backend deploy
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

## Deployment

The backend has to go live first so you have a URL to give the frontend.

**1. Backend → Render**
- Push this repo to GitHub, then in Render: **New → Blueprint**, point it at the repo (it picks up [`render.yaml`](render.yaml) automatically — root dir `dexBack`, build `npm install`, start `npm start`).
- No blueprint support? Create a **New → Web Service** manually with those same settings.
- Add the env vars from [`dexBack/.env.example`](dexBack/.env.example) (`COINGECKO_API_KEY`, `GEMINI_API_KEY`) in the Render dashboard.
- Copy the resulting URL, e.g. `https://nexora-dex-backend.onrender.com`.

**2. Frontend → Vercel**
- In Vercel: **Add New → Project**, import this repo, set **Root Directory** to `dex`.
- Framework preset auto-detects as Create React App (`npm run build`, output `build`) — [`dex/vercel.json`](dex/vercel.json) adds the SPA rewrite so client-side routes don't 404 on refresh.
- Add env vars from [`dex/.env.example`](dex/.env.example): `REACT_APP_INFURA_URL` and `REACT_APP_API_URL` (the Render URL from step 1).
- Deploy, then paste the resulting `*.vercel.app` URL into the **Live demo** line at the top of this README.

## License

[MIT](LICENSE)

## Notes

This runs entirely on Sepolia testnet — all tokens are testnet tokens with no real value, obtainable free from the in-app Faucets page. Built for demonstration and learning purposes.
