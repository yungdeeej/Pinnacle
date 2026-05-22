'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  gameId?: string;
  label?: string;
  ghost?: boolean;
}

export function OrchestrateButton({ gameId, label = 'Run Pipeline', ghost = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(gameId ? { gameId } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      const strikes = json.summary?.strikes ?? 0;
      const total = json.summary?.verdicts ?? 0;
      setMsg(`${total} verdicts, ${strikes} STRIKE${strikes === 1 ? '' : 's'}`);
      router.refresh();
    } catch (e: any) {
      setMsg(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={go} disabled={busy} className={ghost ? 'btn-ghost' : 'btn'}>
        {busy ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin" />
            Running…
          </>
        ) : (
          <>◆ {label}</>
        )}
      </button>
      {msg && <span className="text-xs text-midnight-400 font-mono">{msg}</span>}
    </div>
  );
}
