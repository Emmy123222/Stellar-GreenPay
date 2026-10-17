import React from "react";
import { formatCO2 } from "@/utils/format";

export interface ProjectImpactCalculatorProps {
  calcAmount: string;
  onAmountChange: (amount: string) => void;
  co2OffsetKg: number;
}

export default function ProjectImpactCalculator({
  calcAmount,
  onAmountChange,
  co2OffsetKg,
}: ProjectImpactCalculatorProps) {
  const calcAmountNum = parseFloat(calcAmount) || 0;
  const estimatedCO2 = calcAmountNum * (co2OffsetKg || 0);
  const treesEquivalent = estimatedCO2 / 22;

  let analogy = "";
  if (treesEquivalent === 0) analogy = "Enter an amount to see your impact!";
  else if (treesEquivalent < 1) analogy = "A tiny sprout of change! 🌱";
  else if (treesEquivalent < 10) analogy = "A small grove taking root! 🌳";
  else if (treesEquivalent < 50) analogy = "A growing mini-forest! 🌲";
  else analogy = "A massive impact for our planet! 🌍";

  return (
    <div className="card bg-forest-50 border-forest-200">
      <h3 className="font-display font-semibold text-forest-900 mb-2">
        Impact Calculator
      </h3>
      <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] mb-3 font-body">
        See what your donation can achieve before you give.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {["10", "25", "50", "100", "250"].map((p) => (
          <button
            key={p}
            onClick={() => onAmountChange(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all motion-reduce:transition-none ${
              calcAmount === p
                ? "bg-forest-600 text-white border-forest-600 shadow-sm"
                : "bg-white text-forest-700 border-forest-200 hover:border-forest-400"
            }`}
          >
            {p} XLM
          </button>
        ))}
      </div>

      <div className="mb-4">
        <input
          type="number"
          value={calcAmount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="Custom amount"
          min="0"
          className="w-full px-3 py-2 text-sm rounded-lg border border-forest-200 bg-white focus:outline-none focus:ring-2 focus:ring-forest-400 font-body placeholder-[var(--text-tertiary)]"
        />
      </div>

      {calcAmountNum > 0 && (
        <div className="p-3 bg-white rounded-lg border border-forest-100 shadow-sm animate-fade-in motion-reduce:animate-none">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">♻️</span>
            <span className="font-semibold text-forest-800 text-sm font-body">
              {formatCO2(estimatedCO2)} offset
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🌳</span>
            <span className="font-semibold text-forest-800 text-sm font-body">
              ~{treesEquivalent.toFixed(1)} trees/year
            </span>
          </div>
          <div className="pt-2 border-t border-forest-50 text-center">
            <span className="text-xs text-forest-600 font-medium italic font-body">
              {analogy}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
