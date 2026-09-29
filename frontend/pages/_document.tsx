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
    // Pre-hydration FOUC prevention. Two inline scripts run before React
    // mounts and read localStorage directly:
    //  - the first sets `<html lang>` to the stored locale (or the
    //    browser's language), mirroring `resolveInitialLocale()` /
    //    `applyLocaleToDocument()` in `lib/i18n.tsx`, including the
    //    migration off the legacy `"locale"` key;
    //  - the second applies (or removes) the `.dark` class, mirroring
    //    `applyThemeToDocument` in `lib/theme.tsx`.
    // `lang="en"` on <Html> stays as the no-JS / SSR fallback value.
    return (
      <Html lang="en">
        <Head nonce={nonce}>
          <title>Stellar GreenPay</title>
          {/* The inline body scripts below are statically stringified —
              they read `localStorage` directly rather than DOM meta tags,
              so no `<meta name="csp-nonce">` echo is needed here. Each
              script also carries `nonce={nonce}` so middleware-stamped
              CSPs will accept it. */}
        </Head>
        <body>
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var k="greenpay:locale";var legacy="locale";var supported=["en","es","fr"];var v=null;try{v=window.localStorage.getItem(k);if(supported.indexOf(v)<0){var l=window.localStorage.getItem(legacy);if(supported.indexOf(l)>=0){v=l;window.localStorage.setItem(k,l);window.localStorage.removeItem(legacy)}else{v=null}}}catch(e){v=null}if(supported.indexOf(v)<0){var c=(window.navigator.languages||[]).concat(window.navigator.language);v="en";for(var i=0;i<c.length;i++){var b=String(c[i]||"").slice(0,2).toLowerCase();if(supported.indexOf(b)>=0){v=b;break}}}document.documentElement.lang=v}catch(e){}})();`,
            }}
          />
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
