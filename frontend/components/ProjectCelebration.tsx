import React from "react";
import { formatAmount, formatXLM } from "@/utils/format";

export interface ProjectCelebrationProps {
  isComplete: boolean;
  donorCount: number;
  raisedXLM: string;
  raisedUSDC?: string;
  goalXLM: string;
  particles: Array<{ left: string; animationDelay: string; animationDuration: string }>;
}

export default function ProjectCelebration({
  isComplete,
  donorCount,
  raisedXLM,
  raisedUSDC,
  goalXLM,
  particles,
}: ProjectCelebrationProps) {
  if (!isComplete) return null;

  return (
    <>
      <div className="celebration-overlay">
        {particles.map((particle, i) => (
          <div
            key={i}
            className={
              i % 2 === 0 ? "celebration-leaf" : "celebration-confetti"
            }
            style={particle}
          />
        ))}
      </div>

      <div className="celebration-banner mb-6 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 text-white rounded-2xl p-8 text-center shadow-2xl border-4 border-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="text-6xl mb-4 animate-bounce motion-reduce:animate-none">🎉</div>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-3">
            Fully Funded!
          </h2>
          <p className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto font-body">
            This project has reached its funding goal! Thank you to all{" "}
            {formatAmount(donorCount, 0)} donors who made this possible.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-6 py-3 rounded-full border border-white/30">
            <span className="text-2xl">✅</span>
            <span className="font-semibold text-lg">
              {formatXLM(raisedXLM)} XLM raised{Number(raisedUSDC || 0) > 0 ? ` · ${formatAmount(Number(raisedUSDC))} USDC` : ""} of{" "}
              {formatXLM(goalXLM)} goal
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
