# Nexora new-token deployment (Sepolia)

Deploys Nova (NOVA), Fusion (FSN), Vertex (VRTX) and Orbit (ORBT) as real
ERC-20 contracts on Sepolia, creates a Uniswap V3 pool for each against USDC,
seeds it with a small amount of liquidity at the target price, then writes
the new `sepoliaAddress` into `../dex/src/tokenList.json` so they show up
enabled (not "Testnet unsupported") in the app.

## One-time setup

```bash
cd contracts-nexora
npm install
cp .env.example .env
```

Edit `.env`:
- `PRIVATE_KEY` - your wallet's private key. Stays local, never committed, never sent anywhere by these scripts.
- `LIQUIDITY_USDC_PER_POOL` - how much test USDC to seed into **each** of the 4 pools (default 10).

You'll need, in that wallet:
- Sepolia ETH for gas - https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Sepolia USDC for liquidity (at least `LIQUIDITY_USDC_PER_POOL x 4`) - https://faucet.circle.com

## Run, in order

```bash
npm run compile
npm run deploy:tokens   # deploys the 4 contracts, writes deployed-tokens.json
npm run deploy:pools    # creates the 4 Uniswap pools + seeds liquidity
npm run update:tokenlist  # writes sepoliaAddress into dex/src/tokenList.json
```

After the last step, restart the `dex` dev server - the 4 tokens will show
up enabled in the Swap token picker and Tokens page.
