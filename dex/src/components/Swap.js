import React,{useState, useEffect, useRef} from 'react'
import { Input, Modal, message } from "antd";
import {
  ArrowDownOutlined,
  DownOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import axios from "axios";
import { ethers } from "ethers";

import { Link } from "react-router-dom";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import Receipt from "./Receipt";
import { API_BASE_URL } from "../apiConfig";
import ThreeDBackground from "./ui/ThreeDBackground";
import GlassCard from "./ui/GlassCard";
import TokenIcon from "./ui/TokenIcon";
import PrimaryButton from "./ui/PrimaryButton";
import { useNotifications } from "../context/NotificationsContext";

// Every Sepolia-supported token gets a coin in the full ring surrounding the
// trade card - purely presentational (which tokens can actually be swapped
// is still entirely governed by tokenList's own sepoliaAddress field, read
// elsewhere in this file exactly as before).
const RING_COINS = tokenList.filter((t) => t.sepoliaAddress).map((t) => ({ ticker: t.ticker }));

// Uniswap V3 QuoterV2 - deployed at a DIFFERENT address on Sepolia than on mainnet.
// (The mainnet QuoterV1 address has no contract code on Sepolia - calls to it
// were silently no-op-ing, which is why quotes/swaps looked like they "worked"
// but never actually moved any tokens.)
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  // Multi-hop quote - verified live against Sepolia (real quoteExactInput
  // call cross-checked against two chained quoteExactInputSingle calls,
  // both returned identical results) before this was wired into the UI.
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
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
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  // Multi-hop execution - verified read-only (callStatic, no signer, no tx)
  // against the live Sepolia deployment: reverted with "STF" (a real
  // execution-path revert, not a missing-function error), confirming this
  // function exists and is reachable on ROUTER_ADDRESS above.
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
  // ERC-2612 permit + multicall - verified read-only against the deployed
  // Sepolia router: all four selectors (multicall, selfPermit,
  // selfPermitIfNecessary, selfPermitAllowed(IfNecessary)) were found
  // present in the router's actual runtime bytecode, confirming this is the
  // full official SwapRouter02 periphery contract, not a stripped build.
  "function selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external payable",
  "function multicall(bytes[] data) external payable returns (bytes[] memory results)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  // Only used for the ERC-2612 permit path (USDC) - real on-chain reads,
  // never a substitute for the allowance/approve fallback used by every
  // other token.
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)"
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

// Fixed internal safety margin used to compute amountOutMinimum for the
// on-chain swap call. No longer user-configurable (there's no Settings UI
// for it) - this exists purely so the Uniswap Router still has a sane
// minimum-received guard against the price moving between quote and
// execution. Not shown anywhere in the UI.
const DEFAULT_SLIPPAGE_PCT = 2.5;

// A single-hop Uniswap V3 exactInputSingle swap (once the token is already
// approved) typically costs somewhere around 120k-180k gas. There's no way
// to get an exact number without actually simulating the specific call with
// a connected signer (and that simulation itself would revert for anyone
// who hasn't approved yet, or doesn't have balance) - so this uses a fixed,
// slightly-generous gas-limit assumption against the LIVE current gas price
// to give a realistic "you'll pay around this much" figure, same as what
// most wallets show before you've even opened MetaMask.
const SWAP_GAS_LIMIT_ESTIMATE = ethers.BigNumber.from(180000);

// ERC-2612 permit support - verified read-only against the deployed Sepolia
// USDC contract only (nonces()/DOMAIN_SEPARATOR() both succeed there; every
// other supported token was checked the same way and does NOT support
// permit - NOVA/FSN/VRTX/ORBT/WETH/LINK all keep the standard approve flow
// below, unchanged). Detection is by the verified deployed address, not by
// ticker/name, per requirement.
const SEPOLIA_CHAIN_ID = 11155111;
// The verified deployed USDC address (same source already used elsewhere in
// this project) - detection uses this address, never the token's ticker or
// display name.
const USDC_ADDRESS = analyticsConfig.usdcAddress;
// name="USDC", version="2" was verified by reproducing the token's real
// on-chain DOMAIN_SEPARATOR() byte-for-byte before this was ever wired into
// a signature request - see project history for the verification method.
const USDC_PERMIT_DOMAIN_VERSION = "2";
function isPermitSupportedToken(token) {
  return !!token.sepoliaAddress && token.sepoliaAddress.toLowerCase() === USDC_ADDRESS.toLowerCase();
}

// Note: pool fee tier is now auto-detected via findPoolFee() instead of hardcoded,
// since Sepolia may have the WETH/USDC pool on a different fee tier than mainnet.

// Tokens intermediate/candidate-route generation is allowed to consider -
// same set AddLiquidity.js uses (anything actually deployed on this testnet).
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

// Standard Uniswap V3 path encoding: token - fee - token - fee - token ...
// Verified live against Sepolia's QuoterV2.quoteExactInput before use here.
function encodePath(tokens, fees) {
  const types = [];
  const values = [];
  for (let i = 0; i < fees.length; i++) {
    types.push("address", "uint24");
    values.push(tokens[i], fees[i]);
  }
  types.push("address");
  values.push(tokens[tokens.length - 1]);
  return ethers.utils.solidityPack(types, values);
}

// Real reference USD price for a route's OUTPUT token, used only to convert
// a route's real gas cost into the same unit as its real quoted output so
// routes can be compared on a like-for-like "gas-adjusted output" basis.
// USDC is treated at its standard $1 peg; the four project tokens use the
// same analyticsConfig priceUsd values already relied on elsewhere in this
// app (Pools/Markets TVL) - not a new or invented data source. Returns null
// (never a guess) for any token without a known reference price.
function getStaticUsdPrice(ticker) {
  if (ticker === "USDC") return 1;
  const entry = analyticsConfig.tokens.find((t) => t.ticker === ticker);
  return entry ? entry.priceUsd : null;
}

function Swap({ isConnected, address }) {
  const [tokenOneAmount, settokenOneAmount] = useState(null);
  const [tokenTwoAmount, settokenTwoAmount] = useState(null);
  const [tokenOne, settokenOne] = useState(tokenList[0]);
  const [tokenTwo, settokenTwo] = useState(tokenList[1]);
  const [isOpen, setIsOpen] = useState(false);
  const [changeToken, setChangeToken] = useState(1);
  const [prices, setPrices] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isSwapping, setIsSwapping] = useState(false);
  // Distinct from isSwapping - true only while waiting on the free,
  // off-chain EIP-712 permit SIGNATURE (USDC only), before the actual swap
  // transaction is ever submitted. Never used to describe the signature as
  // a transaction anywhere in the UI.
  const [isRequestingSignature, setIsRequestingSignature] = useState(false);
  // Cached { fee, poolAddress } for the current tokenOne/tokenTwo pair, or
  // null if no live pool exists. This only depends on WHICH tokens are
  // selected, not on the amount typed, so it's detected once per pair
  // instead of on every keystroke (see the useEffect below).
  const [poolInfo, setPoolInfo] = useState(null);
  // Real 2-hop candidates for the current pair - [{midToken, leg1, leg2}],
  // only ever populated with legs that actually exist on-chain (via
  // Factory.getPool) AND have non-zero liquidity on BOTH legs. Detected once
  // per pair change, same lifecycle as poolInfo above.
  const [hopCandidates, setHopCandidates] = useState([]);
  // The route actually chosen by the adaptive selector for the current
  // amount - { type: 'direct'|'2hop', hopsLabel, fee|path, amountOut,
  // gasEstimate, priceImpactPct, outputHuman, netScoreUsd }. Null until a
  // real amount has been quoted. This is what confirmSwap() executes.
  const [selectedRoute, setSelectedRoute] = useState(null);
  // How many real candidate routes were successfully quoted the last time
  // routes were compared, and whether gas-adjusted (USD-normalized) scoring
  // was available for that comparison - both shown in the UI so the route
  // label never overstates what actually happened.
  const [routesComparedCount, setRoutesComparedCount] = useState(0);
  const [routeScoringUsdNormalized, setRouteScoringUsdNormalized] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  // Live "you'll pay roughly this much gas" figure, in ETH - refreshed
  // alongside the real on-chain quote (see fetchQuote/fetchGasEstimate).
  const [estimatedGasFee, setEstimatedGasFee] = useState(null);
  // Live price impact estimate, refreshed alongside the quote (same ref-vs-
  // real-amount technique used in openReviewModal) - shown inline under the
  // amount field so a bad-liquidity trade is visible WHILE typing, instead
  // of only surfacing after clicking "Review Swap". Null until a quote with
  // a resolvable reference rate has come back.
  const [livePriceImpactPct, setLivePriceImpactPct] = useState(null);
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
  const { push: pushNotification } = useNotifications();

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
      setLivePriceImpactPct(null); // stale reading from the old pair shouldn't linger
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

  // Detect (and cache) real 2-hop candidate routes for the current pair -
  // same lifecycle as the direct-pool detection above (pair change only,
  // not per keystroke). Each candidate requires BOTH legs to actually exist
  // on-chain via Factory.getPool() and both legs to have non-zero liquidity;
  // anything else is silently dropped rather than offered as a route.
  useEffect(() => {
    let cancelled = false;

    async function detectHopCandidates() {
      setHopCandidates([]);
      if (!tokenOne.sepoliaAddress || !tokenTwo.sepoliaAddress) return;

      const midTokens = SEPOLIA_TOKENS.filter(
        (t) => t.ticker !== tokenOne.ticker && t.ticker !== tokenTwo.ticker
      );
      if (midTokens.length === 0) return;

      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);
        const liquidityAbi = ["function liquidity() external view returns (uint128)"];

        const results = await Promise.all(
          midTokens.map(async (mid) => {
            const [leg1, leg2] = await Promise.all([
              findPoolFee(provider, tokenOne.sepoliaAddress, mid.sepoliaAddress),
              findPoolFee(provider, mid.sepoliaAddress, tokenTwo.sepoliaAddress),
            ]);
            if (!leg1 || !leg2) return null; // one of the legs doesn't exist - never invent a pool

            const pool1 = new ethers.Contract(leg1.poolAddress, liquidityAbi, provider);
            const pool2 = new ethers.Contract(leg2.poolAddress, liquidityAbi, provider);
            const [liq1, liq2] = await Promise.all([pool1.liquidity(), pool2.liquidity()]);
            if (liq1.eq(0) || liq2.eq(0)) return null; // real but empty pool - not a usable route

            return { midToken: mid, leg1, leg2 };
          })
        );

        if (cancelled) return;
        setHopCandidates(results.filter(Boolean));
      } catch (err) {
        console.error("Hop-candidate detection failed:", err);
      }
    }

    detectHopCandidates();
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

  // Get a REAL quote for every candidate route (the cached direct pool, plus
  // any cached 2-hop candidates) for the given input amount. Never invents a
  // route or a value - each candidate is either a real, successfully-quoted
  // route, or is silently excluded (requirement: a failed alternative route
  // must never block the swap).
  async function quoteAllRoutes(provider, value) {
    const amountIn = ethers.utils.parseUnits(value, tokenOne.decimals);
    const refAmountIn = ethers.utils.parseUnits("0.0001", tokenOne.decimals);
    const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
    const routes = [];

    function impactFromRef(amountOut, refOut) {
      if (!refOut || refOut.isZero()) return null;
      const idealOut = refOut.mul(amountIn).div(refAmountIn);
      if (idealOut.isZero()) return null;
      return idealOut.sub(amountOut).mul(1000000).div(idealOut).toNumber() / 10000;
    }

    if (poolInfo) {
      try {
        const [q, ref] = await Promise.all([
          quoter.callStatic.quoteExactInputSingle({
            tokenIn: tokenOne.sepoliaAddress, tokenOut: tokenTwo.sepoliaAddress,
            amountIn, fee: poolInfo.fee, sqrtPriceLimitX96: 0,
          }),
          quoter.callStatic.quoteExactInputSingle({
            tokenIn: tokenOne.sepoliaAddress, tokenOut: tokenTwo.sepoliaAddress,
            amountIn: refAmountIn, fee: poolInfo.fee, sqrtPriceLimitX96: 0,
          }).catch(() => null),
        ]);
        const amountOut = q.amountOut ?? q[0];
        routes.push({
          type: "direct",
          hopsLabel: `${tokenOne.ticker} → ${tokenTwo.ticker}`,
          fee: poolInfo.fee,
          amountOut,
          gasEstimate: q.gasEstimate ?? q[3],
          priceImpactPct: ref ? impactFromRef(amountOut, ref.amountOut ?? ref[0]) : null,
        });
      } catch (err) {
        console.error("Direct route quote failed:", err.reason || err.message);
      }
    }

    // All 2-hop candidates are independent of each other - quoted
    // concurrently instead of one-after-another. Same per-candidate
    // try/catch semantics as before (a failed candidate is excluded, never
    // blocks the others or the swap), just run in parallel.
    const hopResults = await Promise.all(hopCandidates.map(async (cand) => {
      try {
        const path = encodePath(
          [tokenOne.sepoliaAddress, cand.midToken.sepoliaAddress, tokenTwo.sepoliaAddress],
          [cand.leg1.fee, cand.leg2.fee]
        );
        const [q, ref] = await Promise.all([
          quoter.callStatic.quoteExactInput(path, amountIn),
          quoter.callStatic.quoteExactInput(path, refAmountIn).catch(() => null),
        ]);
        const amountOut = q.amountOut ?? q[0];
        return {
          type: "2hop",
          hopsLabel: `${tokenOne.ticker} → ${cand.midToken.ticker} → ${tokenTwo.ticker}`,
          path,
          legFees: [cand.leg1.fee, cand.leg2.fee],
          amountOut,
          gasEstimate: q.gasEstimate ?? q[3],
          priceImpactPct: ref ? impactFromRef(amountOut, ref.amountOut ?? ref[0]) : null,
        };
      } catch (err) {
        // Requirement: a failed alternative route is excluded, never blocks the swap.
        console.warn(`2-hop route via ${cand.midToken.ticker} could not be quoted - excluded:`, err.reason || err.message);
        return null;
      }
    }));
    routes.push(...hopResults.filter(Boolean));

    return routes;
  }

  // Score every successfully-quoted route on a REAL gas-adjusted basis and
  // pick the best one. Gas is charged in ETH (real gasEstimate x real live
  // gas price) but routes pay out in the output token, so the two need a
  // common unit before they can be netted against each other - this uses a
  // real, live ETH/USDC reference price (same /tokenPrice backend already
  // used elsewhere in this file, queried here for WETH vs USDC, both real
  // listed assets) and the output token's own real reference USD price. If
  // either reference price isn't available, this NEVER guesses a number -
  // it falls back to ranking by raw quoted output only, and says so.
  async function selectBestRoute(routes, provider) {
    if (routes.length === 0) return { best: null, all: [], usdNormalized: false };

    // Gas price and the ETH reference price are independent of each other -
    // fetched concurrently instead of one after the other. allSettled (not
    // Promise.all) so a failure on either side keeps its own existing
    // fallback-to-null behavior without aborting the other.
    const [feeDataResult, ethPriceResult] = await Promise.allSettled([
      provider.getFeeData(),
      (async () => {
        const weth = tokenList.find((t) => t.ticker === "WETH");
        const usdc = tokenList.find((t) => t.ticker === "USDC");
        if (!weth || !usdc) return null;
        const res = await axios.get(`${API_BASE_URL}/tokenPrice`, {
          params: { addressOne: weth.address, addressTwo: usdc.address },
        });
        return res.data?.tokenOne ?? null;
      })(),
    ]);

    let gasPrice = null;
    if (feeDataResult.status === "fulfilled") {
      gasPrice = feeDataResult.value.gasPrice ?? feeDataResult.value.maxFeePerGas;
    } else {
      console.warn("Gas price fetch failed:", feeDataResult.reason?.message);
    }

    let ethUsdPrice = null;
    if (ethPriceResult.status === "fulfilled") {
      ethUsdPrice = ethPriceResult.value;
    } else {
      console.warn("ETH reference price fetch failed - falling back to raw-output ranking:", ethPriceResult.reason?.message);
    }

    const outputUsdPrice = getStaticUsdPrice(tokenTwo.ticker);

    const scored = routes.map((r) => {
      const outputHuman = Number(ethers.utils.formatUnits(r.amountOut, tokenTwo.decimals));
      let netScoreUsd = null;
      if (gasPrice && ethUsdPrice && outputUsdPrice) {
        const gasCostEth = Number(ethers.utils.formatEther(gasPrice.mul(r.gasEstimate)));
        const gasCostUsd = gasCostEth * ethUsdPrice;
        netScoreUsd = outputHuman * outputUsdPrice - gasCostUsd;
      }
      return { ...r, outputHuman, netScoreUsd };
    });

    const usdNormalized = scored.every((r) => r.netScoreUsd !== null);
    scored.sort((a, b) => (usdNormalized ? b.netScoreUsd - a.netScoreUsd : b.outputHuman - a.outputHuman));

    return { best: scored[0], all: scored, usdNormalized };
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
      const provider = new ethers.providers.JsonRpcProvider(process.env.REACT_APP_INFURA_URL);

      // Silent 3s live-price ticker: cheap re-quote of the ALREADY-SELECTED
      // route only (not a full route comparison every 3s - that would be a
      // lot of unnecessary RPC traffic for a number that barely moves).
      if (silent && selectedRoute) {
        try {
          const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
          const amountIn = ethers.utils.parseUnits(value, tokenOne.decimals);
          const refAmountIn = ethers.utils.parseUnits("0.0001", tokenOne.decimals);
          const [q, ref] = selectedRoute.type === "direct"
            ? await Promise.all([
                quoter.callStatic.quoteExactInputSingle({ tokenIn: tokenOne.sepoliaAddress, tokenOut: tokenTwo.sepoliaAddress, amountIn, fee: selectedRoute.fee, sqrtPriceLimitX96: 0 }),
                quoter.callStatic.quoteExactInputSingle({ tokenIn: tokenOne.sepoliaAddress, tokenOut: tokenTwo.sepoliaAddress, amountIn: refAmountIn, fee: selectedRoute.fee, sqrtPriceLimitX96: 0 }).catch(() => null),
              ])
            : await Promise.all([
                quoter.callStatic.quoteExactInput(selectedRoute.path, amountIn),
                quoter.callStatic.quoteExactInput(selectedRoute.path, refAmountIn).catch(() => null),
              ]);
          const amountOut = q.amountOut ?? q[0];
          settokenTwoAmount(ethers.utils.formatUnits(amountOut, tokenTwo.decimals));
          if (ref) {
            const refOut = ref.amountOut ?? ref[0];
            if (!refOut.isZero()) {
              const idealOut = refOut.mul(amountIn).div(refAmountIn);
              if (!idealOut.isZero()) {
                setLivePriceImpactPct(idealOut.sub(amountOut).mul(1000000).div(idealOut).toNumber() / 10000);
              }
            }
          }
        } catch (err) {
          console.error("Silent live-price re-quote failed:", err.reason || err.message);
        }
        return;
      }

      // Real (debounced) quote: compare every real candidate route and pick
      // the best gas-adjusted one. This is what runs after you pause typing,
      // not on every keystroke.
      if (poolInfo || hopCandidates.length > 0) {
        try {
          const [routes] = await Promise.all([
            quoteAllRoutes(provider, value),
            fetchGasEstimate(provider),
          ]);
          const { best, all, usdNormalized } = await selectBestRoute(routes, provider);

          if (best) {
            settokenTwoAmount(ethers.utils.formatUnits(best.amountOut, tokenTwo.decimals));
            setLivePriceImpactPct(best.priceImpactPct);
            setSelectedRoute(best);
            setRoutesComparedCount(all.length);
            setRouteScoringUsdNormalized(usdNormalized);
            return;
          }
        } catch (err) {
          console.error("Route comparison failed, falling back to price ratio:", err);
        }
      }

      // Fallback: CoinGecko USD price ratio (approximate, works for any pair).
      // Kept prefixed with "~" since, unlike the on-chain branch above, this
      // number is never exact - there's no real Sepolia pool for this pair
      // to simulate against, so this estimate IS the final answer.
      setLivePriceImpactPct(null);
      setSelectedRoute(null);
      setRoutesComparedCount(0);
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
      setLivePriceImpactPct(null);
      setSelectedRoute(null);
      setRoutesComparedCount(0);
      return;
    }

    // Instant feedback: show a rough estimate right away from the cached
    // USD price ratio (pure local math, no RPC call) so the output field
    // never just sits frozen while you type. Prefixed with "~" because this
    // number gets replaced a moment later by the exact on-chain quote - the
    // "~" makes that second update read as "refining to the exact price"
    // instead of looking like a random late correction.
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
  setSelectedRoute(null);
  setRoutesComparedCount(0);
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
  setSelectedRoute(null);
  setRoutesComparedCount(0);
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

// One-click "shrink this trade" for the price-impact warning. Not exact -
// Uniswap V3's concentrated liquidity means impact doesn't scale perfectly
// linearly with size, so this is a rough starting guess (scaled down further
// with a 0.7 safety buffer since impact usually grows FASTER than linear as
// size increases, meaning a pure linear scale-down often isn't quite enough
// on its own). The real number always comes from the fresh quote fired right
// after, same as every other amount change - this never fakes a number, it
// just picks a smarter amount to actually quote next.
function applySafeAmount() {
  if (!tokenOneAmount || !livePriceImpactPct || livePriceImpactPct <= 0) return;
  const targetImpact = 2; // aim comfortably under the "high impact" (>5%) line
  const scale = Math.min((targetImpact / livePriceImpactPct) * 0.7, 1);
  const suggested = Number(tokenOneAmount) * scale;
  if (!(suggested > 0)) return;
  const rounded = suggested.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

  settokenOneAmount(rounded);
  if (quoteTimerRef.current) {
    clearTimeout(quoteTimerRef.current);
  }
  fetchQuote(rounded);
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
    message.error("One of these tokens isn't supported on this testnet yet.");
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

    // Fresh, full route comparison right before showing the review - never
    // trusts the debounced typing-time selection as final, same discipline
    // the old code applied to just the direct quote. Falls back to a fresh
    // direct-only lookup if for some reason no candidates were cached yet.
    const amountIn = ethers.utils.parseUnits(tokenOneAmount, tokenOne.decimals);

    // USDC-only: prefetch the real on-chain nonce()/name() needed for the
    // EIP-2612 permit signature NOW, in parallel with route quoting, instead
    // of waiting until after Confirm Swap is clicked. The route is already
    // known to be USDC-sold at this point, so there's nothing to wait for -
    // these two reads don't depend on anything computed later. If this
    // fails or is skipped, attemptPermitSwap() below still falls back to
    // fetching them itself at signing time - never a hard dependency.
    const permitPrefetchPromise = isPermitSupportedToken(tokenOne)
      ? (async () => {
          try {
            const tokenContract = new ethers.Contract(tokenOne.sepoliaAddress, ERC20_ABI, readProvider);
            const [nonce, name] = await Promise.all([
              tokenContract.nonces(address),
              tokenContract.name(),
            ]);
            return { nonce, name };
          } catch (err) {
            console.warn("Permit prefetch failed - will fetch fresh at signing time:", err.message);
            return null;
          }
        })()
      : Promise.resolve(null);

    const [routesFromQuote, permitPrefetch] = await Promise.all([
      quoteAllRoutes(readProvider, tokenOneAmount),
      permitPrefetchPromise,
    ]);
    let routes = routesFromQuote;
    if (routes.length === 0) {
      const poolResult = await findPoolFee(readProvider, tokenOne.sepoliaAddress, tokenTwo.sepoliaAddress);
      if (poolResult === null) {
        message.error("No liquidity pool found for this pair on Sepolia testnet.");
        return;
      }
      const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, readProvider);
      const q = await quoter.callStatic.quoteExactInputSingle({
        tokenIn: tokenOne.sepoliaAddress, tokenOut: tokenTwo.sepoliaAddress,
        amountIn, fee: poolResult.fee, sqrtPriceLimitX96: 0,
      });
      routes = [{
        type: "direct",
        hopsLabel: `${tokenOne.ticker} → ${tokenTwo.ticker}`,
        fee: poolResult.fee,
        amountOut: q.amountOut ?? q[0],
        gasEstimate: q.gasEstimate ?? q[3],
        priceImpactPct: null,
      }];
    }

    const { best, all, usdNormalized } = await selectBestRoute(routes, readProvider);
    if (!best) {
      message.error("Could not fetch a fresh quote right now. Please try again.");
      return;
    }
    setSelectedRoute(best);
    setRoutesComparedCount(all.length);
    setRouteScoringUsdNormalized(usdNormalized);

    const freshAmountOut = best.amountOut;
    const priceImpactPct = best.priceImpactPct;

    const slippageBps = Math.round(DEFAULT_SLIPPAGE_PCT * 100); // e.g. 2.5% -> 250 bps
    const amountOutMinimum = freshAmountOut.mul(10000 - slippageBps).div(10000);

    // Belt-and-suspenders on top of the fixed MIN_SWAP_AMOUNT floor above:
    // that check uses a rough per-token guess, but this checks the REAL
    // on-chain quote. If the guaranteed minimum you'd receive has already
    // rounded down to zero, the Uniswap router would reject this on-chain
    // no matter what ("Too little received") - so stop it here instead of
    // making you pay gas to find that out.
    if (amountOutMinimum.isZero()) {
      message.error("This amount is too small - it would round down to zero output, so the swap would revert. Enter a larger amount.");
      return;
    }

    setReviewData({
      routeType: best.type,
      fee: best.fee,
      legFees: best.legFees,
      path: best.path,
      hopsLabel: best.hopsLabel,
      amountIn,
      freshAmountOut,
      amountOutMinimum,
      priceImpactPct,
      recipient: recipientAddress,
      estimatedGasFee,
      routesComparedCount: all.length,
      gasEstimate: best.gasEstimate, // real, route-specific gasEstimate from the quote itself
      permitPrefetch,
    });
    setIsReviewOpen(true);
  } catch (err) {
    console.error("Could not prepare swap review:", err);
    message.error("Could not fetch a fresh quote right now. Please try again.");
  } finally {
    setIsPreparingReview(false);
  }
}

// USDC-only fast path: request a free, off-chain EIP-712 permit SIGNATURE
// (never an on-chain transaction, no gas) authorizing the router for
// exactly `amountIn`, then bundle that permit with the swap itself into one
// router.multicall() - the ONLY on-chain transaction for this path. Returns
// the submitted tx on success, or null on ANY failure (signature rejected,
// nonce/name read failed, multicall send failed) so confirmSwap can safely
// fall back to the standard approve + swap flow. Never throws.
async function attemptPermitSwap({ signer, router, routeType, fee, path, amountIn, amountOutMinimum, recipient, permitPrefetch, gasEstimate }) {
  setIsRequestingSignature(true);
  try {
    // Real on-chain reads - the nonce MUST be the account's current real
    // nonce (a stale/guessed nonce would make the signature invalid) and the
    // name must exactly match the token's real on-chain name, since it's
    // part of the EIP-712 domain hash. Reuses the values openReviewModal
    // already prefetched (in parallel with route quoting) when available -
    // only falls back to fetching them here if that prefetch is missing for
    // some reason, so this never depends on the prefetch having succeeded.
    let nonce, name;
    if (permitPrefetch) {
      ({ nonce, name } = permitPrefetch);
    } else {
      const tokenContract = new ethers.Contract(tokenOne.sepoliaAddress, ERC20_ABI, signer);
      [nonce, name] = await Promise.all([
        tokenContract.nonces(address),
        tokenContract.name(),
      ]);
    }

    const domain = {
      name,
      version: USDC_PERMIT_DOMAIN_VERSION, // verified against the real on-chain DOMAIN_SEPARATOR() before this was ever wired in
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract: tokenOne.sepoliaAddress,
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const deadline = Math.floor(Date.now() / 1000) + 20 * 60; // real 20-minute window, same convention used elsewhere in this project
    const value = {
      owner: address,
      spender: ROUTER_ADDRESS,
      value: amountIn, // exactly the amount this swap needs - never unlimited
      nonce,
      deadline,
    };

    message.info("Requesting a free signature in MetaMask (not a transaction, no gas)...");
    // Off-chain only - this is a message signature (eth_signTypedData_v4
    // under the hood), never broadcast as its own transaction.
    const signature = await signer._signTypedData(domain, types, value);
    const { v, r, s } = ethers.utils.splitSignature(signature);

    const selfPermitData = router.interface.encodeFunctionData("selfPermit", [
      tokenOne.sepoliaAddress, amountIn, deadline, v, r, s,
    ]);
    const swapData = routeType === "2hop"
      ? router.interface.encodeFunctionData("exactInput", [{ path, recipient, amountIn, amountOutMinimum }])
      : router.interface.encodeFunctionData("exactInputSingle", [{
          tokenIn: tokenOne.sepoliaAddress,
          tokenOut: tokenTwo.sepoliaAddress,
          fee,
          recipient,
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0,
        }]);

    message.info("Confirm the swap transaction in MetaMask...");
    // The ONE on-chain transaction for this path: the permit authorization
    // and the swap execute atomically in the same call.
    //
    // Explicit gasLimit: without one, ethers automatically calls
    // eth_estimateGas via the SIGNER's own provider (MetaMask's configured
    // RPC, not our fast readProvider) before sending - an extra, invisible
    // round-trip on a connection we don't control the speed of. Supplying a
    // gasLimit here skips that call. It can't be a live simulation of this
    // exact multicall (eth_estimateGas would need to actually execute
    // selfPermit's signature check, which requires a REAL valid signature to
    // avoid reverting during simulation - and we don't have one until the
    // line above just ran) - so this is a conservative, real-data-based
    // upper bound instead: the swap portion's own real gasEstimate (already
    // returned by the exact QuoterV2 quote this route was selected from),
    // plus a fixed margin for the selfPermit call (a standard ERC20Permit
    // permit() - one nonce SSTORE, one ecrecover, one allowance SSTORE - a
    // well-characterized, bounded operation, comfortably under 60,000 gas
    // even on a cold storage slot), then a further 20% safety buffer on top
    // of that sum. Generous on purpose: an under-estimate here would risk a
    // real, mined "out of gas" failure, which is worse than the RPC call
    // this is trying to avoid.
    const SELF_PERMIT_GAS_MARGIN = ethers.BigNumber.from(60000);
    const swapGasEstimate = gasEstimate || SWAP_GAS_LIMIT_ESTIMATE;
    const multicallGasLimit = swapGasEstimate.add(SELF_PERMIT_GAS_MARGIN).mul(120).div(100);

    return await router.multicall([selfPermitData, swapData], { gasLimit: multicallGasLimit });
  } catch (err) {
    console.warn("Permit-based swap path failed or was declined - falling back to standard approve + swap:", err.reason || err.message);
    return null;
  } finally {
    setIsRequestingSignature(false);
  }
}

// Step 2: this is what "Confirm Swap" inside the review modal actually
// runs. For USDC (verified ERC-2612 support), tries the signature-based
// permit + multicall path first; for every other token, and as the safety
// net if that path fails, falls back to the original real approve (if
// needed) + exactInputSingle/exactInput flow, completely unchanged.
async function confirmSwap() {
  if (isSwapping || !reviewData) {
    return;
  }
  const { routeType, fee, path, amountIn, amountOutMinimum, recipient, permitPrefetch, gasEstimate } = reviewData;

  setIsSwapping(true);
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    let swapTx = null;

    if (isPermitSupportedToken(tokenOne)) {
      swapTx = await attemptPermitSwap({ signer, router, routeType, fee, path, amountIn, amountOutMinimum, recipient, permitPrefetch, gasEstimate });
      if (!swapTx) {
        message.info("Falling back to a standard approval...");
      }
    }

    if (!swapTx) {
      // 1. Approve the Router to spend tokenOne (only if needed) - real
      // allowance check, exact-amount approve, entirely unchanged for every
      // non-permit token (NOVA/FSN/VRTX/ORBT/WETH/LINK).
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
      message.info("Confirm the swap transaction in MetaMask...");
      // Direct route -> single-hop exactInputSingle (unchanged, already
      // proven). 2-hop route -> the verified exactInput(path, ...) call using
      // the exact same real path that was quoted for the review.
      swapTx = routeType === "2hop"
        ? await router.exactInput({
            path,
            recipient: recipient,
            amountIn,
            amountOutMinimum,
          })
        : await router.exactInputSingle({
            tokenIn: tokenOne.sepoliaAddress,
            tokenOut: tokenTwo.sepoliaAddress,
            fee: fee,
            recipient: recipient,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: 0,
          });
    }

console.log("Swap tx hash:", swapTx.hash);
message.info("Transaction submitted, waiting for confirmation...");

const receipt = await swapTx.wait();

console.log("Receipt:", receipt);
console.log("Logs:", receipt.logs);

message.success("Swap successful! 🎉");
setShowSwapSuccess(true);
setTimeout(() => setShowSwapSuccess(false), 2200);
pushNotification({
  kind: "swap",
  message: `Swapped ${tokenOneAmount} ${tokenOne.ticker} → ${tokenTwo.ticker}`,
  txHash: swapTx.hash,
});

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
      // The Uniswap contract itself refused to complete the swap because
      // the price moved against you between quoting and execution, beyond
      // the built-in safety margin - on purpose. Nothing was swapped at a
      // bad rate; you only paid gas.
      message.error({
        content:
          "Transaction reverted: the price moved before your transaction confirmed, so the swap was NOT " +
          "completed. Your tokens are safe - only the gas fee was spent. Try again.",
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
            <span>Route</span>
            <span>{reviewData.hopsLabel} · {reviewData.routeType === "2hop" ? "2 Hops" : "1 Hop"}</span>
          </div>
          <div className="reviewRow">
            <span>Fee tier</span>
            <span>
              {reviewData.routeType === "2hop"
                ? reviewData.legFees.map((f) => (f / 10000).toFixed(2) + "%").join(" + ")
                : (reviewData.fee / 10000).toFixed(2) + "%"}
            </span>
          </div>
          <div className="reviewRow">
            <span>Routes compared</span>
            <span>{reviewData.routesComparedCount}</span>
          </div>
          {isPermitSupportedToken(tokenOne) && (
            <div className="reviewRow">
              <span>Authorization</span>
              <span>Free signature (USDC) - no separate approval transaction</span>
            </div>
          )}
          {reviewData.estimatedGasFee && (
            <div className="reviewRow">
              <span>Estimated gas fee</span>
              <span>~{Number(reviewData.estimatedGasFee).toFixed(6)} ETH</span>
            </div>
          )}
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
            {isRequestingSignature ? "Waiting for signature..." : isSwapping ? "Swapping..." : "Confirm Swap"}
          </button>
        </div>
      )}
    </Modal>
    <div className="nx-swap-shell">
    <ThreeDBackground
      intensity={4}
      layout="pedestalFlow"
      showGlass={false}
      coins={RING_COINS.length ? RING_COINS : [
        { ticker: tokenOne.ticker, img: tokenOne.img },
        { ticker: tokenTwo.ticker, img: tokenTwo.img },
      ]}
    />
    <div className="nx-swap-centered">
      <div className="nx-swap-centered-header">
        <div className="nx-eyebrow">
          <span className="nx-eyebrow-dot" />
          Multi Chain Aggregator · Sepolia
        </div>
        <h1 className="nx-swap-hero-title">Find the best route</h1>
        <p className="nx-swap-hero-sub">
          4x audited multi chain liquidity aggregator
        </p>
      </div>

    <div className="swapPageColumn">
    <GlassCard as="div" className="nx-trade-card" pad="lg">
    <div
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

    <div className="nx-trade-head">
      <h4>Swap</h4>
      <p>Best price routed automatically across live Sepolia liquidity.</p>
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

    <div className="nx-trade-row">
      <div className="nx-trade-row-top">
        <span className="nx-trade-row-label">You sell</span>
        {balance && (
          <span className="nx-trade-row-balance">
            Available: {Number(balance).toFixed(6)} {tokenOne.ticker}
          </span>
        )}
      </div>
      <div className="nx-trade-row-main">
        <Input
          className="nx-trade-amount-input"
          placeholder="0"
          value={tokenOneAmount}
          onChange={changeAmount}
          bordered={false}
        />
        <div className="nx-trade-token-pill" onClick={() => openModal(1)}>
          <TokenIcon symbol={tokenOne.ticker} src={tokenOne.img} size={26} />
          <span>{tokenOne.ticker}</span>
          <span className="nx-trade-chain-badge">Sepolia</span>
          <DownOutlined />
        </div>
      </div>
      {isQuoting && (
        <div className="quotingRow">
          Getting best price <span className="quotingShimmer"></span>
        </div>
      )}
    </div>

    <div
      className="nx-trade-switch"
      onClick={() => {
        switchTokens();
        setSwitchSpinCount((c) => c + 1);
      }}
    >
      <ArrowDownOutlined key={switchSpinCount} className="switchArrow" />
    </div>

    <div className="nx-trade-row">
      <div className="nx-trade-row-top">
        <span className="nx-trade-row-label">You receive</span>
      </div>
      <div className="nx-trade-row-main">
        <Input
          className="nx-trade-amount-input"
          placeholder="0"
          value={tokenTwoAmount}
          disabled={true}
          bordered={false}
        />
        <div className="nx-trade-token-pill" onClick={() => openModal(2)}>
          <TokenIcon symbol={tokenTwo.ticker} src={tokenTwo.img} size={26} />
          <span>{tokenTwo.ticker}</span>
          <span className="nx-trade-chain-badge">Sepolia</span>
          <DownOutlined />
        </div>
      </div>
    </div>

    {(!isQuoting && liveRate !== null) || (!isQuoting && estimatedGasFee !== null) ? (
      <div className="nx-trade-info-row">
        {!isQuoting && liveRate !== null && (
          <div className="nx-trade-info-line">
            <span className="liveDot"></span>
            1 {tokenOne.ticker} = {liveRate.toFixed(6)} {tokenTwo.ticker}
            {poolInfo && (
              <Link
                className="nx-swap-view-pool"
                to={`/pools?pair=${encodeURIComponent(`${tokenOne.ticker}/${tokenTwo.ticker}`)}`}
              >
                View Pool →
              </Link>
            )}
          </div>
        )}
        {selectedRoute && (
          <div className="nx-trade-info-line">
            <span>Route</span>
            <span>
              {selectedRoute.hopsLabel} · {selectedRoute.type === "2hop" ? "2 Hops" : "1 Hop"}
              {selectedRoute.type === "2hop"
                ? ` (Fee ${selectedRoute.legFees.map((f) => (f / 10000).toFixed(2) + "%").join(" + ")})`
                : ` (Fee ${(selectedRoute.fee / 10000).toFixed(2)}%)`}
            </span>
          </div>
        )}
        {selectedRoute && routesComparedCount > 1 && (
          <div className="nx-trade-info-line">
            <span>Compared {routesComparedCount} routes</span>
            <span>
              {routeScoringUsdNormalized
                ? "Selected based on best gas-adjusted output"
                : "Selected based on best available output"}
            </span>
          </div>
        )}
        {!isQuoting && liveRate !== null && livePriceImpactPct !== null && (
          <div className="nx-trade-info-line">
            <span>Price impact</span>
            <span>{livePriceImpactPct >= 0 ? "-" : "+"}{Math.abs(livePriceImpactPct).toFixed(2)}%</span>
          </div>
        )}
        {!isQuoting && estimatedGasFee !== null && (
          <div className="nx-trade-info-line">
            <ThunderboltOutlined /> Estimated gas: ~{Number(estimatedGasFee).toFixed(6)} ETH
          </div>
        )}
      </div>
    ) : null}

    {!isQuoting && livePriceImpactPct !== null && livePriceImpactPct > 1 && (
      <div className={livePriceImpactPct > 5 ? "priceImpactWarnRow priceImpactWarnHigh" : "priceImpactWarnRow"}>
        Price impact: -{livePriceImpactPct.toFixed(2)}%
        {livePriceImpactPct > 5
          ? " — this testnet pool is thin at this size."
          : " — noticeable for this size on testnet liquidity."}
        {" "}
        <span className="priceImpactShrinkLink" onClick={applySafeAmount}>
          Try a smaller amount
        </span>
      </div>
    )}

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
    <PrimaryButton
      full
      className="nx-trade-cta"
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
    </PrimaryButton>
    </div>
    </GlassCard>

    {lastReceipt && <Receipt data={lastReceipt} />}
    </div>
    </div>
    </div>
    </>
  );
}

export default Swap