// Plain Node script (no hardhat/network needed) - merges deployed-tokens.json
// into the frontend's dex/src/tokenList.json so the new tokens show up
// enabled (i.e. with a sepoliaAddress) in the app.
const fs = require("fs");
const path = require("path");

const deployedPath = path.join(__dirname, "..", "deployed-tokens.json");
const tokenListPath = path.join(__dirname, "..", "..", "dex", "src", "tokenList.json");
const exchangeDeployedPath = path.join(__dirname, "..", "deployed-exchange.json");
const exchangeOutPath = path.join(__dirname, "..", "..", "dex", "src", "fixedRateExchange.json");

if (!fs.existsSync(deployedPath)) {
  console.error("deployed-tokens.json not found - run deploy:tokens and deploy:pools first.");
  process.exit(1);
}

const deployedTokens = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
const tokenList = JSON.parse(fs.readFileSync(tokenListPath, "utf8"));

for (const t of deployedTokens) {
  const entry = {
    ticker: t.ticker,
    img: `https://api.dicebear.com/7.x/identicon/svg?seed=${t.ticker}`,
    name: t.name,
    sepoliaAddress: t.address,
    decimals: t.decimals,
    price: t.priceUsd,
  };

  const existingIndex = tokenList.findIndex((x) => x.ticker === t.ticker);
  if (existingIndex >= 0) {
    tokenList[existingIndex] = { ...tokenList[existingIndex], ...entry };
    console.log(`Updated existing entry for ${t.ticker}`);
  } else {
    tokenList.push(entry);
    console.log(`Added ${t.ticker}`);
  }
}

fs.writeFileSync(tokenListPath, JSON.stringify(tokenList, null, 4) + "\n");
console.log(`\nWrote ${tokenListPath}`);

if (fs.existsSync(exchangeDeployedPath)) {
  const exchange = JSON.parse(fs.readFileSync(exchangeDeployedPath, "utf8"));
  fs.writeFileSync(
    exchangeOutPath,
    JSON.stringify(
      {
        address: exchange.address,
        tickers: exchange.tokens.map((t) => t.ticker),
      },
      null,
      4
    ) + "\n"
  );
  console.log(`Wrote ${exchangeOutPath}`);
} else {
  console.log("No deployed-exchange.json found - skipping fixedRateExchange.json (run deploy:exchange first if you need it).");
}
