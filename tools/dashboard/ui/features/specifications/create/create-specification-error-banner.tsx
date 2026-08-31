import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CreateSpecificationErrorBannerProps {
  specError: string | null;
  aiError: string | null;
  isSpecCreated: boolean;
  isSubmitting: boolean;
  onOpenSpecWithoutAi: () => void;
  onRetryAi: () => void;
}

export function CreateSpecificationErrorBanner({
  specError,
  aiError,
  isSpecCreated,
  isSubmitting,
  onOpenSpecWithoutAi,
  onRetryAi,
}: CreateSpecificationErrorBannerProps) {
  return (
    <>
      {/* Phase 1 Spec Creation Error */}
      {specError && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-muted)] p-3.5 text-xs text-[var(--danger-strong)]">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
          <div className="flex-1">
            <p className="font-semibold">Błąd tworzenia specyfikacji</p>
            <p className="mt-0.5 text-[color-mix(in_srgb,var(--danger-strong)_90%,transparent)]">{specError}</p>
          </div>
        </div>
      )}

      {/* Phase 2 AI Session Error with 2-action recovery */}
      {aiError && isSpecCreated && (
        <div className="mt-5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-muted)] p-4 text-xs text-[var(--warning-strong)]">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <div className="flex-1">
              <p className="font-semibold">Specyfikacja została utworzona pomyślnie</p>
              <p className="mt-1 text-[color-mix(in_srgb,var(--warning-strong)_90%,transparent)]">
                Uruchomienie sesji AI nie powiodło się: {aiError}
              </p>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-[var(--warning-border)] pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenSpecWithoutAi}
              className="h-8 gap-1.5 text-xs"
            >
              Otwórz specyfikację
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onRetryAi()}
              disabled={isSubmitting}
              className="h-8 gap-1.5 text-xs font-semibold"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Spróbuj ponownie
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
