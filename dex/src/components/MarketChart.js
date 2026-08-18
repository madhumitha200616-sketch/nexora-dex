import React, { useMemo, useRef, useState } from "react";
import "./MarketChart.css";

const WIDTH = 900;
const HEIGHT = 340;
const PAD_LEFT = 70;
const PAD_RIGHT = 16;
const PAD_TOP = 20;
const PAD_BOTTOM = 34;

function formatDateTime(ts, timeframeKey) {
  const d = new Date(ts * 1000);
  if (timeframeKey === "1M") {
    return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function MarketChart({ points, timeframeKey, isUp }) {
  const svgRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const { pathD, areaD, coords, minPrice, maxPrice } = useMemo(() => {
    if (points.length < 2) {
      return { pathD: "", areaD: "", coords: [], minPrice: null, maxPrice: null };
    }
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || max * 0.001 || 1;
    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

    const coords = points.map((p, i) => ({
      x: PAD_LEFT + (i / (points.length - 1)) * innerW,
      y: PAD_TOP + innerH - ((p.price - min) / span) * innerH,
      timestamp: p.timestamp,
      price: p.price,
    }));

    const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
    const bottom = PAD_TOP + innerH;
    const area = `${d} L${coords[coords.length - 1].x.toFixed(2)},${bottom} L${PAD_LEFT},${bottom} Z`;

    return { pathD: d, areaD: area, coords, minPrice: min, maxPrice: max };
  }, [points]);

  function handleMove(e) {
    if (!coords.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - mouseX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  if (points.length < 2) {
    return (
      <div className="mc-empty">
        No on-chain trade history for this window yet - the chart will populate as real swaps occur.
      </div>
    );
  }

  const hover = hoverIndex !== null ? coords[hoverIndex] : null;
  const color = isUp ? "#34d399" : "#f87171";
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  return (
    <div className="mc-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mc-svg"
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="mcGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={PAD_TOP + f * innerH}
            y2={PAD_TOP + f * innerH}
            className="mc-grid"
          />
        ))}

        <path d={areaD} fill="url(#mcGradient)" stroke="none" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" />

        <text x={4} y={PAD_TOP + 10} className="mc-axisLabel">
          {maxPrice.toFixed(6)}
        </text>
        <text x={4} y={PAD_TOP + innerH} className="mc-axisLabel">
          {minPrice.toFixed(6)}
        </text>

        {[0, Math.floor(coords.length / 2), coords.length - 1].map((i) => (
          <text key={i} x={coords[i].x} y={HEIGHT - 10} className="mc-axisLabel mc-axisLabelX" textAnchor="middle">
            {formatDateTime(points[i].timestamp, timeframeKey)}
          </text>
        ))}

        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={PAD_TOP} y2={PAD_TOP + innerH} className="mc-crosshair" />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={color} stroke="#0a0c12" strokeWidth="2" />
          </>
        )}
      </svg>

      {hover && (
        <div
          className="mc-tooltip"
          style={{
            left: `${(hover.x / WIDTH) * 100}%`,
            top: `${Math.max(6, (hover.y / HEIGHT) * 100 - 16)}%`,
          }}
        >
          <div className="mc-tooltipTime">{formatDateTime(hover.timestamp, timeframeKey)}</div>
          <div className="mc-tooltipPrice">{hover.price.toFixed(6)}</div>
        </div>
      )}
    </div>
  );
}
