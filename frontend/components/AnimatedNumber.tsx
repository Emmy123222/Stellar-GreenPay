/**
 * components/AnimatedNumber.tsx
 * Animates a number from 0 to the target value on mount.
 */
import { useEffect, useState, useRef } from "react";

interface AnimatedNumberProps {
  value: number | string;
  duration?: number;
  formatter?: (val: number) => string;
}

export default function AnimatedNumber({ value, duration = 1500, formatter }: AnimatedNumberProps) {
  const numericValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  const [displayValue, setDisplayValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let animationFrameId: number;

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
