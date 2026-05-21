// Odds math — source of truth for the entire system.
// Spec: 07_SHARED_CONTRACTS.md §"Shared Utility Functions"

export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function americanToImpliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

export function decimalToImpliedProb(decimal: number): number {
  return 1 / decimal;
}

export function impliedProbToAmerican(prob: number): number {
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

export function impliedProbToDecimal(prob: number): number {
  return 1 / prob;
}

// Proportional vig stripping
export function stripVigTwoWay(
  homeAmerican: number,
  awayAmerican: number,
): { home_fair_prob: number; away_fair_prob: number; vig_pct: number } {
  const h = americanToImpliedProb(homeAmerican);
  const a = americanToImpliedProb(awayAmerican);
  const total = h + a;
  return {
    home_fair_prob: h / total,
    away_fair_prob: a / total,
    vig_pct: (total - 1) * 100,
  };
}

export function stripVigThreeWay(
  homeAmerican: number,
  tieAmerican: number,
  awayAmerican: number,
): { home_fair: number; tie_fair: number; away_fair: number; vig_pct: number } {
  const h = americanToImpliedProb(homeAmerican);
  const t = americanToImpliedProb(tieAmerican);
  const a = americanToImpliedProb(awayAmerican);
  const total = h + t + a;
  return {
    home_fair: h / total,
    tie_fair: t / total,
    away_fair: a / total,
    vig_pct: (total - 1) * 100,
  };
}

export function calculateEdge(modelProb: number, marketDecimalOdds: number): number {
  return modelProb * marketDecimalOdds - 1;
}

export function calculateEdgePct(modelProb: number, marketDecimalOdds: number): number {
  return calculateEdge(modelProb, marketDecimalOdds) * 100;
}

export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

export function formatDecimalOdds(d: number): string {
  return d.toFixed(2);
}
