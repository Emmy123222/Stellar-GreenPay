/**
 * components/DonateForm.tsx
 * Donation form for a climate project.
 */
import { useState, useEffect } from "react";
import { buildDonationTransaction, submitTransaction, explorerUrl, getXLMBalance, getAssetBalance } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { recordDonation } from "@/lib/api";
import { formatXLM } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

interface DonateFormProps {
  project: ClimateProject;
  publicKey: string;
  onSuccess?: () => void;
}

type Step = "idle" | "building" | "signing" | "submitting" | "recording" | "success" | "error";

const PRESETS_XLM = ["10", "25", "50", "100", "250"];
const PRESETS_USDC = ["5", "10", "25", "50", "100"];

export default function DonateForm({ project, publicKey, onSuccess }: DonateFormProps) {
  const [amount, setAmount]   = useState("");
  const [message, setMessage] = useState("");
  const [currency, setCurrency] = useState<"XLM" | "USDC">("XLM");
  const [step, setStep]       = useState<Step>("idle");
  const [error, setError]     = useState<string | null>(null);
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [trustlineMissing, setTrustlineMissing] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    async function loadBalances() {
      if (!publicKey) return;
      try {
        const xlm = await getXLMBalance(publicKey);
        if (!mounted) return;
        setXlmBalance(xlm);
        if (currency === "USDC") {
          const issuer = process.env.NEXT_PUBLIC_USDC_ISSUER;
          if (!issuer) {
            setUsdcBalance(null);
            setTrustlineMissing(true);
            return;
          }
          const usdc = await getAssetBalance(publicKey, "USDC", issuer);
          if (!mounted) return;
          setUsdcBalance(usdc);
          setTrustlineMissing(usdc === null);
        } else {
          setUsdcBalance(null);
          setTrustlineMissing(false);
        }
      } catch (err) {
        // ignore balance fetch errors; leave values as null
      }
    }

    loadBalances();
    return () => { mounted = false; };
  }, [publicKey, currency]);

  const amountNum = parseFloat(amount);
  const isValid   = !isNaN(amountNum) && amountNum >= 1;

    const charCount = message.length;

      const getCounterColor = () => {
        if (charCount >= 96) return "text-red-500";
        if (charCount >= 80) return "text-amber-500";
        return "text-green-600";
      };

  const handleDonate = async () => {
    if (!isValid || step !== "idle") return;
    setError(null);

    try {
      setStep("building");
      const asset = currency === "USDC"
        ? { code: "USDC", issuer: process.env.NEXT_PUBLIC_USDC_ISSUER }
        : undefined;

      if (currency === "USDC") {
        // If usdc issuer is not configured, surface helpful error
        if (!process.env.NEXT_PUBLIC_USDC_ISSUER) throw new Error("USDC issuer not configured (NEXT_PUBLIC_USDC_ISSUER).");
        // If trustline missing, block
        if (trustlineMissing) throw new Error("No USDC trustline on your account. Add a trustline to receive/send USDC.");
      }

      const tx = await buildDonationTransaction({
        fromPublicKey: publicKey,
        toPublicKey:   project.walletAddress,
        amount:        currency === "XLM" ? amountNum.toFixed(7) : amountNum.toFixed(2),
        memo:          `GreenPay:${project.id.slice(0, 16)}`,
        asset,
      });

      setStep("signing");
      const { signedXDR, error: signErr } = await signTransactionWithWallet(tx.toXDR());
      if (signErr || !signedXDR) throw new Error(signErr || "Signing failed");

      setStep("submitting");
      const result = await submitTransaction(signedXDR);
      setTxHash(result.hash);

      setStep("recording");
      await recordDonation({
        projectId:        project.id,
        donorAddress:     publicKey,
        amount:            amountNum.toString(),
        currency:          currency,
        message:          message.trim() || undefined,
        transactionHash:  result.hash,
      });

      setStep("success");
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setStep("error");
      setTimeout(() => setStep("idle"), 3000);
    }
  };

  if (step === "success" && txHash) {
    return (
      <div className="card text-center animate-slide-up">
        <div className="text-4xl mb-3">🌱</div>
        <h3 className="font-display text-xl font-semibold text-forest-900 mb-2">Thank you!</h3>
        <p className="text-[#5a7a5a] text-sm mb-4 font-body">
          Your donation of <span className="font-semibold text-forest-700">{currency === "XLM" ? formatXLM(amountNum) : `$${amountNum.toFixed(2)} ${currency}`}</span> has been sent to <span className="font-semibold">{project.name}</span>.
        </p>
        <a href={explorerUrl(txHash)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-forest-600 hover:text-forest-700 transition-colors font-body">
          View on Stellar Expert ↗
        </a>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <h3 className="font-display text-lg font-semibold text-forest-900 mb-1">Make a Donation</h3>
          <p className="text-[#5a7a5a] text-sm mb-5 font-body">100% goes directly to the project wallet.</p>

      <div className="space-y-4">
        {/* Currency selector */}
        <div>
          <label className="label">Currency</label>
          <div className="flex gap-2">
            <button onClick={() => setCurrency("XLM")}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all font-body ${currency === "XLM" ? "bg-forest-500 text-white" : "bg-white"}`}>
              XLM
            </button>
            <button onClick={() => setCurrency("USDC")}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all font-body ${currency === "USDC" ? "bg-forest-500 text-white" : "bg-white"}`}>
              USDC
            </button>
          </div>
        </div>
        {/* Preset amounts */}
        <div>
          <label className="label">Choose Amount ({currency})</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {(currency === "XLM" ? PRESETS_XLM : PRESETS_USDC).map((p) => (
              <button key={p} onClick={() => setAmount(p)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all font-body ${
                  amount === p
                    ? "bg-forest-500 text-white border-forest-500"
                    : "bg-forest-50 text-forest-700 border-forest-200 hover:border-forest-400"
                }`}>
                {p} {currency}
              </button>
            ))}
          </div>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="Or enter custom amount..." min="1" step="1"
            className="input-field" />
          {amount && !isValid && <p className="mt-1 text-xs text-red-500">Minimum donation is 1 {currency}</p>}
        </div>

        {/* Message */}
        <div>
          <label className="label">Message <span className="normal-case text-[#8aaa8a] font-normal">(optional)</span></label>
          <input type="text" value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Leave a message of support..." maxLength={100}
            className="input-field" />
        </div>

        {/*  Helper text */}
          <p className="text-xs text-muted-foreground mt-1">
            Your message will appear in the public donation feed
          </p>

          {/* Character counter */}
          <p className={`text-xs mt-1 ${getCounterColor()}`}>
            {charCount} / 100 characters
          </p>
        </div>

        {step === "error" && error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-body">{error}</div>
        )}

        {currency === "USDC" && (
          <div className="text-xs text-muted-foreground">
            <p>Balances:</p>
            <p>XLM: <span className="font-medium">{xlmBalance ?? "—"}</span></p>
            <p>USDC: <span className="font-medium">{usdcBalance === null ? "No trustline" : usdcBalance}</span></p>
            {usdcBalance === null && (
              <div className="mt-2 text-sm text-amber-600">
                You don't have a USDC trustline on this account. Add a trustline in your wallet or follow these instructions to accept USDC: <a href="https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets/" target="_blank" rel="noopener noreferrer" className="underline">Add trustline</a>
              </div>
            )}
          </div>
        )}

        <button onClick={handleDonate} disabled={!isValid || step !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2">
          {step === "building"   && <><Spinner />Building transaction...</>}
          {step === "signing"    && <><Spinner />Sign in Freighter...</>}
          {step === "submitting" && <><Spinner />Submitting...</>}
          {step === "recording"  && <><Spinner />Recording on-chain...</>}
          {step === "idle"       && <>🌱 Donate {amount ? (currency === "XLM" ? formatXLM(amountNum) : `$${amountNum.toFixed(2)} ${currency}`) : currency}</>}
          {step === "error"      && "Retry"}
        </button>

        {step === "signing" && (
          <p className="text-center text-xs text-[#5a7a5a] animate-pulse font-body">
            Please confirm in your Freighter wallet...
          </p>
        )}
      </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
