// The dashboard's API routes read and change the local receipt store (tamper, restore, new session,
// prove with the local key). They are for the person at this machine only: requests whose Host is not
// a loopback name are refused. The dev and start scripts also bind to 127.0.0.1. Set
// BLACKBOX_DASHBOARD_ALLOW_REMOTE=1 only on a network you trust.
import { NextResponse, type NextRequest } from 'next/server';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function middleware(request: NextRequest) {
  if (process.env.BLACKBOX_DASHBOARD_ALLOW_REMOTE === '1') return NextResponse.next();
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  if (LOOPBACK.has(host)) return NextResponse.next();
  return NextResponse.json({ error: `The Blackbox dashboard API is local-only and refused a request for host "${host || 'unknown'}". Open it at http://localhost:3000, or set BLACKBOX_DASHBOARD_ALLOW_REMOTE=1 on a trusted network.` }, { status: 403 });
}

export const config = { matcher: '/api/:path*' };
