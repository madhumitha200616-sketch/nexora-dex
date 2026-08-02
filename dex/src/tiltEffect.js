// Shared 3D mouse-tilt hover effect, used across the app's cards (chart,
// wrap box, faucet cards, wallet stat cards) - the trade box on the Swap
// page pioneered this look with its own bespoke handlers; this is the same
// technique factored out so it can be dropped onto any element via plain
// onMouseMove/onMouseLeave props, including elements rendered in a .map()
// where there's no single persistent ref to hook into.
//
// Pure CSS transform, no animation library - reads the cursor position
// relative to the hovered element and rotates it slightly toward the
// cursor, then eases back flat on mouse leave (the "hovering above the
// table" depth feel).
export function handleTiltMove(e, maxDeg = 6) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * maxDeg;
  const rotateX = -((y - rect.height / 2) / (rect.height / 2)) * maxDeg;
  el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.015, 1.015, 1.015)`;
}

export function handleTiltLeave(e) {
  e.currentTarget.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
}
