import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

/** VST posts its SDP answer so the phone can pick it up. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { session_id, sdp } = body ?? {};

  if (!session_id || !sdp) {
    return NextResponse.json(
      { error: 'session_id, sdp are required' },
      { status: 400 },
    );
  }

  await kv.set(`answer:${session_id}`, { sdp }, { ex: 300 });

  return NextResponse.json({ ok: true });
}
