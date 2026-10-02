/**
 * pages/bridge.tsx
 *
 * Bridge page for USDC from Ethereum/Polygon to Stellar using Circle CCTP.
 *
 * The page deliberately leads with an explanation of what bridging does in the
 * context of GreenPay: donors usually hold USDC on an EVM chain, but GreenPay
 * donations settle on Stellar, so the USDC has to cross chains first. It also
 * states plainly what this flow is *not* (a fiat on/off-ramp) so nobody
 * mistakes it for a bank-card cash-in service.
 *
 * GreenPay never takes custody: the only on-chain leg happens in Circle's own
 * interface, opened in a new tab with the destination pre-filled.
 */
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { getAddress as getPublicKey } from "@stellar/freighter-api";
import { shortenAddress } from "@/utils/format";
import { fetchProjects, recordDonation } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ClimateProject } from "@/utils/types";

const CIRCLE_BRIDGE_URL = "https://bridge.circle.com";
const BRIDGE_DOCS_URL =
  "https://github.com/Emmy123222/Stellar-GreenPay/blob/main/docs/bridge.md";
const BRIDGE_HISTORY_KEY = "bridge_history";

// Canonical USDC contract addresses, used for a read-only balance check.
const USDC_CONTRACTS = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  polygon: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
} as const;

// USDC uses 6 decimals on every chain Circle supports.
const USDC_DECIMALS = 1e6;

type SourceChain = keyof typeof USDC_CONTRACTS;

interface BridgeHistoryEntry {
  id: number;
  sourceChain: string;
  destinationChain: string;
  stellarAddress: string;
  amount: string;
  timestamp: string;
  status: "initiated" | "completed";
  type?: "donation";
  projectId?: string;
}

/** Decode a `balanceOf` return value (uint256 hex) into a fixed-point string. */
function parseUSDCBalance(hex: string): string {
  const raw = BigInt(hex);
  const whole = raw / BigInt(USDC_DECIMALS);
  const fraction = (raw % BigInt(USDC_DECIMALS)).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${fraction}`;
}

export default function BridgePage() {
  const { t } = useI18n();
  const [sourceChain, setSourceChain] = useState<SourceChain>("ethereum");
  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);
  const [bridgeHistory, setBridgeHistory] = useState<BridgeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [bridgeAmount, setBridgeAmount] = useState<string>("");
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);

  const loadProjects = async () => {
    try {
      const data = await fetchProjects({ status: "active", limit: 50 });
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
    }
  };

  const loadStellarAddress = async () => {
    try {
      const pk: unknown = await getPublicKey();
      const address = typeof pk === "string" ? pk : (pk as { address?: string } | null)?.address ?? null;
      setStellarAddress(address);
      if (address) setNotice(null);
    } catch (err) {
      console.log("Wallet not connected");
    }
  };

  const loadBridgeHistory = () => {
    try {
      const stored = window.localStorage.getItem(BRIDGE_HISTORY_KEY);
      if (stored) setBridgeHistory(JSON.parse(stored) as BridgeHistoryEntry[]);
    } catch (err) {
      console.error("Failed to read bridge history:", err);
    }
  };

  useEffect(() => {
    // Deferred via a microtask (rather than called synchronously) so this
    // effect doesn't itself perform a synchronous setState — each loader
    // manages its own state updates once its data is ready.
    queueMicrotask(() => {
      loadStellarAddress();
      loadBridgeHistory();
      loadProjects();
    });
  }, []);

  const persistHistory = (entries: BridgeHistoryEntry[]) => {
    setBridgeHistory(entries);
    window.localStorage.setItem(BRIDGE_HISTORY_KEY, JSON.stringify(entries));
  };

  const connectMetaMask = async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setNotice({ kind: "error", text: t("bridge.installMetaMask") });
      return;
    }

    try {
      setLoading(true);
      setNotice(null);
      const accounts: string[] = await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        // Read-only USDC balanceOf call — no approval, no spend.
        const balance = await (window as any).ethereum.request({
          method: "eth_call",
          params: [
            {
              to: USDC_CONTRACTS[sourceChain],
              data: `0x70a08231${accounts[0].slice(2).padStart(64, "0")}`,
            },
            "latest",
          ],
        });

        setEthBalance(parseUSDCBalance(balance));
      }
    } catch (error) {
      console.error("Error connecting MetaMask:", error);
      setNotice({ kind: "error", text: t("bridge.connectFailed") });
    } finally {
      setLoading(false);
    }
  };

  const recordBridgeDonation = async () => {
    if (!selectedProject || !bridgeAmount || !stellarAddress) return;

    setRecording(true);
    setRecordError(null);
    setNotice(null);

    try {
      const amount = parseFloat(bridgeAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Invalid amount");
      }

      await recordDonation({
        projectId: selectedProject,
        donorAddress: stellarAddress,
        amount: amount.toFixed(2),
        currency: "USDC",
        message: "Donated via Circle CCTP bridge",
        transactionHash: `bridge-${Date.now()}`,
      });

      persistHistory([
        {
          id: Date.now(),
          sourceChain,
          destinationChain: "stellar",
          stellarAddress,
          amount: bridgeAmount,
          projectId: selectedProject,
          timestamp: new Date().toISOString(),
          status: "completed",
          type: "donation",
        },
        ...bridgeHistory,
      ]);

      setBridgeAmount("");
      setSelectedProject("");
      setNotice({ kind: "success", text: t("bridge.recordSuccess") });
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : t("bridge.recordError"));
    } finally {
      setRecording(false);
    }
  };

  const openCircleBridge = () => {
    if (!stellarAddress) {
      setNotice({ kind: "error", text: t("bridge.connectStellarFirst") });
      return;
    }

    // Pre-fill Circle's bridge with the destination and network selection.
    const bridgeUrl =
      `${CIRCLE_BRIDGE_URL}?destination=${encodeURIComponent(stellarAddress)}` +
      `&sourceChain=${sourceChain}&destinationChain=stellar&token=USDC`;
    window.open(bridgeUrl, "_blank", "noopener,noreferrer");

    persistHistory([
      {
        id: Date.now(),
        sourceChain,
        destinationChain: "stellar",
        stellarAddress,
        amount: ethBalance || "0",
        timestamp: new Date().toISOString(),
        status: "initiated",
      },
      ...bridgeHistory,
    ]);

    setNotice({ kind: "info", text: t("bridge.step4Desc") });
  };

  const steps = [
    { number: 1, title: t("bridge.step1Title"), description: t("bridge.step1Desc") },
    { number: 2, title: t("bridge.step2Title"), description: t("bridge.step2Desc") },
    { number: 3, title: t("bridge.step3Title"), description: t("bridge.step3Desc") },
    { number: 4, title: t("bridge.step4Title"), description: t("bridge.step4Desc") },
  ];

  const doesList = [t("bridge.doesList1"), t("bridge.doesList2"), t("bridge.doesList3")];
  const doesNotList = [t("bridge.doesNotList1"), t("bridge.doesNotList2"), t("bridge.doesNotList3")];

  return (
    <>
      <Head>
        <title>Bridge USDC | Stellar GreenPay</title>
        <meta name="description" content="Bridge USDC from Ethereum or Polygon to Stellar using Circle CCTP, then donate it to a verified climate project." />
      </Head>

      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-forest-900 dark:text-[#e6f5e9] mb-2">
              {t("bridge.pageTitle")}
            </h1>
            <p className="text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
              {t("bridge.pageIntro")}
            </p>
          </div>

          {notice && (
            <div
              role="status"
              aria-live="polite"
              className={`mb-6 p-3 rounded-xl border text-sm ${
                notice.kind === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700/40 dark:text-emerald-300"
                  : notice.kind === "error"
                    ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-900/20 dark:border-red-700/40 dark:text-red-300"
                    : "bg-forest-50 border-forest-200 text-forest-700 dark:bg-[#15291a] dark:border-forest-700/40 dark:text-[#b2d5b5]"
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* What this bridge does for GreenPay */}
          <section className="card mb-6" aria-labelledby="bridge-what-is">
            <h2 id="bridge-what-is" className="label">{t("bridge.whatIsTitle")}</h2>
            <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body leading-relaxed mb-4">
              {t("bridge.whatIsBody")}
            </p>
            <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body leading-relaxed mb-6">
              {t("bridge.howIsBody")}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-forest-50 dark:bg-[#15291a]">
                <h3 className="font-display font-semibold text-forest-900 dark:text-[#e6f5e9] text-sm mb-2">
                  {t("bridge.doesTitle")}
                </h3>
                <ul className="space-y-2">
                  {doesList.map((item) => (
                    <li key={item} className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] flex gap-2">
                      <span aria-hidden="true">✅</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-xl bg-[#f6f6f6] dark:bg-[#0e1f13]">
                <h3 className="font-display font-semibold text-forest-900 dark:text-[#e6f5e9] text-sm mb-2">
                  {t("bridge.doesNotTitle")}
                </h3>
                <ul className="space-y-2">
                  {doesNotList.map((item) => (
                    <li key={item} className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] flex gap-2">
                      <span aria-hidden="true">🚫</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="mt-4 text-xs text-[#5a7a5a] dark:text-[#8aaa8a] leading-relaxed">
              {t("bridge.fiatNote")}
            </p>
          </section>

          {/* Chain Selection */}
          <div className="card mb-6">
            <h2 className="label mb-4">{t("bridge.networksTitle")}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="bridge-source-chain" className="text-sm font-semibold text-forest-900 dark:text-[#e6f5e9] mb-2 block">
                  {t("bridge.sourceLabel")}
                </label>
                <select
                  id="bridge-source-chain"
                  value={sourceChain}
                  onChange={(e) => setSourceChain(e.target.value as SourceChain)}
                  className="input-field"
                >
                  <option value="ethereum">{t("bridge.sourceEthereum")}</option>
                  <option value="polygon">{t("bridge.sourcePolygon")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="bridge-dest-chain" className="text-sm font-semibold text-forest-900 dark:text-[#e6f5e9] mb-2 block">
                  {t("bridge.destLabel")}
                </label>
                <select id="bridge-dest-chain" className="input-field" value="stellar" disabled>
                  <option value="stellar">{t("bridge.destStellar")}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Wallet Connections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-forest-900 dark:text-[#e6f5e9]">
                  {t("bridge.ethWalletTitle")}
                </h3>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
                  {sourceChain === "ethereum" ? "ETH" : "MATIC"}
                </span>
              </div>
              {ethBalance !== null ? (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                    <p className="text-xs text-blue-600 dark:text-blue-300 font-semibold mb-1">
                      {t("bridge.usdcBalance")}
                    </p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      ${ethBalance} USDC
                    </p>
                  </div>
                  <button
                    onClick={connectMetaMask}
                    className="w-full py-2 px-4 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-xl font-semibold text-sm hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    {t("bridge.refreshBalance")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectMetaMask}
                  disabled={loading}
                  className="w-full py-3 px-4 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t("bridge.connecting") : t("bridge.connectMetaMask")}
                </button>
              )}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-forest-900 dark:text-[#e6f5e9]">
                  {t("bridge.stellarWalletTitle")}
                </h3>
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full font-semibold">
                  XLM
                </span>
              </div>
              {stellarAddress ? (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                    <p className="text-xs text-emerald-600 dark:text-emerald-300 font-semibold mb-1">
                      {t("bridge.destinationLabel")}
                    </p>
                    <p className="text-sm font-mono text-emerald-900 dark:text-emerald-200 break-all">
                      {shortenAddress(stellarAddress, 8)}
                    </p>
                  </div>
                  <button
                    onClick={loadStellarAddress}
                    className="w-full py-2 px-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-xl font-semibold text-sm hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                  >
                    {t("bridge.refresh")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={loadStellarAddress}
                  className="w-full py-3 px-4 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors"
                >
                  {t("bridge.connectFreighter")}
                </button>
              )}
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="card mb-6">
            <h2 className="label mb-4">{t("bridge.howToTitle")}</h2>
            <ol className="space-y-4">
              {steps.map((s) => (
                <li
                  key={s.number}
                  className="flex gap-4 p-4 rounded-xl border-2 border-forest-100 dark:border-forest-800 bg-white dark:bg-[#0e1f13]"
                >
                  <span
                    aria-hidden="true"
                    className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-sm bg-forest-100 dark:bg-[#1c3928] text-forest-600 dark:text-[#b2d5b5]"
                  >
                    {s.number}
                  </span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-forest-900 dark:text-[#e6f5e9] mb-1">{s.title}</h3>
                    <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a]">{s.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Bridge Button */}
          <div className="card mb-6">
            <button
              onClick={openCircleBridge}
              disabled={!stellarAddress}
              className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-forest-500 text-white rounded-xl font-bold text-lg hover:from-blue-600 hover:to-forest-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {t("bridge.openBridge")}
            </button>
            {!stellarAddress && (
              <p className="text-center text-xs text-amber-600 dark:text-amber-400 mt-2">
                {t("bridge.connectStellarFirst")}
              </p>
            )}
          </div>

          {/* Record Bridge Donation */}
          {stellarAddress && projects.length > 0 && (
            <div className="card mb-6">
              <h2 className="label mb-4">{t("bridge.recordTitle")}</h2>
              <p className="text-sm text-[#5a7a5a] dark:text-[#8aaa8a] font-body mb-4">
                {t("bridge.recordDesc")}
              </p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="bridge-project" className="label">{t("bridge.selectProject")}</label>
                  <select
                    id="bridge-project"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="input-field"
                  >
                    <option value="">{t("bridge.chooseProject")}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.category}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bridge-amount" className="label">{t("bridge.amountLabel")}</label>
                  <input
                    id="bridge-amount"
                    type="number"
                    value={bridgeAmount}
                    onChange={(e) => setBridgeAmount(e.target.value)}
                    placeholder={t("bridge.amountPlaceholder")}
                    min="1"
                    step="0.01"
                    className="input-field"
                  />
                </div>

                {recordError && (
                  <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-xl text-red-600 dark:text-red-300 text-sm">
                    {recordError}
                  </div>
                )}

                <button
                  onClick={recordBridgeDonation}
                  disabled={!selectedProject || !bridgeAmount || recording}
                  className="w-full py-3 px-4 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {recording ? t("bridge.recording") : t("bridge.recordBtn")}
                </button>
              </div>
            </div>
          )}

          {/* Bridge History */}
          {bridgeHistory.length > 0 && (
            <div className="card mb-6">
              <h2 className="label mb-4">{t("bridge.historyTitle")}</h2>
              <div className="space-y-3">
                {bridgeHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-4 p-3 bg-forest-50 dark:bg-[#15291a] rounded-xl"
                  >
                    <div>
                      <p className="text-sm font-semibold text-forest-900 dark:text-[#e6f5e9]">
                        {t("bridge.historyRoute").replace("{source}", entry.sourceChain)}
                      </p>
                      <p className="text-xs text-[#5a7a5a] dark:text-[#8aaa8a]">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-forest-700 dark:text-[#b2d5b5]">
                        ${entry.amount} USDC
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.status === "completed"
                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {entry.status === "completed" ? t("bridge.statusCompleted") : t("bridge.statusInitiated")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-xl">
            <h3 className="font-display font-semibold text-blue-900 dark:text-blue-100 mb-2">
              {t("bridge.aboutCctpTitle")}
            </h3>
            <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
              {t("bridge.aboutCctpBody")}{" "}
              <a
                href="https://developers.circle.com/stablecoins/cctp-getting-started"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
              >
                {t("bridge.circleDocs")}
              </a>
              .
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-200 mt-3">
              <a href={BRIDGE_DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                {t("bridge.docsLink")}
              </a>
            </p>
          </div>

          <div className="mt-6 text-center">
            <Link href="/projects" className="btn-ghost text-sm">
              {t("bridge.backToProjects")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
