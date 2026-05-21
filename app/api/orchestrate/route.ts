import { NextRequest, NextResponse } from 'next/server';
import { orchestrateGame, orchestrateAllUpcoming } from '@/lib/agents/orchestrator';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.gameId) {
      const result = await orchestrateGame(body.gameId, 'manual');
      const strikes = result.verdicts.filter((v) => v.decision === 'STRIKE').length;
      return NextResponse.json({
        ok: true,
        result,
        summary: { verdicts: result.verdicts.length, strikes },
      });
    }
    const all = await orchestrateAllUpcoming(24);
    const totalVerdicts = all.reduce((s, r) => s + r.verdicts.length, 0);
    const totalStrikes = all.reduce((s, r) => s + r.verdicts.filter((v) => v.decision === 'STRIKE').length, 0);
    return NextResponse.json({
      ok: true,
      games_processed: all.length,
      summary: { verdicts: totalVerdicts, strikes: totalStrikes },
      results: all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
