/**
 * components/AnimatedNumber.tsx
 * Renders the target during SSR/hydration, then animates to it after mount.
 */
import { useEffect, useState, useRef } from "react";

interface AnimatedNumberProps {
  value: number | string;
  duration?: number;
  formatter?: (val: number) => string;
}

export default function AnimatedNumber({ value, duration = 1500, formatter }: AnimatedNumberProps) {
  const numericValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  // The server and the first hydrated render must agree on the final value.
  // Starting at zero here causes a hydration mismatch and a visible flash.
  const [displayValue, setDisplayValue] = useState(numericValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    startTimeRef.current = null;
    setDisplayValue(0);

    const animate = (time: number) => {
      if (startTimeRef.current === null) startTimeRef.current = time;
      const progress = Math.min((time - startTimeRef.current) / duration, 1);
      
      const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
      setDisplayValue(easedProgress * numericValue);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [numericValue, duration]);

  return <>{formatter ? formatter(displayValue) : Math.floor(displayValue).toLocaleString()}</>;
}
