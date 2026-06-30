import type { AppProps } from "next/app";
import Head from "next/head";
import { ThemeTiedToaster } from "@/components/ThemeTiedToaster";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { PriceProvider } from "@/lib/priceContext";
import "@/styles/globals.css";

// ThemeTiedToaster keeps the sonner toast palette in sync with the
// resolved effective theme.
export default function App({ Component, pageProps }: AppProps) {
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
          <Component {...pageProps} />
          <ThemeTiedToaster />
        </PriceProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
