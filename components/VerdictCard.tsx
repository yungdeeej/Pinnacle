import { clsx } from 'clsx';
import { centsToCAD, signedPct, relativeTime } from '@/lib/utils/format';
import { formatAmerican } from '@/lib/utils/odds';
import { formatStars } from '@/lib/utils/kelly';

export interface VerdictRow {
  verdict_id: string;
  game_id: string;
  matchup: string;
  starts_at: number;
  market: string;
  side: string;
  decision: 'STRIKE' | 'PASS';
  pass_reason: string | null;
  recommended_book: string | null;
  recommended_odds_american: number | null;
  recommended_stake_cents: number | null;
  edge_pct: number | null;
  star_rating: number | null;
  walters_writeup: string;
  issued_at: number;
}

export function VerdictCard({ v }: { v: VerdictRow }) {
  const isStrike = v.decision === 'STRIKE';
  return (
    <div className={clsx('card', isStrike && 'ring-1 ring-strike/40 shadow-lg shadow-strike/5')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={clsx('pill', isStrike ? 'pill-strike' : 'pill-pass')}>
              {v.decision}
            </span>
            <span className="text-xs text-midnight-400">{relativeTime(v.starts_at)}</span>
            {isStrike && v.star_rating != null && (
              <span className="text-warn text-sm font-mono">{formatStars(v.star_rating)}</span>
            )}
          </div>
          <div className="mt-1.5 text-lg font-semibold text-midnight-50">{v.matchup}</div>
          <div className="mt-0.5 text-xs label-mono">
            {v.market} · {v.side}
          </div>
        </div>

        <div className="text-right">
          {isStrike ? (
            <>
              <div className="num text-2xl text-strike">{signedPct(v.edge_pct ?? 0)}</div>
              <div className="text-xs text-midnight-400">edge</div>
              {v.recommended_stake_cents != null && (
                <div className="mt-2 num text-sm text-midnight-100">
                  {centsToCAD(v.recommended_stake_cents)}
                </div>
              )}
              {v.recommended_book && (
                <div className="text-xs text-midnight-500 mt-0.5">
                  {v.recommended_book} {formatAmerican(v.recommended_odds_american ?? 0)}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="num text-base text-midnight-400">{signedPct(v.edge_pct ?? 0)}</div>
              <div className="text-xs text-midnight-500">edge</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 text-sm text-midnight-200 leading-relaxed border-l-2 border-midnight-700 pl-3">
        {v.walters_writeup}
      </div>

      {!isStrike && v.pass_reason && (
        <div className="mt-3 text-xs text-midnight-500 font-mono">
          ↳ {v.pass_reason}
        </div>
      )}
    </div>
  );
}
