import React from "react";
import DescriptionAccordion from "@/components/DescriptionAccordion";

export interface ProjectAboutProps {
  description: string;
  tags?: string[];
}

export default function ProjectAbout({ description, tags = [] }: ProjectAboutProps) {
  return (
    <div className="card">
      <h2 className="font-display text-lg font-semibold text-forest-900 mb-3">
        About this Project
      </h2>
      <DescriptionAccordion description={description} />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-forest-50 text-forest-700 border border-forest-200 px-2.5 py-1 rounded-full font-body"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
