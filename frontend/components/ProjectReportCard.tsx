import React from "react";

export interface ProjectReportCardProps {
  onDownloadReport: () => void;
}

export default function ProjectReportCard({ onDownloadReport }: ProjectReportCardProps) {
  return (
    <div className="card text-center bg-forest-50 border-forest-200">
      <p className="font-display font-semibold text-forest-900 mb-2">
        Impact Report 📊
      </p>
      <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] mb-3 font-body">
        Download a print-friendly summary of this project&apos;s progress and impact.
      </p>
      <button
        onClick={onDownloadReport}
        className="btn-primary text-sm py-2 px-4 w-full inline-flex items-center justify-center gap-2"
      >
        📄 Download Report
      </button>
    </div>
  );
}
