import { Bot, FilePlus2, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import type { CreateSpecificationResult } from '../queries';
import type { AgentSession } from '@/features/agent-sessions/types';

import { useCreateSpecificationForm } from './use-create-specification-form';
import { CreateSpecificationErrorBanner } from './create-specification-error-banner';
import { SpecificationMetadataFields } from './specification-metadata-fields';
import { SpecificationAiPlanningSection } from './specification-ai-planning-section';

export interface CreateSpecificationDialogProps {
  onClose: () => void;
  onCreated: (
    spec: CreateSpecificationResult,
    session?: AgentSession | null,
    promptToSend?: string | null,
    userMessage?: string | null,
  ) => void;
}

export function CreateSpecificationDialog({ onClose, onCreated }: CreateSpecificationDialogProps) {
  const form = useCreateSpecificationForm({ onClose, onCreated });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-backdrop backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !form.isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={(event) => void form.handleSubmit(event)}
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-accent">
              <FilePlus2 className="size-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-accent uppercase">Workflow Specyfikacji</p>
              <h2 className="mt-1 text-xl font-semibold">Nowa specyfikacja</h2>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={form.isSubmitting}
            aria-label="Zamknij tworzenie specyfikacji"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Error Notifications */}
        <CreateSpecificationErrorBanner
          specError={form.specError}
          aiError={form.aiError}
          isSpecCreated={Boolean(form.createdSpec)}
          isSubmitting={form.isSubmitting}
          onOpenSpecWithoutAi={form.handleOpenSpecWithoutAi}
          onRetryAi={() => void form.handleRetryAi()}
        />

        {/* Form Body */}
        <div className="mt-5 space-y-4">
          <SpecificationMetadataFields
            title={form.title}
            slug={form.slug}
            type={form.type}
            goal={form.goal}
            slugManuallyEdited={form.slugManuallyEdited}
            disabled={Boolean(form.createdSpec)}
            onTitleChange={form.handleTitleChange}
            onSlugChange={form.handleSlugChange}
            onSyncSlugWithTitle={form.handleSyncSlugWithTitle}
            onTypeChange={form.setType}
            onGoalChange={form.handleGoalChange}
          />

          <SpecificationAiPlanningSection
            startAiSession={form.startAiSession}
            onToggleAiSession={form.setStartAiSession}
            providersLoading={form.providersLoading}
            enabledProviders={form.enabledProviders}
            selectedProviderId={form.provider}
            onProviderChange={form.handleProviderChange}
            supportedModes={form.supportedModes}
            selectedMode={form.mode}
            onModeChange={form.setMode}
            initialPrompt={form.initialPrompt}
            onPromptChange={form.setInitialPrompt}
            disabled={Boolean(form.createdSpec)}
          />
        </div>

        {/* Modal Actions */}
        {!form.aiError && (
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={form.isSubmitting}>
              Anuluj
            </Button>
            <Button
              type="submit"
              disabled={
                form.isSubmitting ||
                !form.title.trim() ||
                !form.slug.trim() ||
                (form.startAiSession && (!form.provider || !form.isSelectedProviderAvailable))
              }
              className="gap-2 font-semibold"
            >
              {form.isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Tworzenie…
                </>
              ) : form.startAiSession ? (
                <>
                  <Bot className="size-4" />
                  Utwórz specyfikację i rozpocznij sesję
                </>
              ) : (
                <>
                  <FilePlus2 className="size-4" />
                  Utwórz specyfikację
                </>
              )}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
