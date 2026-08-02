# Nexora DEX

A decentralized exchange (DEX) built on the Ethereum Sepolia testnet — swap tokens, track live balances, view transaction history, and get help from a built-in AI assistant scoped to blockchain/Web3 topics.

## Features

- Token swaps via Uniswap V3 (Sepolia) with live price quotes and slippage protection
- Wrap/unwrap ETH ⇄ WETH
- Wallet dashboard with live balances (ETH, WETH, USDC, LINK)
- Transaction history with on-chain swap detection, including custom-recipient swaps
- Live price chart (24h / 7d / 30d)
- Testnet token faucets
- AI Assistant with 3 modes: Blockchain Assistant, Error Explanation, and Swap Advisor (powered by Google Gemini)

## Tech Stack

- **Frontend:** React, ethers.js, wagmi, antd, recharts
- **Backend:** Express (price + AI proxy endpoints)
- **Chain:** Ethereum Sepolia testnet
- **AI:** Google Gemini API

## Project Structure

- `dex/` — React frontend
- `dexBack/` — Express backend (token prices, price history, AI assistant proxy)

## Running Locally

Backend:
```
cd dexBack
npm install
cp .env.example .env   # fill in your API keys
npm start
```

Frontend:
```
cd dex
npm install
cp .env.example .env   # fill in your RPC URL
npm start
```
