import React, { useEffect, useRef } from 'react'

// Purely cosmetic: a soft radial glow that follows the cursor, giving the
// whole app a bit of that "premium Web3 dashboard" ambient-light feel.
// Implemented as a single fixed div whose position is updated directly via
// a ref (not React state) so mouse movement never triggers a re-render -
// no business logic anywhere touches this, and it renders nothing on
// touch-only devices where there's no cursor to follow.
function CursorGlow() {
  const glowRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      // Touch device - no cursor, skip wiring up listeners entirely.
      return;
    }

    function handleMove(e) {
      const el = glowRef.current;
      if (!el) return;
      el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      el.style.opacity = "1";
    }

    function handleLeave() {
      const el = glowRef.current;
      if (el) el.style.opacity = "0";
    }

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  return <div className="cursorGlow" ref={glowRef} aria-hidden="true" />;
}

export default CursorGlow
