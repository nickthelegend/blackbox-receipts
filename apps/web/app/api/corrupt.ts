import { NextResponse } from 'next/server';

/**
 * A receipt log line that does not parse (CorruptLogError in the store: an append cut short by a killed
 * process, or an edit) becomes a readable 409 that names the file and the line, instead of a bare 500.
 * Returns null for any other error, which the route rethrows.
 */
export function corruptResponse(error: unknown): NextResponse | null {
  if (!(error instanceof Error) || error.name !== 'CorruptLogError') return null;
  return NextResponse.json({ error: error.message, corruptLine: (error as Error & { line: number }).line }, { status: 409 });
}
