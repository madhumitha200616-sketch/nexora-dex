import React, { Suspense } from "react";
import "./ui.css";

// Consistent page chrome (eyebrow / gradient title / subtitle + max-width
// content column) used by every redesigned and new page, matching the
// look already established on the Nexora Faucet page. `background` accepts
// a lazily-loaded ThreeDBackground element so heavy three.js scenes are
// only pulled into pages that actually want one, and never block first
// paint of the page's real content.
function PageShell({
  eyebrow,
  title,
  subtitle,
  align = "center",
  background,
  contentClassName = "",
  className = "",
  children,
}) {
  return (
    <div className={`nx-page-shell ${className}`}>
      {background && <Suspense fallback={null}>{background}</Suspense>}
      <div className={`nx-page-content ${contentClassName}`}>
        {(eyebrow || title || subtitle) && (
          <div className={`nx-page-header nx-align-${align}`}>
            {eyebrow && (
              <div className="nx-eyebrow">
                <span className="nx-eyebrow-dot" />
                {eyebrow}
              </div>
            )}
            {title && <h1 className="nx-page-title">{title}</h1>}
            {subtitle && <p className="nx-page-sub">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default PageShell;
