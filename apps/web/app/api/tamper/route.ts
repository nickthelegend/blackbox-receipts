import { NextResponse } from 'next/server';
import { tamperReceipt } from '@blackbox/proxy/store';

export const runtime = 'nodejs';

// Uses the same store function as `blackbox-receipts tamper <step>`, so the original line is
// backed up and `restore` (CLI or /api/restore) can undo it.
export async function POST(request: Request) {
  let step = 1;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && body.step !== undefined) step = Number(body.step);
    if (!Number.isInteger(step) || step < 1) return NextResponse.json({ error: `Block step must be a positive integer, got "${body.step}".` }, { status: 400 });
    return NextResponse.json({ editedStep: await tamperReceipt(step) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
