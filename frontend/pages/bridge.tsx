/**
 * pages/bridge.tsx
 * Bridge page for USDC from Ethereum to Stellar using Circle CCTP
 */
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { getPublicKey } from "@stellar/freighter-api";
import { shortenAddress } from "@/utils/format";

const CIRCLE_BRIDGE_URL = "https://bridge.circle.com";

export default function BridgePage() {
  const [sourceChain, setSourceChain] = useState<"ethereum" | "polygon">("ethereum");
  const [destinationChain, setDestinationChain] = useState<"stellar">("stellar");
  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);
  const [bridgeHistory, setBridgeHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    loadStellarAddress();
    loadBridgeHistory();
  }, []);

  const loadStellarAddress = async () => {
    try {
      const pk = await getPublicKey();
      setStellarAddress(pk);
    } catch (err) {
      console.log("Wallet not connected");
    }
  };

  const loadBridgeHistory = () => {
    // Load from localStorage
    const history = localStorage.getItem("bridge_history");
    if (history) {
      setBridgeHistory(JSON.parse(history));
    }
  };

  const connectMetaMask = async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      alert("Please install MetaMask to use Ethereum features");
      return;
    }

    try {
      setLoading(true);
      const accounts = await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        // Get USDC balance (read-only)
        const usdcContractAddress = sourceChain === "ethereum"
          ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // Ethereum USDC
          : "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // Polygon USDC

        const balance = await (window as any).ethereum.request({
          method: "eth_call",
          params: [
            {
              to: usdcContractAddress,
              data: `0x70a08231000000000000000000000000${accounts[0].slice(2).padStart(64, "0")}`,
            },
            "latest",
          ],
        });

        // Convert hex to decimal (USDC has 6 decimals)
        const balanceWei = parseInt(balance, 16);
        const balanceUSDC = (balanceWei / 1e6).toFixed(2);
        setEthBalance(balanceUSDC);
      }
    } catch (error) {
      console.error("Error connecting MetaMask:", error);
      alert("Failed to connect to MetaMask");
    } finally {
      setLoading(false);
    }
  };

  const openCircleBridge = () => {
    if (!stellarAddress) {
      alert("Please connect your Stellar wallet first");
      return;
    }

    // Pre-fill Circle bridge with destination address
    const bridgeUrl = `${CIRCLE_BRIDGE_URL}?destination=${encodeURIComponent(stellarAddress)}&sourceChain=${sourceChain}&destinationChain=stellar&token=USDC`;
    window.open(bridgeUrl, "_blank");

    // Record bridge attempt in history
    const newEntry = {
      id: Date.now(),
      sourceChain,
      destinationChain,
      stellarAddress,
      amount: ethBalance || "0",
      timestamp: new Date().toISOString(),
      status: "initiated",
    };

    const updatedHistory = [newEntry, ...bridgeHistory];
    setBridgeHistory(updatedHistory);
    localStorage.setItem("bridge_history", JSON.stringify(updatedHistory));
  };

  const steps = [
    {
      number: 1,
      title: "Connect Ethereum Wallet",
      description: "Connect MetaMask to view your Ethereum USDC balance",
    },
    {
      number: 2,
      title: "Connect Stellar Wallet",
      description: "Connect Freighter to set your Stellar destination address",
    },
    {
      number: 3,
      title: "Open Circle Bridge",
      description: "Click the button to open Circle's CCTP bridge with pre-filled parameters",
    },
    {
      number: 4,
      title: "Complete Transfer",
      description: "Follow Circle's instructions to complete the USDC transfer",
    },
  ];

  return (
    <>
      <Head>
        <title>Bridge USDC | Stellar GreenPay</title>
        <meta name="description" content="Bridge USDC from Ethereum to Stellar using Circle CCTP" />
      </Head>

      <div className="min-h-screen bg-leaf">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-forest-900 mb-2">
              Bridge USDC to Stellar
            </h1>
            <p className="text-[#5a7a5a] font-body">
              Transfer your Ethereum-based USDC to Stellar using Circle's Cross-Chain Transfer Protocol (CCTP)
            </p>
          </div>

          {/* Chain Selection */}
          <div className="card mb-6">
            <h2 className="label mb-4">Select Networks</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-forest-900 mb-2 block">Source (Ethereum)</label>
                <select
                  value={sourceChain}
                  onChange={(e) => setSourceChain(e.target.value as "ethereum" | "polygon")}
                  className="w-full p-3 border border-forest-200 rounded-xl bg-white"
                >
                  <option value="ethereum">Ethereum Mainnet</option>
                  <option value="polygon">Polygon</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-forest-900 mb-2 block">Destination (Stellar)</label>
                <select
                  value={destinationChain}
                  onChange={(e) => setDestinationChain(e.target.value as "stellar")}
                  className="w-full p-3 border border-forest-200 rounded-xl bg-white"
                  disabled
                >
                  <option value="stellar">Stellar</option>
                </select>
              </div>
            </div>
          </div>

          {/* Wallet Connections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Ethereum Wallet */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-forest-900">Ethereum Wallet</h3>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
                  {sourceChain === "ethereum" ? "ETH" : "MATIC"}
                </span>
              </div>
              {ethBalance !== null ? (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 rounded-xl">
                    <p className="text-xs text-blue-600 font-semibold mb-1">USDC Balance</p>
                    <p className="text-2xl font-bold text-blue-900">${ethBalance} USDC</p>
                  </div>
                  <button
                    onClick={connectMetaMask}
                    className="w-full py-2 px-4 bg-blue-100 text-blue-700 rounded-xl font-semibold text-sm hover:bg-blue-200 transition-colors"
                  >
                    Refresh Balance
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectMetaMask}
                  disabled={loading}
                  className="w-full py-3 px-4 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  {loading ? "Connecting..." : "Connect MetaMask"}
                </button>
              )}
            </div>

            {/* Stellar Wallet */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-forest-900">Stellar Wallet</h3>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-semibold">
                  XLM
                </span>
              </div>
              {stellarAddress ? (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-50 rounded-xl">
                    <p className="text-xs text-emerald-600 font-semibold mb-1">Destination Address</p>
                    <p className="text-sm font-mono text-emerald-900 break-all">
                      {shortenAddress(stellarAddress, 8)}
                    </p>
                  </div>
                  <button
                    onClick={loadStellarAddress}
                    className="w-full py-2 px-4 bg-emerald-100 text-emerald-700 rounded-xl font-semibold text-sm hover:bg-emerald-200 transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <button
                  onClick={loadStellarAddress}
                  className="w-full py-3 px-4 bg-emerald-500 text-white rounded-xl font-semibold hover:bg-emerald-600 transition-colors"
                >
                  Connect Freighter
                </button>
              )}
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="card mb-6">
            <h2 className="label mb-4">How to Bridge</h2>
            <div className="space-y-4">
              {steps.map((s) => (
                <div
                  key={s.number}
                  className={`flex gap-4 p-4 rounded-xl border-2 transition-all ${
                    step === s.number
                      ? "border-forest-500 bg-forest-50"
                      : "border-forest-100 bg-white"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      step === s.number
                        ? "bg-forest-500 text-white"
                        : "bg-forest-100 text-forest-600"
                    }`}
                  >
                    {s.number}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-forest-900 mb-1">{s.title}</h3>
                    <p className="text-sm text-[#5a7a5a]">{s.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bridge Button */}
          <div className="card mb-6">
            <button
              onClick={openCircleBridge}
              disabled={!stellarAddress}
              className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-emerald-500 text-white rounded-xl font-bold text-lg hover:from-blue-600 hover:to-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              🌉 Open Circle Bridge
            </button>
            {!stellarAddress && (
              <p className="text-center text-xs text-amber-600 mt-2">
                Connect your Stellar wallet first
              </p>
            )}
          </div>

          {/* Bridge History */}
          {bridgeHistory.length > 0 && (
            <div className="card">
              <h2 className="label mb-4">Bridge History</h2>
              <div className="space-y-3">
                {bridgeHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 bg-forest-50 rounded-xl"
                  >
                    <div>
                      <p className="text-sm font-semibold text-forest-900">
                        {entry.sourceChain} → Stellar
                      </p>
                      <p className="text-xs text-[#5a7a5a]">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-forest-700">
                        ${entry.amount} USDC
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="font-display font-semibold text-blue-900 mb-2">ℹ️ About Circle CCTP</h3>
            <p className="text-sm text-blue-800 leading-relaxed">
              Circle's Cross-Chain Transfer Protocol (CCTP) is a permissionless on-chain messaging protocol
              that allows USDC to move between blockchains without wrapping or liquidity pools. Your USDC
              is burned on the source chain and minted on the destination chain, maintaining a 1:1 peg.
              Learn more at{" "}
              <a
                href="https://developers.circle.com/stablecoins/cctp-getting-started"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
              >
                Circle's documentation
              </a>
              .
            </p>
          </div>

          <div className="mt-6 text-center">
            <Link href="/projects" className="btn-ghost text-sm">
              ← Back to Projects
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
