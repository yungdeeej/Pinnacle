import { decimalToAmerican, decimalToImpliedProb } from './odds';

export function calculateCLV(
  decimalOddsTaken: number,
  decimalOddsClosing: number,
): { clv_cents: number; clv_pct: number } {
  const americanTaken = decimalToAmerican(decimalOddsTaken);
  const americanClosing = decimalToAmerican(decimalOddsClosing);
  const clvCents = americanTaken - americanClosing;
  const impliedTaken = decimalToImpliedProb(decimalOddsTaken);
  const impliedClosing = decimalToImpliedProb(decimalOddsClosing);
  const clvPct = ((impliedClosing - impliedTaken) / impliedTaken) * 100;
  return { clv_cents: clvCents, clv_pct: clvPct };
}

// Spec: 06_AGENT_TREASURER.md — classification tiers (rolling 30d, cents)
export type CLVClassification = 'sharp' | 'marginal' | 'break_even' | 'below_replacement';

export function classifyCLV(rolling30dClvCents: number): CLVClassification {
  if (rolling30dClvCents >= 1.5) return 'sharp';
  if (rolling30dClvCents >= 0.5) return 'marginal';
  if (rolling30dClvCents >= -0.5) return 'break_even';
  return 'below_replacement';
}
