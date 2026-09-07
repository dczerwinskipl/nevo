import { AlertTriangle } from 'lucide-react';

export interface ProviderUnavailableBannerProps {
  providerLabel: string;
  reason: string;
}

export function ProviderUnavailableBanner({ providerLabel, reason }: ProviderUnavailableBannerProps) {
  return (
    <div className="shrink-0 border-b border-status-warning/25 bg-status-warning/10 px-3 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-4xl items-start gap-2.5 text-xs text-status-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Provider {providerLabel} nie jest dostępny</p>
          <p className="mt-0.5 text-[11px] text-status-warning/80">{reason}</p>
        </div>
      </div>
    </div>
  );
}
