import { NextResponse } from 'next/server';
import { restoreSession } from '@blackbox/proxy/store';

export const runtime = 'nodejs';

export async function POST() {
  try {
    return NextResponse.json({ restoredSteps: await restoreSession() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
