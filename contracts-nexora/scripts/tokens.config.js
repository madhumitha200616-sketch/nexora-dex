// Single source of truth for the 4 new tokens - used by every script in this
// folder plus 03-update-tokenlist.js (which writes into the dex frontend).
const NEW_TOKENS = [
  { ticker: "NOVA", name: "Nova Token", priceUsd: 10000 },
  { ticker: "FSN", name: "Fusion Token", priceUsd: 7500 },
  { ticker: "VRTX", name: "Vertex Token", priceUsd: 5000 },
  { ticker: "ORBT", name: "Orbit Token", priceUsd: 2500 },
];

const INITIAL_SUPPLY = 10_000_000; // whole tokens, minted to the deployer

// How much of each token's supply gets deposited into the fixed-rate
// exchange as swappable reserve. Leaves the rest (70%) in the deployer
// wallet.
const EXCHANGE_RESERVE_PER_TOKEN = 3_000_000;

// Sepolia USDC - already listed/supported in dex/src/tokenList.json.
// Every new token is paired against this.
const USDC_SEPOLIA_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const USDC_DECIMALS = 6;

// Same Uniswap V3 Sepolia deployment addresses already used by dex/src/components/Swap.js.
const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
// Official Uniswap V3 NonfungiblePositionManager on Sepolia.
const POSITION_MANAGER_ADDRESS = "0x1238536071E1c677A632429e3655c799b22cDA52";

const POOL_FEE = 3000; // 0.3% - same tier Swap.js checks by default

module.exports = {
  NEW_TOKENS,
  INITIAL_SUPPLY,
  EXCHANGE_RESERVE_PER_TOKEN,
  USDC_SEPOLIA_ADDRESS,
  USDC_DECIMALS,
  FACTORY_ADDRESS,
  POSITION_MANAGER_ADDRESS,
  POOL_FEE,
};
