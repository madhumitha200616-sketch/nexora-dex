import React from "react";
import "./ui.css";
import { handleTiltMove, handleTiltLeave } from "../../tiltEffect";

// Shared premium glass surface used across every Nexora page. `glow` adds
// the animated conic-gradient border seen originally on the Nexora Faucet
// page; `tilt` opts into the existing mouse-tilt hover effect so cards feel
// consistent with the rest of the app without re-implementing it per page.
function GlassCard({
  as: Tag = "div",
  glow = false,
  hoverable = false,
  tilt = false,
  pad = "md",
  className = "",
  style,
  children,
  ...rest
}) {
  const classes = [
    "nx-glass-card",
    glow ? "nx-glow" : "",
    hoverable ? "nx-hoverable" : "",
    `nx-pad-${pad}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const tiltProps = tilt
    ? {
        onMouseMove: (e) => handleTiltMove(e, 5),
        onMouseLeave: handleTiltLeave,
      }
    : {};

  return (
    <Tag className={classes} style={style} {...tiltProps} {...rest}>
      {children}
    </Tag>
  );
}

export default GlassCard;
