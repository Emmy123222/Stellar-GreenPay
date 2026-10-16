import React, { useState } from "react";
import { createProjectCampaign, fetchProject } from "@/lib/api";
import { formatDate, formatXLM } from "@/utils/format";
import type { ClimateProject, ProjectCampaign } from "@/utils/types";

export interface ProjectCampaignsProps {
  projectId: string;
  completedCampaigns: ProjectCampaign[];
  onCampaignCreated?: (updatedProject: ClimateProject) => void;
}

export default function ProjectCampaigns({
  projectId,
  completedCampaigns,
  onCampaignCreated,
}: ProjectCampaignsProps) {
  const [campaignForm, setCampaignForm] = useState({
    title: "",
    goalXLM: "",
    deadline: "",
    description: "",
  });
  const [campaignState, setCampaignState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [campaignError, setCampaignError] = useState<string | null>(null);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setCampaignState("saving");
    setCampaignError(null);
    try {
      await createProjectCampaign(projectId, campaignForm);
      const updatedProject = await fetchProject(projectId);
      if (onCampaignCreated) {
        onCampaignCreated(updatedProject);
      }
      setCampaignForm({ title: "", goalXLM: "", deadline: "", description: "" });
      setCampaignState("success");
      window.setTimeout(() => setCampaignState("idle"), 2000);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCampaignError(message || "Could not create campaign.");
      setCampaignState("error");
    }
  };

  return (
    <>
      {completedCampaigns.length > 0 && (
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-forest-900 mb-4">
            Campaign History
          </h2>
          <div className="space-y-3">
            {completedCampaigns.map((campaign: ProjectCampaign) => (
              <div
                key={campaign.id}
                className="rounded-xl border border-forest-200 bg-forest-50 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="font-semibold text-forest-900 font-body">
                    {campaign.title}
                  </p>
                  <span className="text-xs px-2 py-1 rounded-full bg-forest-100 border border-forest-200 text-forest-700 font-body">
                    Completed
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body mb-2">
                  Ended {formatDate(campaign.deadline)}
                </p>
                <div className="flex justify-between text-xs mb-1 font-body">
                  <span>{formatXLM(campaign.raisedXLM)} raised</span>
                  <span>
                    {campaign.progressPercent}% of {formatXLM(campaign.goalXLM)}
                  </span>
                </div>
                <div className="progress-bar h-2">
                  <div
                    className="progress-fill progress-fill-complete"
                    style={{
                      width: `${Math.min(campaign.progressPercent, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card bg-forest-50 border-forest-200">
        <h2 className="font-display text-lg font-semibold text-forest-900 mb-2">
          Campaign Creator
        </h2>
        <p className="text-xs text-[var(--text-secondary)] dark:text-[#8aaa8a] font-body mb-4">
          Project admins can launch a time-limited campaign with a custom goal and deadline.
        </p>
        <form onSubmit={handleCreateCampaign} className="space-y-3">
          <input
            type="text"
            required
            placeholder="Campaign title"
            value={campaignForm.title}
            onChange={(e) =>
              setCampaignForm((prev) => ({ ...prev, title: e.target.value }))
            }
            className="input-field"
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="number"
              required
              min="1"
              step="1"
              placeholder="Goal (XLM)"
              value={campaignForm.goalXLM}
              onChange={(e) =>
                setCampaignForm((prev) => ({ ...prev, goalXLM: e.target.value }))
              }
              className="input-field"
            />
            <input
              type="datetime-local"
              required
              aria-label="Campaign deadline"
              value={campaignForm.deadline}
              onChange={(e) =>
                setCampaignForm((prev) => ({ ...prev, deadline: e.target.value }))
              }
              className="input-field"
            />
          </div>
          <textarea
            placeholder="Description (optional)"
            value={campaignForm.description}
            onChange={(e) =>
              setCampaignForm((prev) => ({ ...prev, description: e.target.value }))
            }
            className="input-field min-h-24"
          />
          {campaignError && (
            <p className="text-xs text-red-600 font-body">{campaignError}</p>
          )}
          <button
            type="submit"
            disabled={campaignState === "saving"}
            className="btn-primary text-sm py-2 px-4"
          >
            {campaignState === "saving"
              ? "Saving..."
              : campaignState === "success"
              ? "Campaign Created"
              : "Create Campaign"}
          </button>
        </form>
      </div>
    </>
  );
}
