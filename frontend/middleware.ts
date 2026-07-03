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

function buildCsp(nonce: string, isWidget: boolean): string {
  // API origin: 'self' covers same-origin deploys; localhost:4000 covers local dev.
  const connectSrc = [
    "'self'",
    STELLAR_CONNECT,
    'https://api.coingecko.com',
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
    `img-src 'self' data: blob: ${LEAFLET_TILE_SOURCES}`,
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
