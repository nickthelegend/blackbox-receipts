import { NextResponse } from 'next/server';
import { ZetarisClient, zetarisConfigFromEnv } from '@blackbox/zetaris';
import { MeterlessClient, meterlessConfigFromEnv } from '@blackbox/meterless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Integration = { name: string; ok: boolean; detail: string };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Live checks only: a missing key or unreachable service is reported as-is, never faked.
async function zetaris(): Promise<Integration> {
  let client: ZetarisClient;
  try { client = new ZetarisClient(zetarisConfigFromEnv()); } catch (error) { return { name: 'Zetaris', ok: false, detail: message(error) }; }
  try {
    const marts = await client.listDataMarts();
    return { name: 'Zetaris', ok: true, detail: `${marts.length} data mart(s) visible` };
  } catch (error) { return { name: 'Zetaris', ok: false, detail: message(error) }; }
}

async function meterless(): Promise<Integration> {
  let client: MeterlessClient;
  try { client = new MeterlessClient(meterlessConfigFromEnv()); } catch (error) { return { name: 'Meterless', ok: false, detail: message(error) }; }
  const status = await client.status();
  if (status === 'online') return { name: 'Meterless', ok: true, detail: `runtime online at ${client.config.baseUrl}` };
  return { name: 'Meterless', ok: false, detail: status === 'unauthorized' ? `runtime at ${client.config.baseUrl} rejected the token` : `runtime offline at ${client.config.baseUrl}` };
}

export async function GET() {
  return NextResponse.json({ integrations: await Promise.all([zetaris(), meterless()]) });
}
