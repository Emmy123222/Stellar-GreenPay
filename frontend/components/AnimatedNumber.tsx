/**
 * components/AnimatedNumber.tsx
 * Renders the target during SSR/hydration, then animates to it after mount.
 */
import { useEffect, useState, useRef } from "react";
import { normalizeXLMAmount } from "@/utils/format";

export { normalizeXLMAmount };

export interface AnimatedNumberProps {
  value: number | string;
  duration?: number;
  formatter?: (val: number) => string;
  unit?: string;
}

export default function AnimatedNumber({
  value,
  duration = 1500,
  formatter,
  unit,
}: AnimatedNumberProps) {
  const isXLM = unit === "XLM";
  const isScientific = typeof value === "string" && /[eE]/.test(value);
  const isSmallFloat = typeof value === "number" && !Number.isInteger(value);

  const normalizedInput =
    isXLM || isScientific || (isSmallFloat && Math.abs(value) < 1)
      ? normalizeXLMAmount(value)
      : value;

  const rawParsed =
    typeof normalizedInput === "string"
      ? parseFloat(normalizedInput.replace(/,/g, ""))
      : Number(normalizedInput);

  const numericValue = isNaN(rawParsed) || !Number.isFinite(rawParsed) ? 0 : rawParsed;

  const decimalPlaces = (() => {
    if (typeof normalizedInput === "string" && normalizedInput.includes(".")) {
      return normalizedInput.split(".")[1]?.length ?? 0;
    }
    if (isXLM) return 7;
    return 0;
  })();

  // The server and the first hydrated render must agree on the final value.
  // Starting at zero here causes a hydration mismatch and a visible flash.
  const [displayValue, setDisplayValue] = useState(numericValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (duration <= 0) {
      return;
    }

    startTimeRef.current = null;
    let animationFrameId: number;
    startTimeRef.current = null;

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

  const formatDisplay = (val: number) => {
    if (formatter) return formatter(val);
    if (decimalPlaces > 0) return val.toFixed(decimalPlaces);
    return Math.floor(val).toLocaleString();
  };

  const effectiveValue = duration <= 0 ? numericValue : displayValue;
  const renderedContent = formatDisplay(effectiveValue);

  return (
    <>
      {renderedContent}
      {unit ? ` ${unit}` : null}
    </>
  );
}
