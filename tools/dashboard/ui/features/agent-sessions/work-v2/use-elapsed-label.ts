import { useEffect, useState } from 'react';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Continuously increasing elapsed-time label for Level 1's current-activity indicator
 * (areas/work-ux-presentation.md § "Level 1 — Work indicator"). Ticks on a plain
 * interval synchronized with an external `startedAt` timestamp — no fake/simulated
 * progress, just real wall-clock elapsed time since the server-evidenced start.
 */
export function useElapsedLabel(startedAt: string | undefined): string | null {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!startedAt) return undefined;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;
  return formatElapsed(Date.now() - startedMs);
}
