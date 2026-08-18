import React from "react";
import "./ui.css";

function PrimaryButton({ full = false, size, className = "", children, ...rest }) {
  const classes = [
    "nx-btn",
    "nx-btn-primary",
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

export default PrimaryButton;
