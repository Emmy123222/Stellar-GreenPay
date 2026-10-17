import { NextResponse, type NextRequest } from 'next/server'

const STELLAR_CONNECT = [
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
  'https://soroban-testnet.stellar.org',
  'https://soroban.stellar.org',
  'https://friendbot.stellar.org',
].join(' ')

// Leaflet tile servers — the {s} subdomain expands to a/b/c at runtime.
// All three tile subdomains must be allow-listed explicitly.
const LEAFLET_TILE_SOURCES = [
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
].join(' ')

// unpkg.com serves the Leaflet CSS loaded dynamically in ProjectMap.tsx.
const UNPKG = 'https://unpkg.com'

// GitHub avatars rendered on the /contributors timeline
const GITHUB_AVATARS = 'https://avatars.githubusercontent.com'

/**
 * Origin of the backend API configured for this deployment.
 *
 * Same-origin deployments are already covered by `'self'`; a deployment that
 * points NEXT_PUBLIC_API_URL at another host (e.g. api.stellar-greenpay.app)
 * needs that origin in connect-src or every fetch is blocked by the enforced CSP.
 */
export function apiOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_API_URL
  if (!raw) return []
  try {
    const { protocol, origin } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:' ? [origin] : []
  } catch {
    return []
  }
}

/**
 * Where browser-side Sentry events are sent.
 *
 * sentry.client.config.js posts straight to the DSN host (no tunnel route is
 * configured), so that host must be in connect-src or the enforced CSP silently
 * drops every client event. Self-hosted DSNs are covered by parsing the DSN;
 * without one, allow Sentry's SaaS ingest domains.
 */
export function sentryOrigins(): string[] {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (dsn) {
    try {
      return [new URL(dsn).origin]
    } catch {
      // Malformed DSN: fall through to the SaaS allowlist.
    }
  }
  return ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io']
}

export function buildCsp(nonce: string, isWidget: boolean): string {
  // API origin: 'self' covers same-origin deploys; localhost:4000 covers local dev.
  const connectSrc = [
    "'self'",
    STELLAR_CONNECT,
    'https://api.coingecko.com',
    ...apiOrigins(),
    ...sentryOrigins(),
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:4000'] : []),
  ].join(' ')

  const directives = [
    "default-src 'self'",
    // nonce tags the Next.js script injection; strict-dynamic propagates trust to bundles
    // it loads; unsafe-inline is a no-op in CSP3 but keeps CSP2 browsers working.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    // unpkg serves the Leaflet CSS stylesheet.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${UNPKG}`,
    "font-src 'self' https://fonts.gstatic.com",
    // OSM tile images are loaded as <img> elements by Leaflet TileLayer.
    // Leaflet marker icons use data: URIs (our inline SVG divIcon).
    // GitHub avatars are loaded on the /contributors timeline.
    `img-src 'self' data: blob: ${LEAFLET_TILE_SOURCES} ${GITHUB_AVATARS}`,
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    isWidget ? "frame-ancestors *" : "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]

  return directives.join('; ')
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const isWidget = request.nextUrl.pathname.startsWith('/widget/')
  const csp = buildCsp(nonce, isWidget)

  const requestHeaders = new Headers(request.headers)
  // x-nonce is read in pages/_document.tsx to stamp <Head> and <NextScript>
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  // Skip static assets — CSP is only meaningful on HTML responses.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|ico|svg|webp)$).*)'],
}
