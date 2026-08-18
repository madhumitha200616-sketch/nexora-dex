import React from "react";
import GlassCard from "./GlassCard";
import "./ui.css";

// Used everywhere a feature has real, honest nothing to show yet - e.g. no
// on-chain LP position reader exists, or a page's action isn't wired to a
// deployed contract. Never used to fabricate data; `badge` is meant for a
// short "Not available yet" / "Coming soon" label, not a fake status.
function EmptyState({ icon = "◇", title, description, badge, action }) {
  return (
    <GlassCard pad="lg" className="nx-empty-state-card">
      <div className="nx-empty-state">
        <div className="nx-empty-icon">{icon}</div>
        {title && <div className="nx-empty-title">{title}</div>}
        {description && <div className="nx-empty-desc">{description}</div>}
        {badge && <span className="nx-empty-badge">{badge}</span>}
        {action}
      </div>
    </GlassCard>
  );
}

export default EmptyState;
