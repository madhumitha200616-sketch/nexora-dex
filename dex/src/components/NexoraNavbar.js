import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import NexoraLogo from "./ui/NexoraLogo";
import Sepolia from "../sepolia-badge.png";
import "./NexoraNavbar.css";

// Nexora's own information architecture - grouped by INTENT (what you're
// trying to do) rather than a flat list of every route, which is what
// made the old nav read as "a typical DEX menu" (Home/Swap/Pools/Markets/
// Analytics/Portfolio/Wallet...) instead of something distinctly Nexora's.
// Every existing route in App.js is still reachable, just organized under
// one of these six groups - nothing here is a new page or new feature.
const NAV_GROUPS = [
  { key: "overview", label: "Overview", to: "/" },
  {
    key: "trade",
    label: "Trade",
    items: [
      { to: "/swap", label: "Swap" },
      { to: "/route", label: "Route" },
      { to: "/wrap", label: "Wrap ETH" },
    ],
  },
  {
    key: "liquidity",
    label: "Liquidity",
    items: [
      { to: "/pools", label: "Pools" },
      { to: "/add-liquidity", label: "Add Liquidity" },
    ],
  },
  {
    key: "discover",
    label: "Discover",
    items: [
      { to: "/markets", label: "Markets" },
      { to: "/explorer", label: "Token Explorer" },
      { to: "/faucets", label: "Faucets" },
      { to: "/nexora-faucet", label: "Nexora Faucet" },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    items: [
      { to: "/chart", label: "Analytics" },
      { to: "/tokens", label: "Activity" },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    items: [
      { to: "/portfolio", label: "Portfolio" },
      { to: "/wallet", label: "Wallet" },
    ],
  },
];

// Zap has a real route/page in this app, but is deliberately left out of
// the primary nav per the requested IA (not a removed feature - still
// reachable at /zap via a direct link or the Liquidity page, just not
// promoted in the navbar).

const ALL_LINKS = NAV_GROUPS.flatMap((g) => (g.items ? g.items : [{ to: g.to, label: g.label }]));

function formatAddress(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function NavGroup({ group, pathname, openKey, setOpenKey }) {
  const ref = useRef(null);
  const isOpen = openKey === group.key;
  const isActive = group.items
    ? group.items.some((i) => pathname === i.to)
    : pathname === group.to;

  useEffect(() => {
    if (!isOpen) return;
    function onOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpenKey(null);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [isOpen, setOpenKey]);

  if (!group.items) {
    return (
      <Link to={group.to} className={`nx-nav-item ${isActive ? "nx-active" : ""}`}>
        {group.label}
      </Link>
    );
  }

  return (
    <div className={`nx-nav-group ${isOpen ? "nx-open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`nx-nav-item ${isActive ? "nx-active" : ""}`}
        onClick={() => setOpenKey(isOpen ? null : group.key)}
      >
        {group.label}
        <span className="nx-nav-caret">▾</span>
      </button>
      {isOpen && (
        <div className="nx-nav-dropdown">
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`nx-nav-item ${pathname === item.to ? "nx-active" : ""}`}
              onClick={() => setOpenKey(null)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NexoraNavbar({ connect, isConnected, address, onOpenSearch, onOpenNotifications, hasUnread }) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openKey, setOpenKey] = useState(null);

  return (
    <header className="nx-nav">
      <div className="nx-nav-left">
        <Link to="/" className="nx-nav-logo" title="Nexora Home">
          <NexoraLogo variant="navbar" size="md" />
        </Link>
        {NAV_GROUPS.map((group) => (
          <NavGroup key={group.key} group={group} pathname={pathname} openKey={openKey} setOpenKey={setOpenKey} />
        ))}
      </div>

      <button
        type="button"
        className="nx-nav-burger"
        aria-label="Open navigation"
        onClick={() => setMobileOpen((o) => !o)}
      >
        {mobileOpen ? "✕" : "☰"}
      </button>

      <div className="nx-nav-right">
        <button type="button" className="nx-nav-search-pill" title="Search (Ctrl+K)" onClick={onOpenSearch}>
          <span aria-hidden="true">🔍</span>
          <span className="nx-nav-search-label">Search</span>
          <span className="nx-nav-search-kbd">⌘K</span>
        </button>
        <button type="button" className="nx-nav-icon-btn" title="Notifications" onClick={onOpenNotifications}>
          🔔
          {hasUnread && <span className="nx-nav-dot" />}
        </button>
        <div className="nx-nav-network">
          <img src={Sepolia} alt="Sepolia" />
          <span>Sepolia</span>
        </div>
        <button type="button" className="nx-btn nx-btn-primary nx-btn-sm nx-nav-connect" onClick={connect}>
          {isConnected ? formatAddress(address) : "Connect Wallet"}
        </button>
      </div>

      {mobileOpen && (
        <div className="nx-nav-mobile-panel">
          {NAV_GROUPS.map((group) => (
            <React.Fragment key={group.key}>
              <div className="nx-nav-section-label">{group.label}</div>
              {(group.items || [{ to: group.to, label: group.label }]).map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`nx-nav-item ${pathname === link.to ? "nx-active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </header>
  );
}

export { ALL_LINKS };
export default NexoraNavbar;
