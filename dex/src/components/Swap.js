import React,{useState, useEffect, useRef} from 'react'
import { Input, Popover, Radio, Modal, message } from "antd";
import {
  ArrowDownOutlined,
  DownOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import axios from "axios";
import { ethers } from "ethers";

import tokenList from "../tokenList.json";
import Receipt from "./Receipt";
import { API_BASE_URL } from "../apiConfig";

// Uniswap V3 QuoterV2 - deployed at a DIFFERENT address on Sepolia than on mainnet.
// (The mainnet QuoterV1 address has no contract code on Sepolia - calls to it
// were silently no-op-ing, which is why quotes/swaps looked like they "worked"
// but never actually moved any tokens.)
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

// Uniswap V3 Factory - used to auto-detect which fee tier actually has a live pool
const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];
const FEE_TIERS = [500, 3000, 10000, 100]; // check most common tiers first

// Uniswap V3 SwapRouter02 - deployed at a DIFFERENT address on Sepolia than on
// mainnet (the mainnet SwapRouter v1 address has no contract code on Sepolia,
// so swaps against it were silently doing nothing). SwapRouter02's
// exactInputSingle also has no `deadline` field, unlike the old v1 router.
const ROUTER_ADDRESS = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)"
];

// Floor per token below which a swap is rejected before it ever reaches
// MetaMask. Dust-sized inputs are the classic way to hit "Too little
// received" on-chain (the router itself reverts once your minimum-received
// rounds down to zero) - catching it here means you get one clear message
// up front instead of paying gas to watch it revert.
const MIN_SWAP_AMOUNT = {
  WETH: 0.0001,
  USDC: 0.5,
};

// A single-hop Uniswap V3 exactInputSingle swap (once the token is already
// approved) typically costs somewhere around 120k-180k gas. There's no way
// to get an exact number without actually simulating the specific call with
// a connected signer (and that simulation itself would revert for anyone
// who hasn't approved yet, or doesn't have balance) - so this uses a fixed,
// slightly-generous gas-limit assumption against the LIVE current gas price
// to give a realistic "you'll pay around this much" figure, same as what
// most wallets show before you've even opened MetaMask.
const SWAP_GAS_LIMIT_ESTIMATE = ethers.BigNumber.from(180000);

// Note: pool fee tier is now auto-detected via findPoolFee() instead of hardcoded,
// since Sepolia may have the WETH/USDC pool on a different fee tier than mainnet.

function Swap({ isConnected, address }) {
  const [slippage, setSlippage] = useState(2.5);
  const [tokenOneAmount, settokenOneAmount] = useState(null);
  const [tokenTwoAmount, settokenTwoAmount] = useState(null);
  const [tokenOne, settokenOne] = useState(tokenList[0]);
  const [tokenTwo, settokenTwo] = useState(tokenList[1]);
  const [isOpen, setIsOpen] = useState(false);
  const [changeToken, setChangeToken] = useState(1);
  const [prices, setPrices] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isSwapping, setIsSwapping] = useState(false);
  // Cached { fee, poolAddress } for the current tokenOne/tokenTwo pair, or
  // null if no live pool exists. This only depends on WHICH tokens are
  // selected, not on the amount typed, so it's detected once per pair
  // instead of on every keystroke (see the useEffect below).
  const [poolInfo, setPoolInfo] = useState(null);
  const [isQuoting, setIsQuoting] = useState(false);
  // Live "you'll pay roughly this much gas" figure, in ETH - refreshed
  // alongside the real on-chain quote (see fetchQuote/fetchGasEstimate).
  const [estimatedGasFee, setEstimatedGasFee] = useState(null);
  // Recipient of the swapped output tokens. Always editable - pre-filled
  // with your own wallet, but you can change it to anyone's address before
  // swapping. No toggle needed: it's just a normal field that happens to
  // start out as "you".
  const [recipientAddress, setRecipientAddress] = useState("");
  // Purely cosmetic - bumped on every switchTokens() click so the switch
  // icon can remount and replay its spin animation from scratch each time
  // (a toggled boolean would only visually change on every OTHER click).
  // Doesn't touch switchTokens()'s own logic at all.
  const [switchSpinCount, setSwitchSpinCount] = useState(0);
  // Purely cosmetic - briefly shows an animated checkmark overlay right
  // after a swap confirms (see confirmSwap's success branch). Doesn't
  // change what happens on success, just adds a visual flourish alongside
  // the existing message.success() toast.
  const [showSwapSuccess, setShowSwapSuccess] = useState(false);
  const quoteTimerRef = useRef(null);
  // Review-before-you-swap: clicking "Swap" no longer fires the transaction
  // directly. It opens this modal with a fresh quote, minimum received,
  // price impact, fee tier and recipient - the actual approve+swap only
  // happens once you hit "Confirm Swap" inside it.
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isPreparingReview, setIsPreparingReview] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  // Snapshot of the most recently completed swap, used to render/download a
  // receipt - cleared whenever a new one lands.
  const [lastReceipt, setLastReceipt] = useState(null);
  const tradeBoxRef = useRef(null);

  // Subtle mouse-tracking 3D tilt on the main card - purely a visual touch,
  // no state/re-renders involved, just moving the transform directly on the
  // DOM node for smoothness. Resets on mouse leave.
  function handleCardMouseMove(e) {
    const el = tradeBoxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const midX = rect.width / 2;
    const midY = rect.height / 2;
    const rotateY = ((x - midX) / midX) * 5; // max ~5deg
    const rotateX = -((y - midY) / midY) * 5;
    el.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
  }

  function handleCardMouseLeave() {
    const el = tradeBoxRef.current;
    if (!el) return;
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
  }

  function handleSlippageChange(e){
    setSlippage(e.target.value);
  }

  async function findPoolFee(provider, tokenA, tokenB) {
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    for (const fee of FEE_TIERS) {
      const pool = await factory.getPool(tokenA, tokenB, fee);
      console.log(`Fee ${fee}: pool address = ${pool}`);
      if (pool && pool !== ethers.constants.AddressZero) {
        return { fee, poolAddress: pool };
      }
    }
    return null; // no pool exists for any fee tier
  }

  // Detect (and cache) the live pool for the current token pair whenever the
  // pair changes - NOT on every keystroke. This is what used to run inside
  // changeAmount() on every single character typed, which meant every
  // keystroke fired the factory lookup across up to 4 fee tiers plus a
  // liquidity check before the quote could even be requested - that chain of
  // sequential RPC calls was the main cause of the input lag.
  useEffect(() => {
    let cancelled = false;

    async function detectPool() {
      setPoolInfo(null);
      if (!tokenOne.sepoliaAddress || !tokenTwo.sepoliaAddress) return;

      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const poolResult = await findPoolFee(provider, tokenOne.sepoliaAddress, tokenTwo.sepoliaAddress);
        if (cancelled) return;
        if (poolResult === null) {
          console.warn("No Uniswap pool found on Sepolia for this pair on any fee tier.");
          return;
        }

        const poolContract = new ethers.Contract(
          poolResult.poolAddress,
          ["function liquidity() external view returns (uint128)"],
          provider
        );
        const liquidity = await poolContract.liquidity();
        if (cancelled) return;

        if (liquidity.eq(0)) {
          console.warn("Pool exists but has ZERO liquidity - quote will fail.");
          return;
        }
        setPoolInfo(poolResult);
      } catch (err) {
        console.error("Pool detection failed:", err);
      }
    }

    detectPool();
    return () => { cancelled = true; };
  }, [tokenOne, tokenTwo]);

  // "How much gas will this actually cost me" - current network gas price
  // times the flat SWAP_GAS_LIMIT_ESTIMATE assumption above. Takes an
  // already-open provider so it can run in parallel with the quote call
  // instead of opening a second connection.
  async function fetchGasEstimate(provider) {
    try {
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
      if (!gasPrice) return;
      const estimatedCost = gasPrice.mul(SWAP_GAS_LIMIT_ESTIMATE);
      setEstimatedGasFee(ethers.utils.formatEther(estimatedCost));
    } catch (err) {
      console.error("Gas estimate fetch failed:", err);
    }
  }

  // Actually fetch the quote for a given input amount, using the cached
  // pool/fee (no factory/liquidity lookups here - just the quoter call).
  // QuoterV2's callStatic actually simulates the swap on-chain, so it's
  // inherently slower than a normal read (often 1-3s over RPC) - that part
  // can't be made instant. isQuoting flips on/off around it so the UI can
  // show a "getting best price" indicator instead of looking frozen.
  // `silent` is used by the background live-price ticker below - it updates
  // the number the same way, just without flashing the loading text every
  // few seconds.
  async function fetchQuote(value, { silent = false } = {}) {
    if (!silent) setIsQuoting(true);
    try {
      if (poolInfo) {
        try {
          const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
          const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
          const amountIn = ethers.utils.parseUnits(value, tokenOne.decimals);

          // QuoterV2 takes a struct and returns a tuple - only the first
          // value (amountOut) is what we need here. The gas-price lookup
          // for the "Estimated gas" line rides along in the same
          // Promise.all - it's not needed on every silent 3s tick, only on
          // the real debounced quote, so it doesn't add extra RPC traffic
          // for something that barely moves that often.
          const [result] = await Promise.all([
            quoter.callStatic.quoteExactInputSingle({
              tokenIn: tokenOne.sepoliaAddress,
              tokenOut: tokenTwo.sepoliaAddress,
              amountIn,
              fee: poolInfo.fee,
              sqrtPriceLimitX96: 0,
            }),
            !silent ? fetchGasEstimate(provider) : Promise.resolve(),
          ]);
          const amountOut = result.amountOut ?? result[0];

          settokenTwoAmount(ethers.utils.formatUnits(amountOut, tokenTwo.decimals));
          return;
        } catch (err) {
          console.error("On-chain quote failed, falling back to price ratio:", err);
        }
      }

      // Fallback: CoinGecko USD price ratio (approximate, works for any pair).
      // Kept prefixed with "~" since, unlike the on-chain branch above, this
      // number is never exact - there's no real Sepolia pool for this pair
      // to simulate against, so this estimate IS the final answer.
      if (prices) {
        settokenTwoAmount(`~${(value * prices.ratio).toFixed(6)}`);
      } else {
        settokenTwoAmount(null);
      }
    } finally {
      if (!silent) setIsQuoting(false);
    }
  }

  // Keep the quote LIVE the same way a real market would: the price can
  // move even while you're just sitting there looking at it, or while a
  // swap you already submitted is still confirming. Re-fetch quietly in the
  // background every few seconds instead of only reacting to typing, so the
  // number visibly ticks - mirroring how a real on-chain price behaves (and
  // matches the slippage-guard reference demo's background market tick).
  // This is purely a DISPLAY refresh: openReviewModal() always re-quotes
  // fresh right before showing the review, independent of this timer, so
  // it can never send a stale number.
  useEffect(() => {
    if (!tokenOneAmount) return undefined;
    const interval = setInterval(() => {
      fetchQuote(tokenOneAmount, { silent: true });
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenOneAmount, tokenOne, tokenTwo, poolInfo]);

  function changeAmount(e){
    const value = e.target.value;
    settokenOneAmount(value);

    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
    }

    if (!value) {
      settokenTwoAmount(null);
      setIsQuoting(false);
      return;
    }

    // Instant feedback: show a rough estimate right away from the cached
    // USD price ratio (pure local math, no RPC call) so the output field
    // never just sits frozen while you type. Prefixed with "~" because for
    // USDC/WETH (the only pair with a real Sepolia pool) this number gets
    // replaced a moment later by the exact on-chain quote - the "~" makes
    // that second update read as "refining to the exact price" instead of
    // looking like a random late correction.
    if (prices) {
      settokenTwoAmount(`~${(value * prices.ratio).toFixed(6)}`);
    }

    // Debounce: wait for a short pause in typing before firing the (slower,
    // exact) on-chain quote, instead of on every keystroke.
    quoteTimerRef.current = setTimeout(() => {
      fetchQuote(value);
    }, 250);
  }
  function switchTokens() {
  setPrices(null);
  settokenOneAmount(null);
  settokenTwoAmount(null);
  const one = tokenOne;
  const two = tokenTwo;

  settokenOne(two);
  settokenTwo(one);
}
function openModal(asset){
  setChangeToken(asset);
  setIsOpen(true);
}
function modifyToken(i) {
  setPrices(null);
  settokenOneAmount(null);
  settokenTwoAmount(null);
  if (changeToken === 1) {
    settokenOne(tokenList[i]);
  } else {
    settokenTwo(tokenList[i]);
  }
  setIsOpen(false);
}

useEffect(() => {
  fetchPrices(tokenOne.address, tokenTwo.address);
}, [tokenOne, tokenTwo]);

useEffect(() => {
  fetchBalance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tokenOne, address, isConnected]);

// Default the recipient field to your own wallet the first time it's known -
// but only if you haven't already typed something else in there, so this
// never overwrites an address you deliberately entered.
useEffect(() => {
  if (address) {
    setRecipientAddress((prev) => prev || address);
  }
}, [address]);

async function fetchBalance() {
  if (!isConnected || !tokenOne.sepoliaAddress) {
    setBalance(null);
    return;
  }
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const tokenContract = new ethers.Contract(tokenOne.sepoliaAddress, ERC20_ABI, provider);
    const rawBalance = await tokenContract.balanceOf(address);
    setBalance(ethers.utils.formatUnits(rawBalance, tokenOne.decimals));
  } catch (err) {
    console.error("Balance fetch failed:", err);
    setBalance(null);
  }
}

// After a swap, the RPC node behind MetaMask sometimes takes a block or two to
// reflect the new balance even though the tx is already mined/confirmed.
// Poll balanceOf a few times until it actually changes from the pre-swap value,
// instead of trusting a single immediate fetch.
async function pollBalanceUntilChanged(previousBalance, attempts = 6, delayMs = 1500) {
  if (!tokenOne.sepoliaAddress) return;
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const tokenContract = new ethers.Contract(tokenOne.sepoliaAddress, ERC20_ABI, provider);

  for (let i = 0; i < attempts; i++) {
    try {
      const rawBalance = await tokenContract.balanceOf(address);
      const formatted = ethers.utils.formatUnits(rawBalance, tokenOne.decimals);
      if (formatted !== previousBalance) {
        setBalance(formatted);
        return;
      }
      setBalance(formatted); // keep it fresh even if unchanged yet
    } catch (err) {
      console.error("Balance poll failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function setMaxAmount() {
  if (balance) {
    settokenOneAmount(balance);
    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
    }
    fetchQuote(balance); // deliberate one-off action - no need to debounce
  }
}

// HALF/25%/50%/75% quick-select buttons - same "deliberate one-off action,
// skip the debounce" pattern as MAX above, just against a fraction of the
// current balance instead of all of it.
function setAmountFraction(fraction) {
  if (!balance) return;
  const amount = (Number(balance) * fraction).toFixed(6);
  settokenOneAmount(amount);
  if (quoteTimerRef.current) {
    clearTimeout(quoteTimerRef.current);
  }
  fetchQuote(amount);
}

function fetchPrices(one, two) {
  axios.get(`${API_BASE_URL}/tokenPrice`, {
    params: { addressOne: one, addressTwo: two }
  }).then((res) => {
    if (res.data.tokenOne && res.data.tokenTwo) {
      const ratio = res.data.tokenOne / res.data.tokenTwo;
      setPrices({ tokenOne: res.data.tokenOne, tokenTwo: res.data.tokenTwo, ratio });
    }
  }).catch((err) => {
    console.error("Price fetch failed:", err);
  });
}

// Step 1: validate everything that doesn't need a network call, then fetch
// a fresh quote + an approximate price impact and open the review modal.
// No token has moved yet - this is purely "let me show you exactly what
// this swap would do before you commit to it," the same way real Uniswap's
// confirm screen works.
async function openReviewModal() {
  if (isSwapping || isPreparingReview) {
    return;
  }
  if (!isConnected) {
    message.error("Please connect your wallet first");
    return;
  }
  if (!tokenOne.sepoliaAddress || !tokenTwo.sepoliaAddress) {
    message.error("This testnet only supports swapping between WETH & USDC");
    return;
  }
  if (!tokenOneAmount) {
    message.error("Please enter an amount");
    return;
  }
  if (balance && Number(tokenOneAmount) > Number(balance)) {
    message.error(`Insufficient balance. You only have ${Number(balance).toFixed(6)} ${tokenOne.ticker}`);
    return;
  }
  // Amount too small to be worth submitting - reject it here instead of
  // letting it go all the way to a MetaMask popup and an on-chain revert.
  const minAmount = MIN_SWAP_AMOUNT[tokenOne.ticker] ?? 0;
  if (Number(tokenOneAmount) < minAmount) {
    message.error(
      `Amount too low - enter at least ${minAmount} ${tokenOne.ticker}. Very small amounts round down to ` +
      `zero output and the swap would just revert.`
    );
    return;
  }
  // Validated here (not just when typed) so a swap can never fire with a
  // malformed address - tokens sent to an invalid/mistyped address on-chain
  // are unrecoverable, there's no "undo".
  if (!recipientAddress || !ethers.utils.isAddress(recipientAddress)) {
    message.error("Enter a valid recipient address (0x...).");
    return;
  }
  if (recipientAddress.toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
    message.error("Can't send to the zero address - the tokens would be lost forever with no way to recover them.");
    return;
  }

  setIsPreparingReview(true);
  try {
    // Use Infura for read-only calls - MetaMask's own RPC sometimes doesn't
    // return proper revert data for eth_call simulations, causing the
    // Quoter's callStatic to fail with an empty CALL_EXCEPTION.
    const readProvider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);

    // Make sure this address can actually receive the tokens before letting
    // the transaction go through at all. A plain wallet (EOA) has no
    // deployed code and always accepts ERC-20 transfers. A contract address
    // is riskier - if it's not built to expect these tokens (no way to
    // withdraw them back out), anything sent there can be stuck permanently
    // with zero way to reach the intended recipient again. So this is
    // checked up front and the transaction is stopped before it ever gets
    // to MetaMask, with a clear reason why.
    const recipientCode = await readProvider.getCode(recipientAddress);
    if (recipientCode !== "0x") {
      message.error({
        content:
          "This recipient address is a smart contract, not a regular wallet - it may not be able to receive " +
          "these tokens, and they could get stuck there permanently. Transaction stopped so it doesn't reach " +
          "an address that can't actually use it. Double-check the address and try again.",
        duration: 7,
      });
      return;
    }

    // The pair's fee tier was already detected (and its liquidity checked)
    // by the useEffect that runs whenever tokenOne/tokenTwo change, so reuse
    // that cached result instead of re-running findPoolFee's up-to-4
    // sequential factory calls again here - this alone used to be a big
    // chunk of the "Review Swap" wait. Only fall back to a fresh lookup if
    // that detection hasn't resolved yet (or failed) for some reason.
    let fee = poolInfo?.fee;
    if (fee === undefined) {
      const poolResult = await findPoolFee(readProvider, tokenOne.sepoliaAddress, tokenTwo.sepoliaAddress);
      if (poolResult === null) {
        message.error("No liquidity pool found for this pair on Sepolia testnet.");
        return;
      }
      fee = poolResult.fee;
    }

    const amountIn = ethers.utils.parseUnits(tokenOneAmount, tokenOne.decimals);
    const refAmountIn = ethers.utils.parseUnits("0.0001", tokenOne.decimals);
    const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, readProvider);

    // The real quote for the amount you're actually swapping, plus a tiny
    // reference-amount quote (no meaningful size, so ~no impact) used below
    // for the price-impact estimate. These two don't depend on each other,
    // so they're fired together instead of one after the other.
    const [freshQuote, refQuote] = await Promise.all([
      quoter.callStatic.quoteExactInputSingle({
        tokenIn: tokenOne.sepoliaAddress,
        tokenOut: tokenTwo.sepoliaAddress,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0,
      }),
      quoter.callStatic.quoteExactInputSingle({
        tokenIn: tokenOne.sepoliaAddress,
        tokenOut: tokenTwo.sepoliaAddress,
        amountIn: refAmountIn,
        fee,
        sqrtPriceLimitX96: 0,
      }).catch((err) => {
        console.error("Could not estimate price impact:", err);
        return null;
      }),
    ]);
    const freshAmountOut = freshQuote.amountOut ?? freshQuote[0];

    // Scale the reference rate up to your real amount to get the "ideal"
    // output if the pool had infinite depth, then compare that to what
    // you'd actually get. Same idea as the slippage-guard demo's impactPct
    // calc, just against the real on-chain pool instead of a simulated one.
    let priceImpactPct = null;
    if (refQuote) {
      const refAmountOut = refQuote.amountOut ?? refQuote[0];
      if (!refAmountOut.isZero()) {
        const idealOut = refAmountOut.mul(amountIn).div(refAmountIn);
        if (!idealOut.isZero()) {
          const diff = idealOut.sub(freshAmountOut);
          priceImpactPct = (diff.mul(1000000).div(idealOut).toNumber()) / 10000; // -> %
        }
      }
    }

    const slippageBps = Math.round(slippage * 100); // e.g. 2.5% -> 250 bps
    const amountOutMinimum = freshAmountOut.mul(10000 - slippageBps).div(10000);

    // Belt-and-suspenders on top of the fixed MIN_SWAP_AMOUNT floor above:
    // that check uses a rough per-token guess, but this checks the REAL
    // on-chain quote. If the guaranteed minimum you'd receive has already
    // rounded down to zero, the Uniswap router would reject this on-chain
    // no matter what ("Too little received") - so stop it here instead of
    // making you pay gas to find that out.
    if (amountOutMinimum.isZero()) {
      message.error(
        `This amount is too small - after your ${slippage}% slippage tolerance, the guaranteed minimum ` +
        `you'd receive rounds down to zero, so the swap would revert. Enter a larger amount.`
      );
      return;
    }

    setReviewData({
      fee,
      amountIn,
      freshAmountOut,
      amountOutMinimum,
      priceImpactPct,
      recipient: recipientAddress,
      estimatedGasFee,
    });
    setIsReviewOpen(true);
  } catch (err) {
    console.error("Could not prepare swap review:", err);
    message.error("Could not fetch a fresh quote right now. Please try again.");
  } finally {
    setIsPreparingReview(false);
  }
}

// Step 2: this is what "Confirm Swap" inside the review modal actually
// runs - the real approve (if needed) + exactInputSingle, using exactly
// the fee/amountOutMinimum/recipient shown in the review.
async function confirmSwap() {
  if (isSwapping || !reviewData) {
    return;
  }
  const { fee, amountIn, amountOutMinimum, recipient } = reviewData;

  setIsSwapping(true);
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();

    // 1. Approve the Router to spend tokenOne (only if needed)
    const tokenContract = new ethers.Contract(tokenOne.sepoliaAddress, ERC20_ABI, signer);
    const currentAllowance = await tokenContract.allowance(address, ROUTER_ADDRESS);

    if (currentAllowance.lt(amountIn)) {
      message.info("Please approve the token in MetaMask...");
      // Approve only the exact amount being swapped, not an unlimited cap.
      // MetaMask's approval popup then shows the real number you're about
      // to send instead of "Unlimited", which is what most wallets flag
      // with a security warning. Trade-off: since an exact approval gets
      // fully consumed by the swap it covers, the NEXT swap of this same
      // token needs a fresh approve - one extra MetaMask popup per swap,
      // in exchange for a popup that shows an honest, bounded amount.
      const approveTx = await tokenContract.approve(ROUTER_ADDRESS, amountIn);
      await approveTx.wait();
      message.success("Token approved!");
    }

    // 2. Execute the swap. amountOutMinimum here is the SLIPPAGE PROTECTION:
    // if, by the time this actually gets mined, the real output would be
    // LESS than this (price moved against you more than your tolerance
    // allows), the Uniswap Router contract itself REJECTS the transaction
    // on-chain ("Too little received" / "STF"). Your tokens are NOT swapped
    // at a bad rate - the whole transaction reverts and you only lose the
    // gas fee, not your funds.
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
    message.info("Confirm the swap transaction in MetaMask...");
    const swapTx = await router.exactInputSingle({
  tokenIn: tokenOne.sepoliaAddress,
  tokenOut: tokenTwo.sepoliaAddress,
  fee: fee,
  recipient: recipient,
  amountIn,
  amountOutMinimum,
  sqrtPriceLimitX96: 0,
});

console.log("Swap tx hash:", swapTx.hash);
message.info("Transaction submitted, waiting for confirmation...");

const receipt = await swapTx.wait();

console.log("Receipt:", receipt);
console.log("Logs:", receipt.logs);

message.success("Swap successful! 🎉");
setShowSwapSuccess(true);
setTimeout(() => setShowSwapSuccess(false), 2200);

    // Snapshot everything the receipt needs before the inputs get cleared
    // below - reviewData is still the data this exact transaction was
    // built from, so the receipt reflects what actually happened, not a
    // freshly re-quoted number.
    setLastReceipt({
      txHash: swapTx.hash,
      timestamp: new Date(),
      tokenInTicker: tokenOne.ticker,
      amountIn: tokenOneAmount,
      tokenOutTicker: tokenTwo.ticker,
      amountOut: ethers.utils.formatUnits(reviewData.freshAmountOut, tokenTwo.decimals),
      fee,
      slippage,
      gasFee: estimatedGasFee,
      sender: address,
      recipient,
    });

    // Refresh balance and clear inputs after a successful swap.
    // Use polling (not a single fetch) since the RPC node can lag a block
    // or two behind before it reports the updated balance.
    settokenOneAmount(null);
    settokenTwoAmount(null);
    pollBalanceUntilChanged(balance);
    setIsReviewOpen(false);
    setReviewData(null);
  } catch (err) {
    console.error("Swap failed:", err);

    const reason = err.reason || err.error?.message || err.message || "";
    if (reason.includes("Too little received")) {
      // This is the exact protection your slippage tolerance exists for:
      // the amount you'd actually receive dropped by more than the allowed
      // % between quoting and execution, so the Uniswap contract itself
      // refused to complete the swap - on purpose. Nothing was swapped at
      // a bad rate; you only paid gas.
      message.error({
        content:
          `Transaction reverted: the amount would have decreased by more than your ` +
          `${slippage}% tolerance, so the swap was NOT completed. Your tokens are safe - ` +
          `only the gas fee was spent. Try again or raise your slippage tolerance in Settings.`,
        duration: 6,
      });
    } else if (reason.includes("STF")) {
      // "STF" (Safe Transfer Failed) is a different failure - a token
      // transfer inside the swap didn't go through (e.g. an allowance
      // issue), not necessarily the price moving. Kept separate from the
      // slippage message above so we don't mislead you about the cause.
      message.error({
        content: "Swap reverted: a token transfer failed (STF). Please try the swap again.",
        duration: 6,
      });
    } else if (reason.includes("insufficient funds")) {
      message.error("Insufficient ETH for gas fees. Get more Sepolia test ETH from a faucet.");
    } else if (err.code === "ACTION_REJECTED" || err.code === 4001) {
      message.error("Transaction cancelled");
    } else {
      message.error("Swap failed: " + reason);
    }
  } finally {
    setIsSwapping(false);
  }
}

  // Derived, not stored in state: whatever the two amount fields currently
  // show (strip the "~" estimate marker) expressed as a rate, so the little
  // "live" line below always matches exactly what's in the boxes above it.
  const cleanTokenTwoAmount = tokenTwoAmount ? tokenTwoAmount.replace('~', '') : null;
  const liveRate =
    tokenOneAmount && cleanTokenTwoAmount && Number(tokenOneAmount) > 0
      ? Number(cleanTokenTwoAmount) / Number(tokenOneAmount)
      : null;

  const settings = (
    <>
    <div>Slippage Tolerance</div>
    <div>
    <Radio.Group value={slippage} onChange={handleSlippageChange}>
    <Radio.Button value={0.5}>0.5%</Radio.Button>
    <Radio.Button value={2.5}>2.5%</Radio.Button>
    <Radio.Button value={5}>5.0%</Radio.Button>
    </Radio.Group>

    </div>
    </>
  );
  return (
    <>
    <Modal 
     open={isOpen}
     footer={null}
     onCancel={ () => setIsOpen(false)}
     title="Select a token"
    >
      <div className="modalContent">
          {tokenList?.map((e, i) => {
            const supported = !!e.sepoliaAddress;
            return (
          <div
           className={supported ? "tokenChoice" : "tokenChoice tokenChoiceDisabled"}
           key={i}
           onClick={() => supported && modifyToken(i)}
           >
          <img src={e.img} alt={e.ticker} className="tokenLogo" />
          <div className="tokenChoiceNames">
           <div className="tokenName">{e.name}</div>
            <div className="tokenTicker">{e.ticker}</div>
           </div>
           {!supported && <div className="testnetBadge">Testnet unsupported</div>}
           </div>
            );
          })}
      </div>

    </Modal>
    <Modal
      open={isReviewOpen}
      footer={null}
      closable={!isSwapping}
      maskClosable={!isSwapping}
      onCancel={() => { if (!isSwapping) { setIsReviewOpen(false); setReviewData(null); } }}
      title="Review Swap"
    >
      {reviewData && (
        <div className="reviewContent">
          <div className="reviewRow">
            <span>You pay</span>
            <span>{tokenOneAmount} {tokenOne.ticker}</span>
          </div>
          <div className="reviewRow">
            <span>You receive (estimated)</span>
            <span>{ethers.utils.formatUnits(reviewData.freshAmountOut, tokenTwo.decimals)} {tokenTwo.ticker}</span>
          </div>
          <div className="reviewRow">
            <span>Minimum received</span>
            <span>{ethers.utils.formatUnits(reviewData.amountOutMinimum, tokenTwo.decimals)} {tokenTwo.ticker}</span>
          </div>
          {reviewData.priceImpactPct !== null && (
            <div className="reviewRow">
              <span>Price impact</span>
              <span className={reviewData.priceImpactPct > 5 ? "reviewImpactHigh" : ""}>
                {reviewData.priceImpactPct >= 0 ? "-" : "+"}
                {Math.abs(reviewData.priceImpactPct).toFixed(2)}%
              </span>
            </div>
          )}
          <div className="reviewRow">
            <span>Fee tier</span>
            <span>{(reviewData.fee / 10000).toFixed(2)}%</span>
          </div>
          {reviewData.estimatedGasFee && (
            <div className="reviewRow">
              <span>Estimated gas fee</span>
              <span>~{Number(reviewData.estimatedGasFee).toFixed(6)} ETH</span>
            </div>
          )}
          <div className="reviewRow">
            <span>Slippage tolerance</span>
            <span>{slippage}%</span>
          </div>
          <div className="reviewRow">
            <span>Recipient</span>
            <span className="recipientAddr">
              {reviewData.recipient.slice(0, 6)}...{reviewData.recipient.slice(-4)}
            </span>
          </div>

          {reviewData.priceImpactPct !== null && reviewData.priceImpactPct > 5 && (
            <div className="reviewWarning">
              High price impact - you'll get a noticeably worse rate than the current market
              price for this size. Consider swapping a smaller amount.
            </div>
          )}

          <button className="swapButton" disabled={isSwapping} onClick={confirmSwap}>
            {isSwapping ? "Swapping..." : "Confirm Swap"}
          </button>
        </div>
      )}
    </Modal>
    <div className="swapPageColumn">
    <div
      className="tradeBox"
      ref={tradeBoxRef}
      onMouseMove={handleCardMouseMove}
      onMouseLeave={handleCardMouseLeave}
    >

    {showSwapSuccess && (
      <div className="swapSuccessOverlay">
        <svg className="swapSuccessCheck" viewBox="0 0 52 52">
          <circle className="swapSuccessCheckCircle" cx="26" cy="26" r="24" fill="none" />
          <path className="swapSuccessCheckMark" fill="none" d="M14 27l7 7 16-16" />
        </svg>
        <div className="swapSuccessText">Swap Successful</div>
      </div>
    )}

    <div className="tradeBoxHeader">
      <h4>Swap</h4>
     <Popover
  content={settings}
  title="Settings"
  trigger="click"
  placement="bottomRight"
>
           <SettingOutlined className="cop" />
      </Popover>
      
    </div>
    {balance && (
      <div className="quickAmountRow">
        <span className="quickAmountBtn" onClick={setMaxAmount}>MAX</span>
        <span className="quickAmountBtn" onClick={() => setAmountFraction(0.5)}>HALF</span>
        <span className="quickAmountBtn" onClick={() => setAmountFraction(0.25)}>25%</span>
        <span className="quickAmountBtn" onClick={() => setAmountFraction(0.5)}>50%</span>
        <span className="quickAmountBtn" onClick={() => setAmountFraction(0.75)}>75%</span>
      </div>
    )}
    <div className="inputs">
      {balance && (
        <div className="balanceRow">
          Available: {Number(balance).toFixed(6)} {tokenOne.ticker}
        </div>
      )}
      <Input placeholder="0" value={tokenOneAmount} onChange={changeAmount} />
       <Input placeholder="0" value={tokenTwoAmount} disabled={true} />
       {isQuoting && (
         <div className="quotingRow">
           Getting best price <span className="quotingShimmer"></span>
         </div>
       )}
       {!isQuoting && liveRate !== null && (
         <div className="rateRow">
           <span className="liveDot"></span>
           1 {tokenOne.ticker} = {liveRate.toFixed(6)} {tokenTwo.ticker}
         </div>
       )}
       {!isQuoting && estimatedGasFee !== null && (
         <div className="gasEstimateRow">
           <ThunderboltOutlined /> Estimated gas: ~{Number(estimatedGasFee).toFixed(6)} ETH
         </div>
       )}
       <div
         className="switchButton"
         onClick={() => {
           switchTokens();
           setSwitchSpinCount((c) => c + 1);
         }}
       >
          <ArrowDownOutlined key={switchSpinCount} className="switchArrow" />
       </div>
       <div className="assetOne" onClick={() => openModal(1)}>
        <img src={tokenOne.img} alt="assetOneLogo" className="assetLogo" />
        {tokenOne.ticker}
        <DownOutlined />
       </div>
        <div className="assetTwo"  onClick={() => openModal(2)}>
        <img src={tokenTwo.img} alt="assetOneLogo" className="assetLogo" />
        {tokenTwo.ticker}
        <DownOutlined />
        </div>
    </div>
    {isConnected && address && (
      <div className="recipientBox">
        <div className="recipientEditHeader">
          Send output to
          {recipientAddress?.toLowerCase() === address.toLowerCase() ? (
            <span className="recipientToggle" style={{ visibility: "hidden" }}>reset</span>
          ) : (
            <span className="recipientToggle" onClick={() => setRecipientAddress(address)}>
              Reset to my wallet
            </span>
          )}
        </div>
        <Input
          placeholder="0x recipient address"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          status={recipientAddress && !ethers.utils.isAddress(recipientAddress) ? "error" : ""}
        />
        {recipientAddress && !ethers.utils.isAddress(recipientAddress) && (
          <div className="recipientError">That doesn't look like a valid address.</div>
        )}
      </div>
    )}
    <button
      className="swapButton"
      disabled={
        !tokenOneAmount ||
        !isConnected ||
        isSwapping ||
        isPreparingReview ||
        !ethers.utils.isAddress(recipientAddress)
      }
      onClick={openReviewModal}
    >
      {isPreparingReview ? "Fetching quote..." : "Review Swap"}
    </button>
    </div>

    {lastReceipt && (
      <div className="receiptPrompt">
        <div className="receiptPromptText">
          <strong>Swap complete.</strong> Download a receipt for your records.
        </div>
        <button className="receiptDownloadBtn" onClick={() => window.print()}>
          Download Receipt
        </button>
      </div>
    )}
    {/* Hidden on screen, only rendered when window.print() runs - see .receiptPrintOnly */}
    <Receipt data={lastReceipt} />
    </div>
    </>
  );
}

export default Swap