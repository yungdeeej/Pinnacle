import { NextRequest, NextResponse } from 'next/server';
import { seed } from '@/lib/db/seed';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    await seed({ force });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
