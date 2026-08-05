import React, { useEffect, useState } from 'react'
import { Input, message } from "antd";
import { ethers } from "ethers";
import tokenList from "../tokenList.json";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";

// Only tokens with a real Sepolia contract can actually be pooled here -
// same filter used everywhere else in the app (Swap, Wallet, Markets).
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);
const WETH = SEPOLIA_TOKENS.find((t) => t.ticker === "WETH");
const USDC = SEPOLIA_TOKENS.find((t) => t.ticker === "USDC");
const LINK = SEPOLIA_TOKENS.find((t) => t.ticker === "LINK");

// The two pairs this app actually swaps (see Swap.js) - letting anyone add
// liquidity to these SAME pools is what deepens them for everyone, instead
// of one person alone trying to move the needle with faucet-limited tokens.
const PAIRS = [WETH && USDC ? { tokenA: WETH, tokenB: USDC, label: "WETH / USDC" } : null,
               LINK && USDC ? { tokenA: LINK, tokenB: USDC, label: "LINK / USDC" } : null]
  .filter(Boolean);

const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];
const FEE_TIERS = [500, 3000, 10000, 100];

// Uniswap V3 tick spacing is fixed per fee tier - required to compute valid
// tickLower/tickUpper (they must be exact multiples of this).
const TICK_SPACING = { 500: 10, 3000: 60, 10000: 200, 100: 1 };
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// Uniswap V3 NonfungiblePositionManager on Sepolia - the contract that
// actually mints/holds liquidity positions (as an NFT). Different address
// from mainnet, same pattern as QUOTER_ADDRESS/ROUTER_ADDRESS in Swap.js.
const POSITION_MANAGER_ADDRESS = "0x1238536071e1c677a632429e3655c799b22cda52";
const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)"
];

async function findPoolFee(provider, tokenA, tokenB) {
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  for (const fee of FEE_TIERS) {
    const pool = await factory.getPool(tokenA, tokenB, fee);
    if (pool && pool !== ethers.constants.AddressZero) {
      return fee;
    }
  }
  return null;
}

function fullRangeTicks(fee) {
  const spacing = TICK_SPACING[fee];
  const tickLower = Math.ceil(MIN_TICK / spacing) * spacing;
  const tickUpper = Math.floor(MAX_TICK / spacing) * spacing;
  return { tickLower, tickUpper };
}

function Pool({ isConnected, address }) {
  const [pairIndex, setPairIndex] = useState(0);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [balanceA, setBalanceA] = useState(null);
  const [balanceB, setBalanceB] = useState(null);
  const [fee, setFee] = useState(null);
  const [isBusy, setIsBusy] = useState(false);

  const pair = PAIRS[pairIndex];

  useEffect(() => {
    setFee(null);
    if (!pair) return;
    let cancelled = false;
    (async () => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const detected = await findPoolFee(provider, pair.tokenA.sepoliaAddress, pair.tokenB.sepoliaAddress);
        if (!cancelled) setFee(detected);
      } catch (err) {
        console.error("Pool fee detection failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [pairIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isConnected || !address || !pair) {
      setBalanceA(null);
      setBalanceB(null);
      return;
    }
    fetchBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, pairIndex]);

  async function fetchBalances() {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const tokenA = new ethers.Contract(pair.tokenA.sepoliaAddress, ERC20_ABI, provider);
      const tokenB = new ethers.Contract(pair.tokenB.sepoliaAddress, ERC20_ABI, provider);
      const [rawA, rawB] = await Promise.all([
        tokenA.balanceOf(address),
        tokenB.balanceOf(address),
      ]);
      setBalanceA(ethers.utils.formatUnits(rawA, pair.tokenA.decimals));
      setBalanceB(ethers.utils.formatUnits(rawB, pair.tokenB.decimals));
    } catch (err) {
      console.error("Balance fetch failed:", err);
    }
  }

  async function addLiquidity() {
    if (!isConnected) {
      message.error("Please connect your wallet first");
      return;
    }
    if (fee === null) {
      message.error("No live pool found for this pair on Sepolia testnet.");
      return;
    }
    if (!amountA || Number(amountA) <= 0 || !amountB || Number(amountB) <= 0) {
      message.error("Enter an amount for both tokens.");
      return;
    }

    setIsBusy(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();

      const amtA = ethers.utils.parseUnits(amountA, pair.tokenA.decimals);
      const amtB = ethers.utils.parseUnits(amountB, pair.tokenB.decimals);

      // Uniswap V3 requires token0 < token1 (sorted by address), and their
      // desired/min amounts have to line up with whichever token ends up
      // being token0 vs token1 - NOT necessarily tokenA/tokenB in the order
      // shown on screen.
      const aIsToken0 = pair.tokenA.sepoliaAddress.toLowerCase() < pair.tokenB.sepoliaAddress.toLowerCase();
      const token0 = aIsToken0 ? pair.tokenA : pair.tokenB;
      const token1 = aIsToken0 ? pair.tokenB : pair.tokenA;
      const amount0Desired = aIsToken0 ? amtA : amtB;
      const amount1Desired = aIsToken0 ? amtB : amtA;

      const tokenAContract = new ethers.Contract(pair.tokenA.sepoliaAddress, ERC20_ABI, signer);
      const tokenBContract = new ethers.Contract(pair.tokenB.sepoliaAddress, ERC20_ABI, signer);

      const [allowanceA, allowanceB] = await Promise.all([
        tokenAContract.allowance(address, POSITION_MANAGER_ADDRESS),
        tokenBContract.allowance(address, POSITION_MANAGER_ADDRESS),
      ]);

      if (allowanceA.lt(amtA)) {
        message.info(`Approve ${pair.tokenA.ticker} in MetaMask...`);
        const tx = await tokenAContract.approve(POSITION_MANAGER_ADDRESS, amtA);
        await tx.wait();
      }
      if (allowanceB.lt(amtB)) {
        message.info(`Approve ${pair.tokenB.ticker} in MetaMask...`);
        const tx = await tokenBContract.approve(POSITION_MANAGER_ADDRESS, amtB);
        await tx.wait();
      }

      const { tickLower, tickUpper } = fullRangeTicks(fee);
      const positionManager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 min

      message.info("Confirm in MetaMask to add liquidity...");
      const tx = await positionManager.mint({
        token0: token0.sepoliaAddress,
        token1: token1.sepoliaAddress,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        // Full-range positions accept whatever ratio the current price implies,
        // so a hard minimum here isn't meaningful the way it is for a swap -
        // any unused portion of either token (up to the Desired amount above)
        // is simply refunded to you by the contract, never lost.
        amount0Min: 0,
        amount1Min: 0,
        recipient: address,
        deadline,
      });
      await tx.wait();

      message.success("Liquidity added! This pool is now a little deeper for everyone, including your own future swaps.");
      setAmountA('');
      setAmountB('');
      fetchBalances();
    } catch (err) {
      console.error("Add liquidity failed:", err);
      const reason = err.reason || err.error?.message || err.message || "";
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        message.error("Cancelled");
      } else if (reason.includes("insufficient funds")) {
        message.error("Not enough balance for this amount plus gas.");
      } else {
        message.error(`Couldn't add liquidity: ${reason || "unknown error"}`);
      }
    } finally {
      setIsBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="tokensPage">
        <div className="tokensEmpty">Connect your wallet to add liquidity.</div>
      </div>
    );
  }

  if (!pair) {
    return (
      <div className="tokensPage">
        <div className="tokensEmpty">No poolable pairs configured.</div>
      </div>
    );
  }

  return (
    <div className="wrapBox" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
      <div className="wrapHeader">
        <h4>Add Liquidity</h4>
        <div className="wrapTabs">
          {PAIRS.map((p, i) => (
            <span
              key={p.label}
              className={i === pairIndex ? "wrapTab wrapTabActive" : "wrapTab"}
              onClick={() => { setPairIndex(i); setAmountA(''); setAmountB(''); }}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div className="poolNote">
        Anyone can add liquidity to this same pool - the more people deposit, the deeper
        it gets for every swap (including yours). Full-range position: your tokens cover
        the entire price curve, no range picking needed.
      </div>

      {fee === null && (
        <div className="poolNote poolNoteWarn">
          No live Uniswap pool found for {pair.label} on Sepolia yet - this pair can't be pooled here.
        </div>
      )}

      <div className="balanceRow">
        Available: {balanceA !== null ? Number(balanceA).toFixed(6) : "..."} {pair.tokenA.ticker}
      </div>
      <Input
        placeholder="0"
        value={amountA}
        onChange={(e) => setAmountA(e.target.value)}
      />

      <div className="balanceRow">
        Available: {balanceB !== null ? Number(balanceB).toFixed(6) : "..."} {pair.tokenB.ticker}
      </div>
      <Input
        placeholder="0"
        value={amountB}
        onChange={(e) => setAmountB(e.target.value)}
      />

      <button
        className="wrapButton"
        disabled={isBusy || fee === null || !amountA || !amountB}
        onClick={addLiquidity}
      >
        {isBusy ? "Processing..." : "Add Liquidity"}
      </button>
    </div>
  );
}

export default Pool
