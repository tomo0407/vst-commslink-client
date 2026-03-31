import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

interface AnswerEntry {
  sdp: string;
}

/** Phone polls this endpoint until the VST posts its answer. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const data = await kv.get<AnswerEntry>(`answer:${sessionId}`);
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ sdp: data.sdp });
}
