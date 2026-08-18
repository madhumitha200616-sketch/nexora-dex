import React, { useState, useEffect } from 'react'
import { Input, message } from "antd";
import { ethers } from "ethers";
import PageShell from "./ui/PageShell";
import GlassCard from "./ui/GlassCard";
import PrimaryButton from "./ui/PrimaryButton";
import SecondaryButton from "./ui/SecondaryButton";
import TokenIcon from "./ui/TokenIcon";
import ThreeDBackground from "./ui/ThreeDBackground";
import tokenList from "../tokenList.json";
import { useNotifications } from "../context/NotificationsContext";
import "./AddLiquidity.css";

// Canonical Sepolia WETH9 - same contract already used as WETH's
// sepoliaAddress in tokenList.json. WETH is just ETH wrapped into an ERC-20
// so it can be approved/transferred/swapped like any other token - deposit()
// locks your ETH 1:1 and mints you WETH, withdraw() does the reverse.
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const WETH_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 wad) external",
  "function balanceOf(address owner) external view returns (uint256)"
];

// Left unwrapped as gas buffer when someone hits MAX while wrapping, so the
// wrap transaction itself always has ETH left over to pay for its own gas.
const GAS_BUFFER_ETH = 0.001;

function WrapEth({ isConnected, address }) {
  const [mode, setMode] = useState('wrap'); // 'wrap' (ETH->WETH) or 'unwrap' (WETH->ETH)
  const [amount, setAmount] = useState('');
  const [ethBalance, setEthBalance] = useState(null);
  const [wethBalance, setWethBalance] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const { push: pushNotification } = useNotifications();

  useEffect(() => {
    if (!isConnected || !address) {
      setEthBalance(null);
      setWethBalance(null);
      return;
    }
    fetchBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  async function fetchBalances() {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, provider);
      const [rawEth, rawWeth] = await Promise.all([
        provider.getBalance(address),
        weth.balanceOf(address),
      ]);
      setEthBalance(ethers.utils.formatEther(rawEth));
      setWethBalance(ethers.utils.formatEther(rawWeth));
    } catch (err) {
      console.error("Failed to fetch ETH/WETH balances:", err);
    }
  }

  function setMaxAmount() {
    if (mode === 'wrap' && ethBalance) {
      const max = Math.max(0, Number(ethBalance) - GAS_BUFFER_ETH);
      setAmount(max.toFixed(6));
    } else if (mode === 'unwrap' && wethBalance) {
      setAmount(Number(wethBalance).toFixed(6));
    }
  }

  async function handleAction() {
    if (!isConnected) {
      message.error("Please connect your wallet first");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      message.error("Enter an amount");
      return;
    }

    setIsBusy(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
      const value = ethers.utils.parseEther(amount);

      if (mode === 'wrap') {
        message.info("Confirm in MetaMask to wrap ETH into WETH...");
        const tx = await weth.deposit({ value });
        await tx.wait();
        message.success("Wrapped! WETH is in your wallet - use Swap above to trade it for USDC.");
        pushNotification({ kind: "swap", message: `Wrapped ${amount} ETH → WETH`, txHash: tx.hash });
      } else {
        message.info("Confirm in MetaMask to unwrap WETH back into ETH...");
        const tx = await weth.withdraw(value);
        await tx.wait();
        message.success("Unwrapped! ETH is back in your wallet.");
        pushNotification({ kind: "swap", message: `Unwrapped ${amount} WETH → ETH`, txHash: tx.hash });
      }
      setAmount('');
      fetchBalances();
    } catch (err) {
      console.error("Wrap/unwrap failed:", err);
      const reason = err.reason || err.error?.message || err.message || "";
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        message.error("Cancelled");
      } else if (reason.includes("insufficient funds")) {
        message.error("Not enough ETH for this amount plus gas.");
      } else {
        message.error(`${mode === 'wrap' ? 'Wrap' : 'Unwrap'} failed: ${reason}`);
      }
    } finally {
      setIsBusy(false);
    }
  }

  if (!isConnected) return null;

  const availableLabel = mode === 'wrap'
    ? (ethBalance !== null ? `${Number(ethBalance).toFixed(6)} ETH` : '...')
    : (wethBalance !== null ? `${Number(wethBalance).toFixed(6)} WETH` : '...');

  const fromTicker = mode === 'wrap' ? 'ETH' : 'WETH';
  const toTicker = mode === 'wrap' ? 'WETH' : 'ETH';
  const toMeta = tokenList.find((t) => t.ticker === toTicker);
  const receiveAmount = amount && Number(amount) > 0 ? Number(amount).toFixed(6) : '0.0';

  return (
    <PageShell
      eyebrow="Fast Action"
      title="Wrap ETH"
      subtitle="Convert native Sepolia ETH into WETH 1:1 - no price impact, no slippage, no pool involved - so it can be swapped like any other token."
      background={<ThreeDBackground intensity={3} />}
    >
      <GlassCard glow pad="lg" className="nx-al-card" tilt>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {mode === 'wrap' ? (
            <PrimaryButton style={{ flex: 1 }} onClick={() => { setMode('wrap'); setAmount(''); }}>Wrap</PrimaryButton>
          ) : (
            <SecondaryButton style={{ flex: 1 }} onClick={() => { setMode('wrap'); setAmount(''); }}>Wrap</SecondaryButton>
          )}
          {mode === 'unwrap' ? (
            <PrimaryButton style={{ flex: 1 }} onClick={() => { setMode('unwrap'); setAmount(''); }}>Unwrap</PrimaryButton>
          ) : (
            <SecondaryButton style={{ flex: 1 }} onClick={() => { setMode('unwrap'); setAmount(''); }}>Unwrap</SecondaryButton>
          )}
        </div>

        <div className="nx-al-summary-row">
          <span>Available: {availableLabel}</span>
          <SecondaryButton size="sm" style={{ padding: '3px 12px', fontSize: 11 }} onClick={setMaxAmount}>MAX</SecondaryButton>
        </div>

        <div className="nx-al-token-row">
          <TokenIcon symbol={fromTicker} src={tokenList.find((t) => t.ticker === fromTicker)?.img} size={32} />
          <span className="nx-al-token-select" style={{ cursor: 'default' }}>{fromTicker}</span>
          <Input
            className="nx-al-amount-input"
            bordered={false}
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="nx-al-summary-row">
          <span>You will receive</span>
          <strong>{receiveAmount} {toTicker}</strong>
        </div>
        <div className="nx-al-summary-row">
          <span>Rate</span>
          <strong>1 {fromTicker} = 1 {toTicker}</strong>
        </div>

        <PrimaryButton
          full
          disabled={isBusy || !amount}
          onClick={handleAction}
          style={{ marginTop: 14 }}
        >
          {isBusy ? "Processing..." : (mode === 'wrap' ? "Wrap ETH" : "Unwrap WETH")}
        </PrimaryButton>

        <div className="nx-al-banner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TokenIcon symbol={toTicker} src={toMeta?.img} size={20} />
          1 ETH = 1 WETH, always. This just converts native ETH into an ERC-20 token so it can be
          approved and swapped. Wrap ETH here first, then use Swap to trade WETH → USDC.
        </div>
      </GlassCard>
    </PageShell>
  );
}

export default WrapEth
