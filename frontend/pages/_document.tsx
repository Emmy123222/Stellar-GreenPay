import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from 'next/document'

interface Props extends DocumentInitialProps {
  nonce?: string
}

// Class-based Document is required to read per-request headers (the nonce
// injected by middleware.ts) and forward it to <Head> and <NextScript> so
// every script tag in the HTML carries the matching CSP nonce attribute.
// Having getInitialProps here also opts all pages out of Automatic Static
// Optimisation, ensuring _document always runs server-side per request.
class MyDocument extends Document<Props> {
  static async getInitialProps(ctx: DocumentContext): Promise<Props> {
    const initialProps = await Document.getInitialProps(ctx)
    const raw = ctx.req?.headers?.['x-nonce']
    const nonce = typeof raw === 'string' ? raw : undefined
    return { ...initialProps, nonce }
  }

  render() {
    const { nonce } = this.props
    return (
      <Html lang="en">
        <Head nonce={nonce} />
        <body>
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  try {
                    var t = localStorage.getItem('theme');
                    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                      document.documentElement.classList.add('dark');
                    }
                  } catch(e) {}
                })();
              `,
            }}
          />
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    )
  }
}

export default MyDocument
