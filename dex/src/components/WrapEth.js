import React, { useState, useEffect } from 'react'
import { Input, message } from "antd";
import { ethers } from "ethers";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";

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
      } else {
        message.info("Confirm in MetaMask to unwrap WETH back into ETH...");
        const tx = await weth.withdraw(value);
        await tx.wait();
        message.success("Unwrapped! ETH is back in your wallet.");
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

  return (
    <div className="wrapBox" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
      <div className="wrapHeader">
        <h4>Wrap ETH</h4>
        <div className="wrapTabs">
          <span
            className={mode === 'wrap' ? "wrapTab wrapTabActive" : "wrapTab"}
            onClick={() => { setMode('wrap'); setAmount(''); }}
          >
            ETH → WETH
          </span>
          <span
            className={mode === 'unwrap' ? "wrapTab wrapTabActive" : "wrapTab"}
            onClick={() => { setMode('unwrap'); setAmount(''); }}
          >
            WETH → ETH
          </span>
        </div>
      </div>

      <div className="balanceRow">
        Available: {availableLabel}
        <span className="maxBtn" onClick={setMaxAmount}>MAX</span>
      </div>

      <Input
        placeholder="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <button className="wrapButton" disabled={isBusy || !amount} onClick={handleAction}>
        {isBusy ? "Processing..." : (mode === 'wrap' ? "Wrap ETH" : "Unwrap WETH")}
      </button>

      <div className="wrapNote">
        1 ETH = 1 WETH, always - no price impact, no slippage, no pool involved.
        This just converts native ETH into an ERC-20 token so it can be swapped.
        Wrap ETH here first, then use Swap above to trade WETH → USDC.
      </div>
    </div>
  );
}

export default WrapEth
