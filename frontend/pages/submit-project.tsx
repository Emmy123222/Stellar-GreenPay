import { useState } from "react";
import { useRouter } from "next/router";
import { submitProject } from "@/lib/api";
import { PROJECT_CATEGORIES } from "@/utils/format";

type Step = "org" | "project" | "wallet" | "methodology" | "done";

interface FormData {
  // Org info
  orgName: string;
  orgWebsite: string;
  orgCountry: string;
  contactEmail: string;
  // Project details
  projectName: string;
  category: string;
  description: string;
  location: string;
  goalXLM: string;
  // Wallet
  walletAddress: string;
  // CO₂ methodology
  co2MethodologyName: string;
  co2VerificationBody: string;
  co2AnnualTonnes: string;
  co2DocumentUrl: string;
}

const STEPS: Step[] = ["org", "project", "wallet", "methodology", "done"];
const STEP_LABELS: Record<Step, string> = {
  org: "Organization",
  project: "Project Details",
  wallet: "Wallet",
  methodology: "CO₂ Methodology",
  done: "Submitted",
};

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export default function SubmitProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("org");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [reviewTimeline, setReviewTimeline] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [form, setForm] = useState<FormData>({
    orgName: "",
    orgWebsite: "",
    orgCountry: "",
    contactEmail: "",
    projectName: "",
    category: PROJECT_CATEGORIES[0],
    description: "",
    location: "",
    goalXLM: "",
    walletAddress: "",
    co2MethodologyName: "",
    co2VerificationBody: "",
    co2AnnualTonnes: "",
    co2DocumentUrl: "",
  });

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  function validateStep(): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {};

    if (step === "org") {
      if (!form.orgName.trim()) errs.orgName = "Required";
      if (!form.contactEmail.trim()) errs.contactEmail = "Required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
        errs.contactEmail = "Invalid email";
    }

    if (step === "project") {
      if (!form.projectName.trim()) errs.projectName = "Required";
      if (!form.description.trim()) errs.description = "Required";
      if (!form.location.trim()) errs.location = "Required";
      if (!form.goalXLM || Number(form.goalXLM) <= 0) errs.goalXLM = "Must be greater than 0";
    }

    if (step === "wallet") {
      if (!STELLAR_ADDRESS_RE.test(form.walletAddress.trim()))
        errs.walletAddress = "Must be a valid Stellar address (starts with G, 56 chars)";
    }

    if (step === "methodology") {
      if (!form.co2MethodologyName.trim()) errs.co2MethodologyName = "Required";
      if (!form.co2AnnualTonnes || Number(form.co2AnnualTonnes) <= 0)
        errs.co2AnnualTonnes = "Must be greater than 0";
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function nextStep() {
    if (!validateStep()) return;
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 2) setStep(STEPS[idx + 1]);
  }

  function prevStep() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function handleSubmit() {
    if (!validateStep()) return;
    setSubmitting(true);
    setServerError("");
    try {
      const payload = {
        name: form.projectName,
        category: form.category,
        description: form.description,
        location: form.location,
        goalXLM: form.goalXLM,
        walletAddress: form.walletAddress.trim(),
        organization: {
          name: form.orgName,
          website: form.orgWebsite,
          country: form.orgCountry,
          contactEmail: form.contactEmail,
        },
        co2Methodology: {
          name: form.co2MethodologyName,
          verificationBody: form.co2VerificationBody,
          annualTonnesCO2: form.co2AnnualTonnes,
          documentUrl: form.co2DocumentUrl,
        },
      };
      const data = await submitProject(payload);
      setReviewTimeline(data?.reviewTimeline ?? "5–10 business days");
      setStep("done");
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.error ??
        "Submission failed. Please try again.";
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const progressSteps = STEPS.slice(0, -1);

  if (step === "done") {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="text-6xl mb-6">🌿</div>
        <h1 className="font-display text-3xl font-bold text-forest-900 mb-3">
          Project Submitted!
        </h1>
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-2">
          Thank you for submitting <strong>{form.projectName}</strong>.
        </p>
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-8">
          Our team will review your submission within{" "}
          <strong>{reviewTimeline || "5–10 business days"}</strong>. We&apos;ll contact you at{" "}
          <strong>{form.contactEmail}</strong> with the outcome.
        </p>
        <button className="btn-primary" onClick={() => router.push("/projects")}>
          Browse Projects
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 animate-fade-in">
      <h1 className="font-display text-3xl font-bold text-forest-900 mb-2">
        Submit Your Project
      </h1>
      <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-8 text-sm">
        Organizations can submit climate projects for verification and funding on Stellar GreenPay.
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10">
        {progressSteps.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                i < stepIndex
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : i === stepIndex
                  ? "border-emerald-600 text-emerald-700 bg-white"
                  : "border-forest-200 text-[#8aaa8a] dark:text-forest-300 bg-white"
              }`}
            >
              {i < stepIndex ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs font-body hidden sm:block ${
                i === stepIndex ? "text-forest-900 font-semibold" : "text-[#8aaa8a] dark:text-forest-300"
              }`}
            >
              {STEP_LABELS[s]}
            </span>
            {i < progressSteps.length - 1 && (
              <div className={`flex-1 h-px ${i < stepIndex ? "bg-emerald-400" : "bg-forest-200"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="card p-6 space-y-5">
        {/* Step: org */}
        {step === "org" && (
          <>
            <h2 className="font-display text-xl font-bold text-forest-900">Organization Info</h2>
            <Field label="Organization Name *" error={fieldErrors.orgName}>
              <input className="input-field" value={form.orgName} onChange={set("orgName")} placeholder="Acme Climate Foundation" />
            </Field>
            <Field label="Website" error={fieldErrors.orgWebsite}>
              <input className="input-field" value={form.orgWebsite} onChange={set("orgWebsite")} placeholder="https://acme.org" />
            </Field>
            <Field label="Country" error={fieldErrors.orgCountry}>
              <input className="input-field" value={form.orgCountry} onChange={set("orgCountry")} placeholder="Kenya" />
            </Field>
            <Field label="Contact Email *" error={fieldErrors.contactEmail}>
              <input className="input-field" type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="hello@acme.org" />
            </Field>
          </>
        )}

        {/* Step: project */}
        {step === "project" && (
          <>
            <h2 className="font-display text-xl font-bold text-forest-900">Project Details</h2>
            <Field label="Project Name *" error={fieldErrors.projectName}>
              <input className="input-field" value={form.projectName} onChange={set("projectName")} placeholder="Acme Solar Farm Phase 1" />
            </Field>
            <Field label="Category *" error={fieldErrors.category}>
              <select className="input-field" value={form.category} onChange={set("category")}>
                {PROJECT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Description *" error={fieldErrors.description}>
              <textarea
                className="input-field min-h-[100px] resize-y"
                value={form.description}
                onChange={set("description")}
                placeholder="Describe the project's goals, impact, and methods…"
              />
            </Field>
            <Field label="Location *" error={fieldErrors.location}>
              <input className="input-field" value={form.location} onChange={set("location")} placeholder="Nairobi, Kenya" />
            </Field>
            <Field label="Funding Goal (XLM) *" error={fieldErrors.goalXLM}>
              <input className="input-field" type="number" min="1" step="any" value={form.goalXLM} onChange={set("goalXLM")} placeholder="50000" />
            </Field>
          </>
        )}

        {/* Step: wallet */}
        {step === "wallet" && (
          <>
            <h2 className="font-display text-xl font-bold text-forest-900">Stellar Wallet</h2>
            <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
              Donations will be sent directly to this Stellar address. Make sure you control it.
            </p>
            <Field label="Stellar Wallet Address *" error={fieldErrors.walletAddress}>
              <input
                className="input-field font-mono text-sm"
                value={form.walletAddress}
                onChange={set("walletAddress")}
                placeholder="GABC…"
                spellCheck={false}
              />
            </Field>
            <p className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
              Starts with G and is 56 characters long. Testnet and mainnet addresses are both accepted.
            </p>
          </>
        )}

        {/* Step: methodology */}
        {step === "methodology" && (
          <>
            <h2 className="font-display text-xl font-bold text-forest-900">CO₂ Methodology</h2>
            <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
              Tell us how your project measures and verifies carbon reduction.
            </p>
            <Field label="Methodology Name *" error={fieldErrors.co2MethodologyName}>
              <input className="input-field" value={form.co2MethodologyName} onChange={set("co2MethodologyName")} placeholder="Verra VM0007" />
            </Field>
            <Field label="Verification Body" error={fieldErrors.co2VerificationBody}>
              <input className="input-field" value={form.co2VerificationBody} onChange={set("co2VerificationBody")} placeholder="Gold Standard, Verra, etc." />
            </Field>
            <Field label="Annual CO₂ Reduction (tonnes) *" error={fieldErrors.co2AnnualTonnes}>
              <input className="input-field" type="number" min="1" step="any" value={form.co2AnnualTonnes} onChange={set("co2AnnualTonnes")} placeholder="1200" />
            </Field>
            <Field label="Supporting Document URL" error={fieldErrors.co2DocumentUrl}>
              <input className="input-field" value={form.co2DocumentUrl} onChange={set("co2DocumentUrl")} placeholder="https://…" />
            </Field>

            {serverError && (
              <p className="text-sm text-red-500 font-body">{serverError}</p>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          type="button"
          onClick={prevStep}
          disabled={stepIndex === 0}
          className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Back
        </button>

        {step === "methodology" ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit Project"}
          </button>
        ) : (
          <button type="button" onClick={nextStep} className="btn-primary">
            Next
          </button>
        )}
      </div>
    </div>
  );
}
