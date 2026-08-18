import React from "react";
import "./ui.css";

function SecondaryButton({ full = false, size, className = "", children, ...rest }) {
  const classes = [
    "nx-btn",
    "nx-btn-secondary",
    full ? "nx-btn-full" : "",
    size === "sm" ? "nx-btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}

export default SecondaryButton;
