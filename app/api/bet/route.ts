import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verdicts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { recordBetPlaced } from '@/lib/agents/treasurer';

export const runtime = 'nodejs';

// Log that the operator placed a bet against a STRIKE verdict.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { verdictId, americanOddsTaken, stakeCentsOverride } = body;
    if (!verdictId) return NextResponse.json({ ok: false, error: 'verdictId required' }, { status: 400 });

    const v = db.select().from(verdicts).where(eq(verdicts.id, verdictId)).get();
    if (!v) return NextResponse.json({ ok: false, error: 'Verdict not found' }, { status: 404 });
    if (v.decision !== 'STRIKE') return NextResponse.json({ ok: false, error: 'Only STRIKE verdicts can be logged' }, { status: 400 });
    if (!v.recommended_book || v.recommended_odds_american == null || v.recommended_stake_cents == null) {
      return NextResponse.json({ ok: false, error: 'Verdict missing recommendation fields' }, { status: 400 });
    }

    const american = americanOddsTaken ?? v.recommended_odds_american;
    const decimal = american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
    const stake = stakeCentsOverride ?? v.recommended_stake_cents;

    const { betId, ledgerId } = recordBetPlaced({
      verdictId: v.id,
      gameId: v.game_id,
      market: v.market,
      book: v.recommended_book,
      side: v.side,
      americanOdds: american,
      decimalOdds: decimal,
      stakeCents: stake,
      primarySignalAgent: 'ceo',
    });

    return NextResponse.json({ ok: true, betId, ledgerId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
