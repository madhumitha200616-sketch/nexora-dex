import React, { useState } from "react";
import { message } from "antd";
import NexoraLogo from "./ui/NexoraLogo";

function Receipt({ data }) {
  const [copiedKey, setCopiedKey] = useState(null);

  if (!data) return null;

  const copyToClipboard = (text, key, label) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    message.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formattedDate = data.timestamp instanceof Date
    ? data.timestamp.toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric' });

  const formattedTime = data.timestamp instanceof Date
    ? data.timestamp.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const etherscanUrl = `https://sepolia.etherscan.io/tx/${data.txHash}`;

  const handlePrint = () => {
    const printWin = window.open("", "_blank", "width=800,height=900");
    if (printWin) {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Nexora Transaction Receipt</title>
            <style>
              @page { size: A4 portrait; margin: 15mm; }
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #ffffff; color: #0f172a; padding: 20px; line-height: 1.5; }
              .receipt-box { max-width: 680px; margin: 0 auto; border: 2px solid #6366f1; border-radius: 16px; padding: 32px; background: #ffffff; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15); page-break-inside: avoid; }
              .receipt-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 18px; margin-bottom: 24px; }
              .receipt-title { font-size: 20px; font-weight: 800; color: #4338ca; letter-spacing: -0.02em; }
              .receipt-subtitle { font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
              .status-badge { display: inline-flex; align-items: center; gap: 6px; background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 6px 14px; border-radius: 9999px; font-size: 13.5px; font-weight: 700; }
              .hero-amounts { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
              .amount-block { display: flex; flex-direction: column; gap: 2px; }
              .amount-lbl { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
              .amount-val { font-size: 22px; font-weight: 800; color: #0f172a; }
              .amount-val.accent { color: #0284c7; }
              .amount-arrow { font-size: 24px; color: #6366f1; font-weight: 800; }
              .details-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-bottom: 24px; }
              .detail-item { display: flex; flex-direction: column; gap: 4px; }
              .detail-item.full { grid-column: span 2; }
              .detail-lbl { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
              .detail-val { font-size: 14.5px; font-weight: 600; color: #1e293b; }
              .detail-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: #0f172a; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; word-break: break-all; overflow-wrap: anywhere; }
              .receipt-footer { margin-top: 24px; padding-top: 16px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 12px; color: #64748b; }
              .receipt-footer a { color: #2563eb; text-decoration: underline; word-break: break-all; }
              .watermark { margin-top: 10px; font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; }
            </style>
          </head>
          <body>
            <div class="receipt-box">
              <div class="receipt-header">
                <div>
                  <div class="receipt-title">NEXORA DEFI</div>
                  <div class="receipt-subtitle">NEXORA TRANSACTION RECEIPT</div>
                </div>
                <div class="status-badge">✓ Transaction Successful</div>
              </div>
              <div class="hero-amounts">
                <div class="amount-block">
                  <span class="amount-lbl">You Paid</span>
                  <span class="amount-val">${Number(data.amountIn).toFixed(6)} ${data.tokenInTicker}</span>
                </div>
                <div class="amount-arrow">→</div>
                <div class="amount-block">
                  <span class="amount-lbl">You Received</span>
                  <span class="amount-val accent">${Number(data.amountOut).toFixed(6)} ${data.tokenOutTicker}</span>
                </div>
              </div>
              <div class="details-grid">
                <div class="detail-item">
                  <span class="detail-lbl">Network</span>
                  <span class="detail-val">Sepolia Testnet</span>
                </div>
                <div class="detail-item">
                  <span class="detail-lbl">Timestamp</span>
                  <span class="detail-val">${formattedDate} at ${formattedTime}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-lbl">Pool Fee Tier</span>
                  <span class="detail-val">${data.fee ? (data.fee / 10000).toFixed(2) : "0.30"}%</span>
                </div>
                ${data.gasFee ? `<div class="detail-item"><span class="detail-lbl">Estimated Gas Fee</span><span class="detail-val">~${Number(data.gasFee).toFixed(6)} ETH</span></div>` : ""}
                <div class="detail-item full">
                  <span class="detail-lbl">From Address</span>
                  <div class="detail-mono">${data.sender}</div>
                </div>
                <div class="detail-item full">
                  <span class="detail-lbl">To Address (Recipient)</span>
                  <div class="detail-mono">${data.recipient}</div>
                </div>
                <div class="detail-item full">
                  <span class="detail-lbl">Transaction Hash</span>
                  <div class="detail-mono">${data.txHash}</div>
                </div>
              </div>
              <div class="receipt-footer">
                <div>View on Sepolia Etherscan: <a href="${etherscanUrl}" target="_blank">${etherscanUrl}</a></div>
                <div class="watermark">Nexora Multi-Chain DEX · Verified On-Chain Transaction</div>
              </div>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 250);
              };
            </script>
          </body>
        </html>
      `;
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
    } else {
      window.print();
    }
  };

  const renderReceiptContent = (isPrint = false) => (
    <div className={`nx-receipt-card ${isPrint ? "nx-receipt-card-print" : ""}`}>
      <div className="nx-receipt-header">
        <div className="nx-receipt-brand-group">
          <NexoraLogo size="sm" showWordmark={true} />
          <span className="nx-receipt-badge">Transaction Receipt</span>
        </div>
        <div className="nx-receipt-status-pill">
          <span className="nx-receipt-status-dot" />
          <span>Transaction Successful</span>
        </div>
      </div>

      <div className="nx-receipt-hero-amount">
        <div className="nx-receipt-amount-row">
          <div className="nx-receipt-amount-block">
            <span className="nx-receipt-amount-val">
              {Number(data.amountIn).toFixed(6)} <strong>{data.tokenInTicker}</strong>
            </span>
            <span className="nx-receipt-amount-lbl">You Paid</span>
          </div>
          <div className="nx-receipt-arrow">→</div>
          <div className="nx-receipt-amount-block">
            <span className="nx-receipt-amount-val nx-accent">
              {Number(data.amountOut).toFixed(6)} <strong>{data.tokenOutTicker}</strong>
            </span>
            <span className="nx-receipt-amount-lbl">You Received</span>
          </div>
        </div>
      </div>

      <div className="nx-receipt-grid">
        <div className="nx-receipt-field">
          <span className="nx-receipt-label">Network</span>
          <span className="nx-receipt-value">
            <span className="nx-receipt-net-badge">⚡ Sepolia Testnet</span>
          </span>
        </div>

        <div className="nx-receipt-field">
          <span className="nx-receipt-label">Timestamp</span>
          <span className="nx-receipt-value">
            {formattedDate} at {formattedTime}
          </span>
        </div>

        <div className="nx-receipt-field">
          <span className="nx-receipt-label">Pool Fee Tier</span>
          <span className="nx-receipt-value">
            {data.fee ? (data.fee / 10000).toFixed(2) : "0.30"}%
          </span>
        </div>

        {data.gasFee && (
          <div className="nx-receipt-field">
            <span className="nx-receipt-label">Estimated Gas Fee</span>
            <span className="nx-receipt-value">
              ~{Number(data.gasFee).toFixed(6)} ETH
            </span>
          </div>
        )}

        <div className="nx-receipt-field nx-receipt-full">
          <span className="nx-receipt-label">From Address</span>
          <div className="nx-receipt-hash-box">
            <span className="nx-receipt-mono">{data.sender}</span>
            {!isPrint && (
              <button
                type="button"
                className="nx-receipt-copy-btn"
                onClick={() => copyToClipboard(data.sender, "sender", "From address")}
              >
                {copiedKey === "sender" ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
        </div>

        <div className="nx-receipt-field nx-receipt-full">
          <span className="nx-receipt-label">To Address (Recipient)</span>
          <div className="nx-receipt-hash-box">
            <span className="nx-receipt-mono">{data.recipient}</span>
            {!isPrint && (
              <button
                type="button"
                className="nx-receipt-copy-btn"
                onClick={() => copyToClipboard(data.recipient, "recipient", "To address")}
              >
                {copiedKey === "recipient" ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
        </div>

        <div className="nx-receipt-field nx-receipt-full">
          <span className="nx-receipt-label">Transaction Hash</span>
          <div className="nx-receipt-hash-box">
            <span className="nx-receipt-mono">{data.txHash}</span>
            {!isPrint && (
              <button
                type="button"
                className="nx-receipt-copy-btn"
                onClick={() => copyToClipboard(data.txHash, "txHash", "Transaction Hash")}
              >
                {copiedKey === "txHash" ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="nx-receipt-print-footer">
        <div className="nx-receipt-etherscan-link">
          <span className="nx-receipt-label">View on Sepolia Etherscan</span>
          <a
            className="nx-receipt-link-url"
            href={etherscanUrl}
            target="_blank"
            rel="noreferrer"
          >
            {etherscanUrl}
          </a>
        </div>
      </div>

      {!isPrint && (
        <div className="nx-receipt-actions">
          <a
            className="nx-btn nx-btn-primary nx-receipt-etherscan-btn"
            href={etherscanUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>View on Sepolia Etherscan</span>
            <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            className="nx-btn nx-btn-secondary nx-receipt-print-btn"
            onClick={handlePrint}
          >
            <span>Download / Print Receipt</span>
            <span aria-hidden="true">🖨</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* On-Screen Receipt Card */}
      {renderReceiptContent(false)}

      {/* Hidden Printable Container for window.print() and PDF Export */}
      <div className="receiptPrintOnly">
        {renderReceiptContent(true)}
      </div>
    </>
  );
}

export default Receipt;
