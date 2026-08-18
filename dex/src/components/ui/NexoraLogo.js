import React from "react";
import "./NexoraLogo.css";

/**
 * Nexora Premium Geometric Monogram Logo Component
 *
 * Variants:
 *  - "full": Main logo icon + "NEXORA" wordmark (default)
 *  - "icon": Compact icon-only version (for mobile / favicon / badges)
 *  - "navbar": Navbar version with hover glow and scale dynamics
 *  - "footer": Footer version with subtle muted branding
 */
export default function NexoraLogo({
  variant = "full",
  size = "md",
  showWordmark = true,
  className = "",
  style = {},
}) {
  const iconSizes = { sm: 26, md: 34, lg: 46 };
  const iconSize = typeof size === "number" ? size : iconSizes[size] || 34;

  const forceIconOnly = variant === "icon" || showWordmark === false;

  return (
    <div
      className={`nx-brand-logo nx-brand-logo-${variant} ${className}`}
      style={style}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="nx-brand-svg"
        aria-label="Nexora Monogram"
      >
        <defs>
          {/* Subtle Outer Ambient Glow Filter */}
          <filter id="nxLogoAmbientGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Precision Left Bar Gradient (Deep Violet to Indigo) */}
          <linearGradient id="nxGradLeft" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>

          {/* Central Diagonal Blade Gradient (Electric Purple to Cyan) */}
          <linearGradient id="nxGradDiag" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="45%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>

          {/* Right Bar Gradient (Cyan to Deep Teal) */}
          <linearGradient id="nxGradRight" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>

          {/* Outer Shield Hex Base Fill */}
          <radialGradient id="nxShieldBase" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#181729" />
            <stop offset="100%" stopColor="#0a0a14" />
          </radialGradient>

          {/* Precision Metallic Border Edge */}
          <linearGradient id="nxShieldBorder" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(192, 132, 252, 0.45)" />
            <stop offset="50%" stopColor="rgba(56, 189, 248, 0.25)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0.08)" />
          </linearGradient>
        </defs>

        {/* Outer Dark Chamfered Hex Base Plate */}
        <path
          d="M 50 6 L 88 26 L 88 74 L 50 94 L 12 74 L 12 26 Z"
          fill="url(#nxShieldBase)"
          stroke="url(#nxShieldBorder)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Inner Subtle Geometric Guide Ring */}
        <polygon
          points="50,14 81,31 81,69 50,86 19,69 19,31"
          fill="none"
          stroke="rgba(255, 255, 255, 0.06)"
          strokeWidth="1.2"
        />

        {/* Monogram "N" Geometric Construction */}
        <g filter="url(#nxLogoAmbientGlow)" className="nx-brand-monogram">
          {/* Left Vertical Pillar */}
          <path
            d="M 27 26 C 27 24.5 28 23.5 29.5 23.5 L 37.5 23.5 C 39 23.5 40 24.5 40 26 L 40 74 C 40 75.5 39 76.5 37.5 76.5 L 29.5 76.5 C 28 76.5 27 75.5 27 74 Z"
            fill="url(#nxGradLeft)"
          />

          {/* Center Diagonal Precision Blade */}
          <path
            d="M 33 24.5 L 69 71.5 C 70.5 73.5 72.5 73.5 73.5 71.8 L 73.5 63.5 L 39 17 C 37 15 34.5 15.5 33 18.5 Z"
            fill="url(#nxGradDiag)"
          />

          {/* Right Vertical Pillar */}
          <path
            d="M 60 26 C 60 24.5 61 23.5 62.5 23.5 L 70.5 23.5 C 72 23.5 73 24.5 73 26 L 73 74 C 73 75.5 72 76.5 70.5 76.5 L 62.5 76.5 C 61 76.5 60 75.5 60 74 Z"
            fill="url(#nxGradRight)"
          />

          {/* Top-Right Connectivity Accent Node */}
          <circle cx="75" cy="19.5" r="4.5" fill="#38bdf8" />
          <circle cx="75" cy="19.5" r="2" fill="#ffffff" />
        </g>
      </svg>

      {!forceIconOnly && (
        <div className="nx-brand-wordmark" style={{ fontSize: iconSize * 0.58 }}>
          <span className="nx-brand-word-main">NEX</span>
          <span className="nx-brand-word-accent">ORA</span>
        </div>
      )}
    </div>
  );
}
