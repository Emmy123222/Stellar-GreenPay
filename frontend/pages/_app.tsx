import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Head from "next/head";
import { Toaster } from "sonner";
import Navbar from "@/components/Navbar";
import { connectWallet, getConnectedPublicKey } from "@/lib/wallet";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    getConnectedPublicKey().then(pk => { if (pk) setPublicKey(pk); });
  }, []);

  const handleConnect = async () => {
    const { publicKey: pk } = await connectWallet();
    if (pk) setPublicKey(pk);
  };

  return (
    <>
      <Head>
        <title>Stellar GreenPay — Climate Donations on Stellar</title>
        <meta name="description" content="Donate XLM directly to verified climate projects. Every transaction tracked on-chain via Soroban smart contracts." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Toaster position="top-right" richColors closeButton />
      <div className="min-h-screen bg-[#f0f7f0]">
        <Navbar publicKey={publicKey} onConnect={handleConnect} onDisconnect={() => setPublicKey(null)} />
        <main>
          <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
        </main>
      </div>
    </>
  );
}
