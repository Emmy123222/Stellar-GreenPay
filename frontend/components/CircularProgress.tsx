import React, { useEffect, useState } from "react";

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}

export default function CircularProgress({
  percentage,
  size = 48,
  strokeWidth = 4,
}: CircularProgressProps) {
  const [offset, setOffset] = useState<number | null>(null);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  useEffect(() => {
    // Determine target offset
    const p = Math.min(Math.max(percentage, 0), 100);
    const progressOffset = ((100 - p) / 100) * circumference;

    // Small delay ensures the initial render (with 0% circle) 
    // happens, and then CSS animates it filling up.
    const timer = setTimeout(() => {
      setOffset(progressOffset);
    }, 50);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  const initialOffset = circumference;

  let colorClass = "text-green-500";
  if (percentage >= 50 && percentage <= 80) {
    colorClass = "text-teal-500";
  } else if (percentage > 80) {
    colorClass = "text-emerald-500";
  }

  return (
    <div className="relative inline-flex items-center justify-center font-body" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background rounded track */}
        <circle
          className="text-[#e2ece2] stroke-current"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* Colored arc */}
        <circle
          className={`${colorClass} stroke-current transition-all ease-out duration-1000`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset === null ? initialOffset : offset}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <span className="absolute font-semibold text-forest-900" style={{ fontSize: Math.max(10, size * 0.25) }}>
        {Math.round(percentage)}%
      </span>
    </div>
  );
}
