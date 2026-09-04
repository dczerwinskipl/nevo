import { AlertTriangle } from 'lucide-react';

export interface ProviderUnavailableBannerProps {
  providerLabel: string;
  reason: string;
}

export function ProviderUnavailableBanner({ providerLabel, reason }: ProviderUnavailableBannerProps) {
  return (
    <div className="shrink-0 border-b border-[var(--warning-border)] bg-[var(--warning-muted)] px-3 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-4xl items-start gap-2.5 text-xs text-[var(--warning-strong)]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Provider {providerLabel} nie jest dostępny</p>
          <p className="mt-0.5 text-[11px] text-[color-mix(in_srgb,var(--warning-strong)_80%,transparent)]">{reason}</p>
        </div>
      </div>
    </div>
  );
}
