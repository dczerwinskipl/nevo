import { useState, useEffect } from 'react';
import {
  useAiProviders,
  useCreateAiSession,
  useCreateSpecification,
  type CreateSpecificationResult,
} from '@/hooks/use-dashboard-data';
import { slugifyTitle } from '@/lib/spec-create-helpers';
import { initialPromptWithTaskContext } from '@/lib/ai-chat-helpers';
import type { AiSession, AgentExecutionMode } from '@/lib/types';

export interface UseSpecCreateFormOptions {
  onClose: () => void;
  onCreated: (
    spec: CreateSpecificationResult,
    session?: AiSession | null,
    initialPrompt?: string | null,
  ) => void;
}

export function useSpecCreateForm({ onClose, onCreated }: UseSpecCreateFormOptions) {
  const providers = useAiProviders();
  const specMutation = useCreateSpecification();
  const createAiSession = useCreateAiSession();

  const enabledProviders = (providers.data?.providers.filter((p) => p.enabled) ?? []).sort(
    (a, b) => {
      if (a.id === 'mock') return 1;
      if (b.id === 'mock') return -1;
      return 0;
    },
  );
  const availableProviders = enabledProviders.filter((p) => p.available !== false);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [type, setType] = useState<'standard' | 'architectural' | 'small' | 'exploratory'>(
    'standard',
  );
  const [goal, setGoal] = useState('');

  // AI planning state
  const [startAiSession, setStartAiSession] = useState(false);
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<AgentExecutionMode>('agent');
  const [initialPrompt, setInitialPrompt] = useState('');

  // Two-phase execution state
  const [createdSpec, setCreatedSpec] = useState<CreateSpecificationResult | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-generate slug when title changes unless manually touched (or if slug is empty)
  const handleTitleChange = (val: string) => {
    setTitle(val);
    const newSlug = !slugManuallyEdited || !slug.trim() ? slugifyTitle(val) : slug;
    if (!slugManuallyEdited || !slug.trim()) {
      setSlug(newSlug);
    }
  };

  const handleSlugChange = (val: string) => {
    setSlug(val);
    if (!val.trim()) {
      setSlugManuallyEdited(false);
    } else {
      setSlugManuallyEdited(true);
    }
  };

  const handleSyncSlugWithTitle = () => {
    const autoSlug = slugifyTitle(title);
    setSlug(autoSlug);
    setSlugManuallyEdited(false);
  };

  const handleGoalChange = (val: string) => {
    setGoal(val);
  };

  // Initialize provider and mode when available
  useEffect(() => {
    if (!provider && availableProviders[0]) {
      const initP = availableProviders[0];
      setProvider(initP.id);
      const supported = initP.supportedModes || ['ask', 'edit', 'agent'];
      if (supported.includes('agent')) {
        setMode('agent');
      } else {
        setMode(initP.defaultMode || 'edit');
      }
    }
  }, [availableProviders, provider]);

  // When selected provider changes, revalidate supported modes
  const handleProviderChange = (newProviderId: string) => {
    setProvider(newProviderId);
    const pObj = enabledProviders.find((p) => p.id === newProviderId);
    if (pObj) {
      const supported = pObj.supportedModes || ['ask', 'edit', 'agent'];
      if (supported.includes('agent')) {
        setMode('agent');
      } else {
        setMode(pObj.defaultMode || 'edit');
      }
    }
  };

  const selectedProviderObj = enabledProviders.find((p) => p.id === provider);
  const isSelectedProviderAvailable = selectedProviderObj?.available !== false;
  const supportedModes = selectedProviderObj?.supportedModes || ['ask', 'edit', 'agent'];

  const executeAiSessionKickoff = async (spec: CreateSpecificationResult) => {
    const session = await createAiSession.create({
      provider,
      specId: spec.specId,
      mode,
      title: 'Planowanie specyfikacji',
    });

    const promptToSend = initialPromptWithTaskContext(initialPrompt, [], {
      slug: spec.slug,
      title: spec.change.title || title,
      goal: goal.trim(),
      isPlanning: true,
    });

    onCreated(spec, session, promptToSend);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSpecError(null);
    setAiError(null);
    setIsSubmitting(true);

    try {
      let specResult = createdSpec;

      // Phase 1: Create spec skeleton if not already created
      if (!specResult) {
        specResult = await specMutation.createSpecification({
          slug: slug.trim(),
          title: title.trim(),
          type,
          goal: goal.trim(),
        });
        setCreatedSpec(specResult);
      }

      // Phase 2: Optional AI planning session
      if (startAiSession) {
        if (!provider || !isSelectedProviderAvailable) {
          throw new Error('Wybrany provider AI jest niedostępny.');
        }
        try {
          await executeAiSessionKickoff(specResult);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setAiError(msg);
          setIsSubmitting(false);
          return;
        }
      } else {
        onCreated(specResult, null, null);
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpecError(msg);
      setIsSubmitting(false);
    }
  };

  const handleOpenSpecWithoutAi = () => {
    if (createdSpec) {
      onCreated(createdSpec, null, null);
      onClose();
    }
  };

  const handleRetryAi = async () => {
    if (!createdSpec) return;
    setAiError(null);
    setIsSubmitting(true);
    try {
      await executeAiSessionKickoff(createdSpec);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiError(msg);
      setIsSubmitting(false);
    }
  };

  return {
    // Form fields
    title,
    slug,
    slugManuallyEdited,
    type,
    setType,
    goal,
    handleTitleChange,
    handleSlugChange,
    handleSyncSlugWithTitle,
    handleGoalChange,

    // AI Planning
    startAiSession,
    setStartAiSession,
    provider,
    mode,
    setMode,
    initialPrompt,
    setInitialPrompt,
    handleProviderChange,
    providersLoading: providers.loading,
    enabledProviders,
    selectedProviderObj,
    isSelectedProviderAvailable,
    supportedModes,

    // Execution state
    createdSpec,
    specError,
    aiError,
    isSubmitting,
    handleSubmit,
    handleOpenSpecWithoutAi,
    handleRetryAi,
  };
}
