import { NextResponse } from 'next/server';
import { explainCurrent } from '@blackbox/proxy/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The step-cited explanation of the live session: the same model `blackbox-receipts explain --json`
// prints. Its step descriptions come from the private witness (opened against each receipt's argsHash),
// exactly as the CLI shows them; the witness file itself is never served. Local-only (see middleware.ts).
export async function GET() {
  try {
    return NextResponse.json(await explainCurrent());
  } catch (error) {
    return NextResponse.json({ error: `Could not explain the session: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
