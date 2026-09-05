import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/button';

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
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-status-error/25 bg-status-error/10 p-3.5 text-xs text-status-error">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-error" />
          <div className="flex-1">
            <p className="font-semibold">Błąd tworzenia specyfikacji</p>
            <p className="mt-0.5 text-status-error/90">{specError}</p>
          </div>
        </div>
      )}

      {/* Phase 2 AI Session Error with 2-action recovery */}
      {aiError && isSpecCreated && (
        <div className="mt-5 rounded-xl border border-status-warning/25 bg-status-warning/10 p-4 text-xs text-status-warning">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-warning" />
            <div className="flex-1">
              <p className="font-semibold">Specyfikacja została utworzona pomyślnie</p>
              <p className="mt-1 text-status-warning/90">Uruchomienie sesji AI nie powiodło się: {aiError}</p>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-status-warning/25 pt-3">
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
              {isSubmitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Spróbuj ponownie
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
