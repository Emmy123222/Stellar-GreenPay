/**
 * components/WalletConnect.tsx
 */
import { useState } from "react";
import { connectWallet, isFreighterInstalled } from "@/lib/wallet";

interface WalletConnectProps {
  onConnect: (pk: string) => void;
}

export default function WalletConnect({ onConnect }: WalletConnectProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    const installed = await isFreighterInstalled();
    if (!installed) {
      window.open("https://freighter.app", "_blank");
      setLoading(false);
      return;
    }
    const { publicKey, error: e } = await connectWallet();
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    if (publicKey) onConnect(publicKey);
  };

  return (
    <div className="card max-w-sm mx-auto text-center animate-slide-up shadow-green">
      <div className="text-4xl mb-4">🌿</div>
      <h3 className="font-display text-xl font-semibold text-forest-900 mb-2">
        Connect Your Wallet
      </h3>
      <p className="text-[#5a7a5a] text-sm mb-5 font-body leading-relaxed">
        Use{" "}
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-forest-600 hover:underline font-semibold"
        >
          Freighter
        </a>{" "}
        to donate XLM directly to climate projects with zero platform fees.
      </p>
      <div className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 flex items-start gap-2 text-left">
        <span>⚠️</span>
        <span>
          Please ensure your Freighter wallet is set to <strong>Testnet</strong>{" "}
          before connecting.
        </span>
      </div>
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-body">
          {error}
        </div>
      )}
      <button
        onClick={handleConnect}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Spinner />
            Connecting...
          </>
        ) : (
          "🔗 Connect Freighter Wallet"
        )}
      </button>
      <p className="mt-3 text-xs text-[#8aaa8a] font-body">
        No wallet?{" "}
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-forest-600 hover:underline"
        >
          Install Freighter →
        </a>
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
