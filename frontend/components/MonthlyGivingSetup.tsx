import { useEffect, useMemo, useState } from "react";
import { createMonthlySubscription, loadMonthlySubscriptions } from "@/lib/monthlyGiving";
import { formatXLM, timeAgo } from "@/utils/format";
import type { MonthlySubscription } from "@/utils/types";

interface MonthlyGivingSetupProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onCreated?: (subscriptionId: string) => void;
}

const DURATION_OPTIONS = [
  { label: "3 months", value: "3" },
  { label: "6 months", value: "6" },
  { label: "12 months", value: "12" },
  { label: "Indefinite", value: "indefinite" },
];

export default function MonthlyGivingSetup({
  projectId,
  projectName,
  onClose,
  onCreated,
}: MonthlyGivingSetupProps) {
  const [amountXLM, setAmountXLM] = useState("25");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState("3");
  const [subscriptions, setSubscriptions] = useState<MonthlySubscription[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const all = loadMonthlySubscriptions();
    setSubscriptions(all.filter((sub) => sub.projectId === projectId));
  }, [projectId]);

  const canCreate = useMemo(() => {
    const amount = Number.parseFloat(amountXLM);
    if (!Number.isFinite(amount) || amount < 1) return false;
    if (!startDate) return false;
    return true;
  }, [amountXLM, startDate]);

  const handleCreate = () => {
    if (!canCreate) {
      setError("Enter a valid amount and start date.");
      return;
    }
    setError(null);
    const durationMonths = duration === "indefinite" ? null : Number.parseInt(duration, 10);
    const created = createMonthlySubscription({
      projectId,
      projectName,
      amountXLM: Number.parseFloat(amountXLM).toFixed(7),
      startDate: new Date(startDate).toISOString(),
      durationMonths,
    });
    onCreated?.(created.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl card bg-white max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl font-semibold text-forest-900">Monthly Giving Setup</h3>
          <button onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">Close</button>
        </div>

        <p className="text-sm text-[#5a7a5a] font-body mb-5">
          Schedule recurring monthly donations for <strong>{projectName}</strong>.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Amount (XLM)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={amountXLM}
              onChange={(e) => setAmountXLM(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="label">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Duration</label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDuration(option.value)}
                  className={`px-3 py-2 rounded-lg text-sm border font-body ${
                    duration === option.value
                      ? "bg-forest-500 text-white border-forest-500"
                      : "bg-forest-50 text-forest-700 border-forest-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 font-body">{error}</p>}

        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate}
          className="btn-primary w-full mt-5 disabled:opacity-60"
        >
          Save Monthly Giving
        </button>

        <div className="mt-8 border-t border-forest-100 pt-5">
          <h4 className="font-display text-lg font-semibold text-forest-900 mb-3">Subscription History</h4>
          {subscriptions.length === 0 ? (
            <p className="text-sm text-[#5a7a5a] font-body">No subscriptions created for this project yet.</p>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <div key={sub.id} className="p-3 rounded-lg border border-forest-200 bg-forest-50">
                  <p className="text-sm font-semibold text-forest-900 font-body">
                    {formatXLM(sub.amountXLM)} monthly · {sub.status}
                  </p>
                  <p className="text-xs text-[#8aaa8a] font-body mt-1">
                    Next due: {new Date(sub.nextDueDate).toLocaleDateString()}
                  </p>
                  {sub.history.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {sub.history.slice(0, 5).map((entry) => (
                        <p key={entry.paidAt} className="text-xs text-[#5a7a5a] font-body">
                          Paid {formatXLM(entry.amountXLM)} · {timeAgo(entry.paidAt)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[#5a7a5a] font-body">No paid months yet.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
