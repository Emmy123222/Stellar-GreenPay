import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);

    // Older Safari versions expose addListener instead of addEventListener.
    if (!mediaQuery.addEventListener) {
      mediaQuery.addListener?.(updatePreference);
    }

    return () => {
      mediaQuery.removeEventListener?.("change", updatePreference);
      if (!mediaQuery.removeEventListener) {
        mediaQuery.removeListener?.(updatePreference);
      }
    };
  }, []);

  return prefersReducedMotion;
}
