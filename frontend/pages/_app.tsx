import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import Head from "next/head";
import Navbar from "@/components/Navbar";
import { ThemeTiedToaster } from "@/components/ThemeTiedToaster";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { PriceProvider } from "@/lib/priceContext";
import { connectWallet, getConnectedPublicKey } from "@/lib/wallet";
import "@/styles/globals.css";

// ThemeTiedToaster keeps the sonner toast palette in sync with the
// resolved effective theme.
export default function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    getConnectedPublicKey().then((pk) => {
      if (pk) setPublicKey(pk);
    });
  }, []);

  const handleConnect = async () => {
    const { publicKey: pk } = await connectWallet();
    if (pk) setPublicKey(pk);
  };

  return (
    <ThemeProvider>
      <I18nProvider>
        <PriceProvider>
          <Head>
            <title>Stellar GreenPay</title>
            <meta
              name="description"
              content="Donate to climate projects using Stellar USDC and XLM. 100% goes directly, on-chain and transparent."
            />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
          </Head>
          <Navbar
            publicKey={publicKey}
            onConnect={handleConnect}
            onDisconnect={() => setPublicKey(null)}
          />
          <main>
            <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
          </main>
          <ThemeTiedToaster />
        </PriceProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
