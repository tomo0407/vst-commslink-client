import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

interface OfferEntry {
  vst_id: string;
  sdp: string;
}

/**
 * VST polls this endpoint to retrieve pending offers.
 * Returns all queued session offers and clears the queue atomically.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: vstId } = await params;

  const sessionIds: string[] = (await kv.lrange(`pending:${vstId}`, 0, -1)) ?? [];
  if (sessionIds.length > 0) {
    await kv.del(`pending:${vstId}`);
  }

  const offers = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const offer = await kv.get<OfferEntry>(`offer:${sessionId}`);
      return offer ? { session_id: sessionId, sdp: offer.sdp } : null;
    }),
  );

  return NextResponse.json(offers.filter(Boolean));
}
