import * as React from "react";

const DEFAULT_STICKY_TOP_PX = 65;

export function useStickyTabs(stickyTopPx = DEFAULT_STICKY_TOP_PX) {
  const stickyRef = React.useRef<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = React.useState(false);

  React.useEffect(() => {
    const updateStickyState = () => {
      const nextIsStuck = (stickyRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) <= stickyTopPx + 0.5;
      setIsStuck((previous) => (previous === nextIsStuck ? previous : nextIsStuck));
    };

    updateStickyState();
    window.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);

    return () => {
      window.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [stickyTopPx]);

  return { stickyRef, isStuck };
}
