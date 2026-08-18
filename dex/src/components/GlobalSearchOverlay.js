import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TokenIcon from "./ui/TokenIcon";
import tokenList from "../tokenList.json";
import analyticsConfig from "../analyticsConfig.json";
import "./GlobalSearchOverlay.css";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_RE = /^0x[a-fA-F0-9]{64}$/;

// Client-side search over data that already ships with the app
// (tokenList.json, analyticsConfig.json's pools) - no new backend, no
// invented results. A pasted address/tx hash is recognized and deep-linked
// either to the local Token Explorer (if it's a known Sepolia token) or
// out to Etherscan for anything this app doesn't already track.
function GlobalSearchOverlay({ onClose }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const tokens = useMemo(
    () => tokenList.filter((t) => t.sepoliaAddress),
    []
  );

  const { tokenResults, poolResults, directHit } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { tokenResults: tokens.slice(0, 6), poolResults: analyticsConfig.pools.slice(0, 4), directHit: null };

    if (ADDRESS_RE.test(query.trim())) {
      const match = tokens.find((t) => t.sepoliaAddress.toLowerCase() === q);
      return {
        tokenResults: match ? [match] : [],
        poolResults: [],
        directHit: match
          ? null
          : { type: "address", value: query.trim() },
      };
    }
    if (TXHASH_RE.test(query.trim())) {
      return { tokenResults: [], poolResults: [], directHit: { type: "tx", value: query.trim() } };
    }

    return {
      tokenResults: tokens.filter(
        (t) => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
      ),
      poolResults: analyticsConfig.pools.filter((p) => p.pair.toLowerCase().includes(q)),
      directHit: null,
    };
  }, [query, tokens]);

  function goToken(symbol) {
    navigate(`/explorer/${symbol}`);
    onClose();
  }

  function goPool(pair) {
    navigate(`/pools?pair=${encodeURIComponent(pair)}`);
    onClose();
  }

  return (
    <div className="nx-search-backdrop" onClick={onClose}>
      <div className="nx-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nx-search-input-row">
          <span aria-hidden="true">🔍</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens, pools, or paste an address / tx hash..."
          />
          <span className="nx-search-esc">ESC</span>
        </div>
        <div className="nx-search-results">
          {directHit && directHit.type === "tx" && (
            <a
              className="nx-search-result"
              href={`https://sepolia.etherscan.io/tx/${directHit.value}`}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              <TokenIcon symbol="TX" />
              <div>
                <div className="nx-search-result-title">View transaction on Etherscan</div>
                <div className="nx-search-result-sub">{directHit.value}</div>
              </div>
            </a>
          )}
          {directHit && directHit.type === "address" && (
            <a
              className="nx-search-result"
              href={`https://sepolia.etherscan.io/address/${directHit.value}`}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              <TokenIcon symbol="0x" />
              <div>
                <div className="nx-search-result-title">View address on Etherscan</div>
                <div className="nx-search-result-sub">Not a token tracked by Nexora — opening Etherscan</div>
              </div>
            </a>
          )}

          {tokenResults.length > 0 && (
            <>
              <div className="nx-search-group-label">Tokens</div>
              {tokenResults.map((t) => (
                <div key={t.ticker} className="nx-search-result" onClick={() => goToken(t.ticker)}>
                  <TokenIcon symbol={t.ticker} src={t.img} size={32} />
                  <div>
                    <div className="nx-search-result-title">{t.name}</div>
                    <div className="nx-search-result-sub">{t.ticker}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {poolResults.length > 0 && (
            <>
              <div className="nx-search-group-label">Pools</div>
              {poolResults.map((p) => (
                <div key={p.pair} className="nx-search-result" onClick={() => goPool(p.pair)}>
                  <TokenIcon symbol={p.tokenA} size={32} />
                  <div>
                    <div className="nx-search-result-title">{p.pair}</div>
                    <div className="nx-search-result-sub">Fee tier {p.fee / 10000}%</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {!directHit && tokenResults.length === 0 && poolResults.length === 0 && (
            <div className="nx-search-empty">No matches in tokens or pools.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GlobalSearchOverlay;
