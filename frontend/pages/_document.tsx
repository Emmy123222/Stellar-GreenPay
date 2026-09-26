import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from "next/document";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

interface Props extends DocumentInitialProps {
  nonce?: string;
}

// Class-based Document is required to read per-request headers (the nonce
// injected by middleware.ts) and forward it to <Head> and <NextScript> so
// every script tag in the HTML carries the matching CSP nonce attribute.
// Having getInitialProps here also opts all pages out of Automatic Static
// Optimisation, ensuring _document always runs server-side per request.
class MyDocument extends Document<Props> {
  static async getInitialProps(ctx: DocumentContext): Promise<Props> {
    const initialProps = await Document.getInitialProps(ctx);
    const raw = ctx.req?.headers?.["x-nonce"];
    const nonce = typeof raw === "string" ? raw : undefined;
    return { ...initialProps, nonce };
  }

  render() {
    const { nonce } = this.props;
    // Pre-hydration FOUC prevention. THEME_INIT_SCRIPT reads the
    // `greenpay:theme` value from localStorage (falling back to
    // prefers-color-scheme) and applies (or removes) the `.dark` class on
    // <html> BEFORE React mounts, so the first paint matches the user's
    // saved palette. It lives in `lib/theme.tsx` next to the provider so
    // both always agree on the storage key.
    return (
      <Html lang="en">
        <Head nonce={nonce}>
          <title>Stellar GreenPay</title>
          {/* The inline body script below is statically stringified — it
              reads `localStorage` directly rather than DOM meta tags, so
              no `<meta name="csp-nonce">` echo is needed here. The script
              also carries `nonce={nonce}` so middleware-stamped CSPs will
              accept it. */}
        </Head>
        <body>
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: THEME_INIT_SCRIPT,
            }}
          />
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
