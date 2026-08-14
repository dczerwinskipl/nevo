import { cn } from '@/lib/utils';

export function Progress({ value, className }: { value: number; className?: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('h-1.5 overflow-hidden rounded-full bg-white/7', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
    >
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
