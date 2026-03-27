/**
 * components/EditProfileForm.tsx
 */
import { useState, useEffect } from "react";
import { fetchProfile, upsertProfile } from "@/lib/api";
import type { DonorProfile } from "@/utils/types";

interface EditProfileFormProps {
  publicKey: string;
}

export default function EditProfileForm({ publicKey }: EditProfileFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [errors, setErrors] = useState<{ displayName?: string }>({});

  useEffect(() => {
    if (publicKey) {
      fetchProfile(publicKey)
        .then((p) => {
          if (p) {
            setDisplayName(p.displayName || "");
            setBio(p.bio || "");
          }
        })
        .catch(console.error);
    }
  }, [publicKey]);

  const validate = () => {
    const newErrors: { displayName?: string } = {};
    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    } else if (!/^[a-zA-Z0-9_ ]+$/.test(displayName)) {
      newErrors.displayName = "Only letters, numbers, underscores, and spaces allowed";
    } else if (displayName.length > 30) {
      newErrors.displayName = "Max 30 characters";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSaving(true);
    setMessage(null);

    try {
      await upsertProfile({
        publicKey,
        displayName: displayName.trim(),
        bio: bio.trim().slice(0, 200),
      });
      setMessage({ type: "success", text: "Profile saved! Your name will now appear on the leaderboard." });
    } catch (err) {
      console.error("Failed to save profile:", err);
      setMessage({ type: "error", text: "Failed to save profile. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card shadow-sm border border-forest-100 p-6 md:p-8 bg-white/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-forest-100 flex items-center justify-center text-xl">👤</div>
        <h2 className="font-display text-xl font-bold text-forest-900">Edit Profile</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="displayName" className="block text-sm font-semibold text-forest-700 mb-1.5 uppercase tracking-wider">
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            className={`w-full px-4 py-2.5 rounded-xl border font-body text-forest-900 focus:outline-none focus:ring-2 transition-all ${
              errors.displayName ? "border-red-300 focus:ring-red-100" : "border-forest-200 focus:ring-forest-100"
            }`}
            placeholder="e.g. Alice_Green"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={30}
          />
          {errors.displayName && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.displayName}</p>}
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-semibold text-forest-700 mb-1.5 uppercase tracking-wider">
            Bio
          </label>
          <textarea
            id="bio"
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-forest-200 font-body text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-100 transition-all resize-none"
            placeholder="Tell us why you support climate projects..."
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
          />
          <p className="mt-1.5 text-right text-[10px] text-[#8aaa8a] uppercase font-bold tracking-widest leading-none">
            {bio.length}/200
          </p>
        </div>

        {message && (
          <div className={`p-4 rounded-xl flex items-center gap-3 animate-fade-in ${
            message.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
          }`}>
            <span className="text-xl">{message.type === "success" ? "✅" : "⚠️"}</span>
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className={`w-full btn-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
            isSaving ? "opacity-70 cursor-not-allowed scale-[0.98]" : "hover:scale-[1.01]"
          }`}
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving Profile...
            </>
          ) : (
            "Save Changes"
          )}
        </button>
      </form>
    </div>
  );
}
