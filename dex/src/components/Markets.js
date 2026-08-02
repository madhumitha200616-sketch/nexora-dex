import React, { useState, useEffect } from 'react'
import axios from "axios";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

import tokenList from "../tokenList.json";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";
import { CHART_RANGE_LABELS, CHART_RANGE_SHORT, densifyChartData } from "../chartUtils";
import { API_BASE_URL } from "../apiConfig";

// Only tokens with a real Sepolia contract have anything to chart against -
// same filter used by Tokens.js and Wallet.js.
const SEPOLIA_TOKENS = tokenList.filter((t) => t.sepoliaAddress);

function fetchChartData(address, days, onDone) {
  axios.get(`${API_BASE_URL}/priceHistory`, {
    params: { address, days }
  }).then((res) => {
    onDone(res.data.points || []);
  }).catch((err) => {
    console.error("Chart data fetch failed:", err);
    onDone([]);
  });
}

function Markets() {
  const [token, setToken] = useState(SEPOLIA_TOKENS[0]);
  const [chartRange, setChartRange] = useState("7");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchChartData(token.address, chartRange, (points) => {
      setChartData(points);
      setLoading(false);
    });
  }, [token, chartRange]);

  const chartFirstPrice = chartData.length > 0 ? chartData[0].price : null;
  const chartLastPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : null;
  const chartTrendPct =
    chartFirstPrice && chartLastPrice
      ? ((chartLastPrice - chartFirstPrice) / chartFirstPrice) * 100
      : null;
  const chartIsUp = chartTrendPct !== null && chartTrendPct >= 0;
  const displayChartData = chartData.length > 0 && chartData.length < 40
    ? densifyChartData(chartData)
    : chartData;

  return (
    <div className="swapPageColumn">
      <div className="chartBox marketsBox" onMouseMove={handleTiltMove} onMouseLeave={handleTiltLeave}>
        <div className="chartTitleRow">
          <div className="wrapTabs">
            {SEPOLIA_TOKENS.map((t) => (
              <span
                key={t.ticker}
                className={token.ticker === t.ticker ? "wrapTab wrapTabActive" : "wrapTab"}
                onClick={() => setToken(t)}
              >
                {t.ticker}
              </span>
            ))}
          </div>
          {chartTrendPct !== null && (
            <div className={chartIsUp ? "chartTrend chartTrendUp" : "chartTrend chartTrendDown"}>
              {chartIsUp ? "▲" : "▼"} {Math.abs(chartTrendPct).toFixed(2)}%
            </div>
          )}
        </div>

        <div className="chartTitle marketsSubtitle">
          {token.ticker} price - last {CHART_RANGE_LABELS[chartRange]}
        </div>

        <div className="wrapTabs chartRangeTabs">
          {Object.keys(CHART_RANGE_LABELS).map((range) => (
            <span
              key={range}
              className={chartRange === range ? "wrapTab wrapTabActive" : "wrapTab"}
              onClick={() => setChartRange(range)}
            >
              {CHART_RANGE_SHORT[range]}
            </span>
          ))}
        </div>

        {loading && <div className="tokensEmpty">Loading chart...</div>}

        {!loading && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={380}>
            <AreaChart data={displayChartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                {/* A gradient stroke instead of a flat trend color - cyan
                    into magenta, matching the app's neon identity, so the
                    chart pops regardless of whether the token is up or
                    down. The up/down badge above still carries the actual
                    green/red trend signal. */}
                <linearGradient id="marketsStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#00d9ff" />
                  <stop offset="100%" stopColor="#ff2ee6" />
                </linearGradient>
                <linearGradient id="marketsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d9ff" stopOpacity={0.35} />
                  <stop offset="60%" stopColor="#ff2ee6" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#ff2ee6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" stroke="#5F6783" fontSize={11} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#5F6783" fontSize={11} domain={['auto', 'auto']} width={64} />
              <Tooltip
                contentStyle={{ background: "#0E111B", border: "1px solid #21273a", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
              />
              <Area
                type="natural"
                dataKey="price"
                stroke="url(#marketsStroke)"
                strokeWidth={3}
                fill="url(#marketsFill)"
                dot={false}
                activeDot={{ r: 5, stroke: "#ff2ee6", strokeWidth: 2, fill: "#0E111B" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {!loading && chartData.length === 0 && (
          <div className="tokensEmpty">Couldn't load chart data right now.</div>
        )}
      </div>
    </div>
  );
}

export default Markets
