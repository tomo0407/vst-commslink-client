import { kv } from '@/lib/redis';
import { NextResponse } from 'next/server';

/** Keep-alive: called daily by Vercel Cron to prevent Upstash from archiving the database. */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await kv.ping();
  return NextResponse.json({ ok: true });
}
