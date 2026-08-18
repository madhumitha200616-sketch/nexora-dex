# Nexora DEX

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black&labelColor=20232a)
![Node](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Ethereum](https://img.shields.io/badge/Ethereum-Sepolia_Testnet-3C3C3D?logo=ethereum&logoColor=white)
![Uniswap](https://img.shields.io/badge/Uniswap-V3-FF007A?logo=uniswap&logoColor=white)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

A full-featured decentralized exchange (DEX) built on the Ethereum Sepolia testnet, with a real-time wallet dashboard, transaction history, and live price charts. Built as a portfolio project to demonstrate end-to-end DApp development — smart contract interaction, wallet integration, and production-style frontend engineering.

**Live Demo:** [https://nexora-dex-two.vercel.app](https://nexora-dex-two.vercel.app)
**Video walkthrough:** _optional — add a Loom/YouTube link here_

## Why this project

Most DEX tutorials stop at "connect wallet, swap tokens." Nexora goes further: real transaction history reconstructed from on-chain logs (including swaps sent to a custom recipient address), retry-safe RPC calls with timeouts, exact-amount token approvals instead of unlimited allowances, and a live price-impact warning that surfaces while you're still typing an amount. Every feature here was built to solve a real problem that came up during development, not just to check a box.

## Live Deployment

**Frontend:**
[https://nexora-dex-two.vercel.app](https://nexora-dex-two.vercel.app)

**Backend API:**
[https://nexora-dex.onrender.com](https://nexora-dex.onrender.com)

**Network:**
Ethereum Sepolia Testnet

## Architecture

```
Frontend        → Vercel
Backend API     → Render
Smart Contracts → Sepolia
```

## Features

- **Token swaps** via Uniswap V3 on Sepolia — live price quotes, slippage protection, and a swap confirmation modal before anything executes
- **Multi-hop routing** across pools to find a path between tokens that don't share a direct pool
- **Adaptive route selection** — evaluates multiple candidate routes and picks the best one per trade
- **Liquidity-aware routing** — factors real pool liquidity into route selection, not just fee tier
- **Price-impact-aware routing** — accounts for expected price impact when comparing routes
- **Gas-aware routing** — weighs estimated gas cost as part of route selection
- **Add Liquidity** — deposit into Uniswap V3 pools directly from the app
- **LP position management** — view and manage your own liquidity positions
- **USDC Permit (EIP-2612)** — gasless approval signing for supported tokens, skipping a separate approve transaction
- **Live price impact warning** — flags a thin-liquidity trade inline while you type, before you even open the review step
- **Exact-amount approvals** — approves only what's needed per swap instead of an unlimited spending cap, so MetaMask never shows a scary "Unlimited" warning
- **Wrap / unwrap ETH ⇄ WETH** on its own dedicated page
- **Wallet integration** — live ETH + token balances (WETH, USDC, LINK), each with its own accent color, gas availability, and one-click address copy
- **Pool / TVL analytics** — live pool and total-value-locked data pulled directly from on-chain state
- **Transaction history** — reconstructed directly from on-chain Transfer events, with a fallback that parses raw transaction receipts to correctly detect swaps sent to a different recipient address
- **Live price and price-history data** with 24h / 7d / 30d toggle
- **Testnet faucets** page for getting test tokens

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, ethers.js v5, wagmi, antd, recharts |
| Backend | Node.js, Express |
| Blockchain | Ethereum Sepolia testnet, Uniswap V3 |
| Deployment | Vercel (frontend), Render (backend) |

## Project Structure

```
dexStarter/
├── dex/            # React frontend (deploys to Vercel)
├── dexBack/        # Express backend — token prices, price history (deploys to Render)
└── render.yaml     # Render blueprint for one-click backend deploy
```

## Running Locally

**Backend:**
```bash
cd dexBack
npm install
cp .env.example .env   # add your COINGECKO_API_KEY
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
- Add the env var from [`dexBack/.env.example`](dexBack/.env.example) (`COINGECKO_API_KEY`) in the Render dashboard.
- Copy the resulting URL, e.g. `https://nexora-dex-backend.onrender.com`.

**2. Frontend → Vercel**
- In Vercel: **Add New → Project**, import this repo, set **Root Directory** to `dex`.
- Framework preset auto-detects as Create React App (`npm run build`, output `build`) — [`dex/vercel.json`](dex/vercel.json) adds the SPA rewrite so client-side routes don't 404 on refresh.
- Add env vars from [`dex/.env.example`](dex/.env.example): `REACT_APP_INFURA_URL` and `REACT_APP_API_URL` (the Render URL from step 1).
- Deploy — the live instance of this project is already running at the URL in [Live Deployment](#live-deployment) above.

## License

[MIT](LICENSE)

## Notes

This runs entirely on Sepolia testnet — all tokens are testnet tokens with no real value, obtainable free from the in-app Faucets page. Built for demonstration and learning purposes.
