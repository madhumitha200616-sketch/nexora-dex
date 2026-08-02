import React from 'react'

// Printable transaction receipt. There's no PDF library in this project
// (and no way to safely add one from this environment without risking a
// broken build on your machine) - so "download as PDF" is done the
// dependency-free way: this renders as a normal light, print-friendly page
// that's hidden on screen and only shown via the `.receiptPrintOnly` CSS
// rule when window.print() is triggered. Every browser's print dialog
// offers "Save as PDF" as a destination, so the end result is the same PDF
// file, just generated through the browser instead of a JS library.
function Receipt({ data }) {
  if (!data) return null;

  return (
    <div className="receiptPrintOnly">
      <div className="receiptSheet">
        <div className="receiptBrand">Nexora</div>
        <div className="receiptTitle">Swap Receipt</div>

        <div className="receiptRow">
          <span>Date</span>
          <span>{data.timestamp.toLocaleDateString()}</span>
        </div>
        <div className="receiptRow">
          <span>Time</span>
          <span>{data.timestamp.toLocaleTimeString()}</span>
        </div>
        <div className="receiptRow">
          <span>Network</span>
          <span>Sepolia Testnet</span>
        </div>

        <div className="receiptDivider" />

        <div className="receiptRow">
          <span>You paid</span>
          <span>{Number(data.amountIn).toFixed(6)} {data.tokenInTicker}</span>
        </div>
        <div className="receiptRow">
          <span>You received</span>
          <span>{Number(data.amountOut).toFixed(6)} {data.tokenOutTicker}</span>
        </div>
        <div className="receiptRow">
          <span>Fee tier</span>
          <span>{(data.fee / 10000).toFixed(2)}%</span>
        </div>
        <div className="receiptRow">
          <span>Slippage tolerance</span>
          <span>{data.slippage}%</span>
        </div>
        {data.gasFee && (
          <div className="receiptRow">
            <span>Estimated gas fee</span>
            <span>~{Number(data.gasFee).toFixed(6)} ETH</span>
          </div>
        )}

        <div className="receiptDivider" />

        <div className="receiptRow">
          <span>From</span>
          <span className="receiptMono">{data.sender}</span>
        </div>
        <div className="receiptRow">
          <span>To</span>
          <span className="receiptMono">{data.recipient}</span>
        </div>
        <div className="receiptRow">
          <span>Transaction hash</span>
          <span className="receiptMono">{data.txHash}</span>
        </div>

        <div className="receiptFooter">
          View on Sepolia Etherscan: https://sepolia.etherscan.io/tx/{data.txHash}
        </div>
      </div>
    </div>
  );
}

export default Receipt
