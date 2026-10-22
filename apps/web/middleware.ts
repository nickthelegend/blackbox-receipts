// The dashboard's API routes read and change the local receipt store (tamper, restore, new session,
// prove with the local key). They are for the person at this machine, using this dashboard's own pages:
// - requests whose Host is not a loopback name are refused (the dev and start scripts also bind to
//   127.0.0.1); set BLACKBOX_DASHBOARD_ALLOW_REMOTE=1 only on a network you trust;
// - requests a browser sends on behalf of another site are refused, always. A bodyless POST such as
//   /api/restore is a "simple" request with no CORS preflight, so without this any page open in the same
//   browser (another port on localhost included) could undo a tamper or run a proof. Browsers label those
//   requests with Sec-Fetch-Site; older ones are judged by Origin. Requests with neither (curl, scripts)
//   are not cross-site browser requests and pass.
import { NextResponse, type NextRequest } from 'next/server';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function crossSite(request: NextRequest): string | null {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const from = origin ? ` from ${origin}` : '';
  if (site) return site === 'same-origin' || site === 'none' ? null : `a ${site} request${from}`;
  if (!origin) return null;
  if (origin === 'null') return 'a request from an opaque origin';
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { return `a request${from}`; }
  return originHost === request.headers.get('host') ? null : `a cross-origin request${from}`;
}

export function middleware(request: NextRequest) {
  const foreign = crossSite(request);
  if (foreign) return NextResponse.json({ error: `The Blackbox dashboard API only answers the dashboard's own pages and refused ${foreign}.` }, { status: 403 });
  if (process.env.BLACKBOX_DASHBOARD_ALLOW_REMOTE === '1') return NextResponse.next();
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  if (LOOPBACK.has(host)) return NextResponse.next();
  return NextResponse.json({ error: `The Blackbox dashboard API is local-only and refused a request for host "${host || 'unknown'}". Open it at http://localhost:3000, or set BLACKBOX_DASHBOARD_ALLOW_REMOTE=1 on a trusted network.` }, { status: 403 });
}

export const config = { matcher: '/api/:path*' };
