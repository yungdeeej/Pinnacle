// Kelly sizing — spec: 07_SHARED_CONTRACTS.md & 06_AGENT_TREASURER.md

export interface KellyInput {
  modelProb: number;
  decimalOdds: number;
  bankrollCents: number;
  kellyFraction?: number;
  hardCapPct?: number;
  minStakeCents?: number;
}

export interface KellyResult {
  stake_cents: number;
  full_kelly_pct: number;
  applied_kelly_pct: number;
  capped: boolean;
  reason: string;
}

export function calculateKellyStake(input: KellyInput): KellyResult {
  const {
    modelProb,
    decimalOdds,
    bankrollCents,
    kellyFraction = 0.25,
    hardCapPct = 0.03,
    minStakeCents = 2000,
  } = input;

  const b = decimalOdds - 1;
  const p = modelProb;
  const q = 1 - p;
  const fullKelly = (p * b - q) / b;

  if (fullKelly <= 0) {
    return {
      stake_cents: 0,
      full_kelly_pct: fullKelly * 100,
      applied_kelly_pct: 0,
      capped: false,
      reason: 'Negative or zero Kelly edge',
    };
  }

  const fractionalKelly = fullKelly * kellyFraction;
  const cappedFraction = Math.min(fractionalKelly, hardCapPct);
  const capped = fractionalKelly > hardCapPct;

  let stakeCents = Math.round(bankrollCents * cappedFraction);

  if (stakeCents < minStakeCents && stakeCents > 0) {
    return {
      stake_cents: 0,
      full_kelly_pct: fullKelly * 100,
      applied_kelly_pct: cappedFraction * 100,
      capped,
      reason: 'Below minimum stake floor',
    };
  }

  return {
    stake_cents: stakeCents,
    full_kelly_pct: fullKelly * 100,
    applied_kelly_pct: cappedFraction * 100,
    capped,
    reason: capped ? 'Capped at 3% hard limit' : 'Within Kelly fraction',
  };
}

// Star rating from edge — spec: 05_AGENT_CEO.md
export function edgeToStars(edgePct: number): number {
  if (edgePct >= 10) return 3.0;
  if (edgePct >= 7) return 2.5;
  if (edgePct >= 5) return 2.0;
  if (edgePct >= 4) return 1.5;
  if (edgePct >= 3) return 1.0;
  if (edgePct >= 2.5) return 0.5;
  return 0;
}

export function formatStars(stars: number): string {
  const full = Math.floor(stars);
  const hasHalf = stars - full >= 0.5;
  let out = '';
  for (let i = 0; i < full; i++) out += '★';
  if (hasHalf) out += '½';
  return out || '—';
}
