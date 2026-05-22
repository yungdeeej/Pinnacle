import Link from 'next/link';
import { db, ensureSchema } from '@/lib/db';
import { games, teams, verdicts } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { formatGameTime, relativeTime } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export default function GamesPage() {
  ensureSchema();
  const allGames = db.select().from(games).orderBy(games.scheduled_start_utc).all();
  const teamMap = new Map(db.select().from(teams).all().map((t) => [t.id, t]));
  const verdictMap = new Map<string, number>();
  for (const v of db.select().from(verdicts).all()) {
    if (v.decision === 'STRIKE') verdictMap.set(v.game_id, (verdictMap.get(v.game_id) ?? 0) + 1);
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <header>
        <div className="label-mono">Slate</div>
        <h1 className="text-3xl font-semibold text-ice-100 mt-1">Games</h1>
        <p className="text-sm text-midnight-400 mt-1">{allGames.length} game{allGames.length === 1 ? '' : 's'} on the board</p>
      </header>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-midnight-900/80 border-b border-midnight-800">
            <tr className="text-left label-mono">
              <th className="px-4 py-3">Matchup</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">Venue</th>
              <th className="px-4 py-3 text-right">Status</th>
              <th className="px-4 py-3 text-right">Verdicts</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {allGames.map((g) => {
              const home = teamMap.get(g.home_team_id);
              const away = teamMap.get(g.away_team_id);
              const strikeCount = verdictMap.get(g.id) ?? 0;
              return (
                <tr key={g.id} className="row-hover border-b border-midnight-800/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-midnight-100">
                      {away?.name} <span className="text-midnight-500">@</span> {home?.name}
                    </div>
                    <div className="text-xs text-midnight-500 font-mono">
                      {away?.abbreviation} @ {home?.abbreviation}
                    </div>
                  </td>
                  <td className="px-4 py-3 num text-midnight-300">
                    <div>{formatGameTime(g.scheduled_start_utc)}</div>
                    <div className="text-xs text-midnight-500">{relativeTime(g.scheduled_start_utc)}</div>
                  </td>
                  <td className="px-4 py-3 text-midnight-400 text-xs">{g.venue}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="pill pill-pass">{g.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {strikeCount > 0 ? (
                      <span className="pill pill-strike">⚡ {strikeCount}</span>
                    ) : (
                      <span className="text-xs text-midnight-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/games/${g.id}`} className="text-xs text-ice-400 hover:text-ice-300">detail →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
