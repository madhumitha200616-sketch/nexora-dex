import React from "react";
import GlassCard from "./GlassCard";
import "./ui.css";

const ICONS = {
  "📈": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  "🔄": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  ),
  "👥": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  "📊": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
};

function StatCard({ label, value, trend, trendLabel, icon, glow = false, className = "" }) {
  const isLoading = value === "…" || value === "...";
  const renderIcon = typeof icon === "string" && ICONS[icon] ? ICONS[icon] : icon;

  return (
    <GlassCard glow={glow} hoverable pad="md" className={`nx-stat-card ${className}`}>
      {renderIcon && <div className="nx-stat-icon-badge">{renderIcon}</div>}
      <div className="nx-stat-body">
        <div className="nx-stat-label">{label}</div>
        <div className="nx-stat-value">
          {isLoading ? (
            <span style={{ display: "inline-block", width: 70, height: 22, borderRadius: 6, background: "rgba(255, 255, 255, 0.08)", animation: "nx-shimmer 1.5s infinite" }} />
          ) : (
            value
          )}
        </div>
        {trend && trendLabel && (
          <span className={`nx-stat-trend nx-${trend}`}>{trendLabel}</span>
        )}
      </div>
    </GlassCard>
  );
}

export default StatCard;
