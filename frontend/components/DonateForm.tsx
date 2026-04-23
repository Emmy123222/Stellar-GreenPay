/**
 * components/DonateForm.tsx
 * Donation form for a climate project.
 */
import { useState, useEffect } from "react";
import { buildDonationTransaction, buildContractDonationTransaction, submitTransaction, explorerUrl, getXLMBalance, getAssetBalance, getDonorStats, hashMessage, CONTRACT_ID } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { recordDonation } from "@/lib/api";
import { formatXLM, formatCO2 } from "@/utils/format";
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
  const [donorBadge, setDonorBadge] = useState<string | null>(null);

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

  // Calculate CO₂ impact for XLM donations
  const co2Impact = currency === "XLM" && amount && !isNaN(amountNum) && project.co2_per_xlm
    ? (amountNum * project.co2_per_xlm) / 1000 // Convert to kg
    : 0;

  // Calculate tree equivalent (rough estimate: 1 tree absorbs ~22kg CO₂ per year)
  const treeEquivalent = co2Impact > 0 ? Math.round(co2Impact / 22) : 0;

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
      const useContract = CONTRACT_ID && currency === "XLM";

      if (useContract) {
        setStep("building");

        // Get native XLM token address (for testnet/mainnet)
        const nativeTokenAddress = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // Native XLM on testnet
        const msgHash = message.trim() ? hashMessage(message.trim()) : 0;

        const tx = await buildContractDonationTransaction({
          contractId: CONTRACT_ID,
          tokenAddress: nativeTokenAddress,
          donor: publicKey,
          projectId: project.id,
          amount: amountNum.toFixed(7),
          msgHash,
        });

        setStep("signing");
        const { signedXDR, error: signErr } = await signTransactionWithWallet(tx.toXDR());
        if (signErr || !signedXDR) throw new Error(signErr || "Signing failed");

        setStep("submitting");
        const result = await submitTransaction(signedXDR);
        setTxHash(result.hash);

        setStep("recording");
        // Query updated donor stats from contract
        const stats = await getDonorStats(publicKey);
        if (stats && stats.badge) {
          const badgeNames: Record<string, string> = {
            Seedling: "🌱 Seedling",
            Tree: "🌳 Tree",
            Forest: "🌲 Forest",
            EarthGuardian: "🌍 Earth Guardian",
          };
          setDonorBadge(badgeNames[stats.badge] || null);
        }

        // Still record in backend for feed/analytics
        await recordDonation({
          projectId: project.id,
          donorAddress: publicKey,
          amount: amountNum.toString(),
          currency: currency,
          message: message.trim() || undefined,
          transactionHash: result.hash,
        });

        setStep("success");
        onSuccess?.();
      } else {
      // Fallback to standard payment
        setStep("building");
        const asset = currency === "USDC"
          ? { code: "USDC", issuer: process.env.NEXT_PUBLIC_USDC_ISSUER }
          : undefined;

        if (currency === "USDC") {
          if (!process.env.NEXT_PUBLIC_USDC_ISSUER) throw new Error("USDC issuer not configured (NEXT_PUBLIC_USDC_ISSUER).");
          if (trustlineMissing) throw new Error("No USDC trustline on your account. Add a trustline to receive/send USDC.");
        }

        const tx = await buildDonationTransaction({
          fromPublicKey: publicKey,
          toPublicKey: project.walletAddress,
          amount: currency === "XLM" ? amountNum.toFixed(7) : amountNum.toFixed(2),
          memo: `GreenPay:${project.id.slice(0, 16)}`,
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
          projectId: project.id,
          donorAddress: publicKey,
          amount: amountNum.toString(),
          currency: currency,
          message: message.trim() || undefined,
          transactionHash: result.hash,
        });

        setStep("success");
        onSuccess?.();
      }
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
          Your donation of <span className="font-semibold text-forest-700">{currency === "XLM" ? formatXLM(amountNum) : `${amountNum.toFixed(2)} ${currency}`}</span> has been sent to <span className="font-semibold">{project.name}</span>.
        </p>
        {donorBadge && (
          <div className="mb-4 p-3 bg-forest-50 border border-forest-200 rounded-xl">
            <p className="text-sm font-semibold text-forest-900 mb-1">🎉 Badge Earned!</p>
            <p className="text-lg font-bold text-forest-700">{donorBadge}</p>
          </div>
        )}
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
          
          {/* CO₂ Impact Calculator */}
          {currency === "XLM" && amount && !isNaN(amountNum) && co2Impact > 0 && (
            <div className="mt-3 p-3 bg-forest-50 border border-forest-200 rounded-xl">
              <p className="text-sm font-medium text-forest-900 mb-1">
                🌱 Your donation will offset approximately <span className="font-bold text-forest-700">{formatCO2(co2Impact)}</span>
              </p>
              {treeEquivalent > 0 && (
                <p className="text-xs text-forest-600 mt-1">
                  That is equivalent to planting about <span className="font-semibold">{treeEquivalent} {treeEquivalent === 1 ? 'tree' : 'trees'}</span>
                </p>
              )}
            </div>
          )}
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
