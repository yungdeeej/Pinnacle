'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const NAV = [
  { href: '/', label: 'Command', emoji: '◆' },
  { href: '/verdicts', label: 'Verdicts', emoji: '⚡' },
  { href: '/games', label: 'Slate', emoji: '◉' },
  { href: '/bankroll', label: 'Bankroll', emoji: '◐' },
  { href: '/agents', label: 'Agents', emoji: '◈' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-midnight-800 bg-midnight-950/80 backdrop-blur sticky top-0 h-screen flex flex-col">
      <div className="px-5 py-6 border-b border-midnight-800">
        <div className="text-sm label-mono">The Syndicate</div>
        <div className="text-xl font-semibold text-ice-200 mt-1">NHL Intel</div>
        <div className="mt-2 text-[11px] text-midnight-500 font-mono">v1.1 · Walters</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-ice-600/15 text-ice-200 border border-ice-700/30'
                  : 'text-midnight-300 hover:bg-midnight-800/50 hover:text-midnight-100',
              )}
            >
              <span className="text-base text-ice-500/80">{item.emoji}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-midnight-800 px-5 py-4">
        <div className="label-mono">Operator</div>
        <div className="text-sm text-midnight-200 mt-1">DJ · Calgary, AB</div>
        <div className="text-[11px] text-midnight-500 mt-1 font-mono">Mountain Time</div>
        <div className="mt-3 pill pill-warn">paper_trade</div>
      </div>
    </aside>
  );
}
