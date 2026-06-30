import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from "next/document";

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
    // Pre-hydration FOUC prevention. The inline script reads the
    // `greenpay-theme` value from localStorage and applies (or removes)
    // the `.dark` class on <html> BEFORE React mounts, which keeps the
    // first paint at the user's preferred palette. It mirrors the
    // logic in `lib/theme.tsx`'s `applyThemeToDocument`.
    return (
      <Html lang="en">
        <Head nonce={nonce}>
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
              __html: `(function(){try{var k="greenpay-theme";var m=window.localStorage.getItem(k);var sys=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var d=false;if(m==="dark"){d=true}else if(m==="light"){d=false}else if(sys){d=true}var r=document.documentElement;if(d){r.classList.add("dark");r.style.colorScheme="dark"}else{r.classList.remove("dark");r.style.colorScheme="light"}}catch(e){}})();`,
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
