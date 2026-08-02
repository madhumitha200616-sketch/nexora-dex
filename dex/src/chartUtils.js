// Shared helpers for the price chart - originally lived inline in Swap.js,
// pulled out here once the chart moved to its own /chart page so both spots
// (and any future ones) can reuse the exact same smoothing/labeling logic.

// Matches the ?days= values the backend's /priceHistory route accepts.
export const CHART_RANGE_LABELS = { "1": "24 hours", "7": "7 days", "30": "30 days" };
export const CHART_RANGE_SHORT = { "1": "24H", "7": "7D", "30": "30D" };

// The price chart's raw data (the CoinGecko fallback mock included) only has
// a handful of points - straight lines between a few dots don't read as a
// "curve" no matter what interpolation setting recharts uses. This fills in
// smooth in-between points with a Catmull-Rom spline BEFORE it ever reaches
// the chart, so what actually gets drawn is a dense, naturally curved line
// instead of a few sharp connected segments.
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function densifyChartData(points, segmentsPerGap = 10) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    for (let s = 0; s < segmentsPerGap; s++) {
      const t = s / segmentsPerGap;
      const price = catmullRom(p0.price, p1.price, p2.price, p3.price, t);
      // Only the point that lines up with a real original sample keeps its
      // label, so the X axis still shows real dates instead of a smear of
      // interpolated ones.
      out.push({ time: s === 0 ? p1.time : "", price: Number(price.toFixed(4)) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
