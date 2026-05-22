import { clsx } from 'clsx';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down' | 'flat';
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

export function StatCard({ label, value, hint, trend, tone = 'default' }: StatCardProps) {
  return (
    <div className="card">
      <div className="label-mono">{label}</div>
      <div className={clsx(
        'mt-2 text-3xl num font-semibold',
        tone === 'good' && 'text-strike',
        tone === 'warn' && 'text-warn',
        tone === 'bad' && 'text-danger',
        tone === 'default' && 'text-midnight-50',
      )}>{value}</div>
      {hint && (
        <div className="mt-1 text-xs text-midnight-400 flex items-center gap-1.5">
          {trend === 'up' && <span className="text-strike">▲</span>}
          {trend === 'down' && <span className="text-danger">▼</span>}
          {trend === 'flat' && <span className="text-midnight-500">—</span>}
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}
