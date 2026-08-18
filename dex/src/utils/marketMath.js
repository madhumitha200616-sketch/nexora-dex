// All windows are anchored to real wall-clock time (not "time since the
// last trade") so 24H/7D/1M mean what they say - a token with no trades in
// the actual last 24 hours honestly shows no data for that window instead
// of silently using an older trade as if it were current.

export function filterByWindow(trades, windowSeconds) {
  if (!trades.length) return [];
  const nowTs = Math.floor(Date.now() / 1000);
  const cutoff = nowTs - windowSeconds;
  return trades.filter((t) => t.timestamp >= cutoff);
}

// % change from the closest real trade at/before the window start to the
// latest known trade. Returns null (not a guess) when there's no trade old
// enough to anchor the window - that's "not enough history yet", not 0%.
export function priceChangePct(trades, windowSeconds) {
  if (!trades.length) return null;
  const nowTs = Math.floor(Date.now() / 1000);
  const cutoff = nowTs - windowSeconds;

  let baseline = null;
  for (const t of trades) {
    if (t.timestamp <= cutoff) baseline = t;
    else break;
  }
  if (!baseline) return null;

  const current = trades[trades.length - 1].price;
  if (baseline.price === 0) return null;
  return ((current - baseline.price) / baseline.price) * 100;
}

export function bucketSecondsFor(timeframeKey) {
  if (timeframeKey === "24H") return 3600; // hourly rows
  if (timeframeKey === "7D") return 6 * 3600; // 6h rows
  return 24 * 3600; // daily rows for 1M
}

// OHLC rows built only from buckets that contain at least one real trade -
// never fabricates a row for a period with no on-chain activity.
export function buildOhlcRows(trades, bucketSeconds) {
  if (!trades.length) return [];

  const buckets = new Map();
  for (const t of trades) {
    const key = Math.floor(t.timestamp / bucketSeconds) * bucketSeconds;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }

  const rows = [...buckets.entries()]
    .sort((a, b) => b[0] - a[0]) // newest first
    .map(([key, bucketTrades]) => {
      const sorted = [...bucketTrades].sort((a, b) => a.timestamp - b.timestamp);
      const prices = sorted.map((t) => t.price);
      return {
        timestamp: key,
        open: prices[0],
        close: prices[prices.length - 1],
        high: Math.max(...prices),
        low: Math.min(...prices),
        volume: sorted.reduce((sum, t) => sum + t.volumeQuote, 0),
        tradeCount: sorted.length,
      };
    });

  return rows.map((row, i) => {
    const prevRow = rows[i + 1]; // older bucket, since rows are newest-first
    const change = prevRow ? row.close - prevRow.close : null;
    const changePct = prevRow && prevRow.close !== 0 ? (change / prevRow.close) * 100 : null;
    return { ...row, change, changePct };
  });
}
