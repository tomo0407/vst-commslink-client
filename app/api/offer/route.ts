import { kv } from '@/lib/redis';
import { NextResponse } from 'next/server';

/** Phone posts its SDP offer so the VST can pick it up. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { vst_id, session_id, sdp } = body ?? {};

  if (!vst_id || !session_id || !sdp) {
    return NextResponse.json(
      { error: 'vst_id, session_id, sdp are required' },
      { status: 400 },
    );
  }

  await kv.set(`offer:${session_id}`, { vst_id, sdp }, { ex: 300 });
  await kv.lpush(`pending:${vst_id}`, session_id);
  await kv.expire(`pending:${vst_id}`, 300);

  return NextResponse.json({ ok: true });
}
