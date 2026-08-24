import { useState, useEffect, useRef, useCallback } from 'react';
import {
  InitialDispatchController,
  type UseInitialDispatchOptions,
  type InitialDispatchState,
} from './pending-dispatch-store';

export * from './pending-dispatch-store';

/**
 * React hook wrapping the single consolidated InitialDispatchController.
 */
export function useInitialDispatch(options: UseInitialDispatchOptions): InitialDispatchState {
  const controllerRef = useRef<InitialDispatchController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new InitialDispatchController(options);
  } else {
    controllerRef.current.updateOptions(options);
  }

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return controllerRef.current?.subscribe(() => {
      forceUpdate((c) => c + 1);
    });
  }, []);

  useEffect(() => {
    controllerRef.current?.checkAndDispatch();
  }, [
    options.assistant.isReady,
    options.isProviderAvailable,
    options.currentMode,
    options.provider,
    options.sessionId,
  ]);

  const controller = controllerRef.current;

  const handleRetryInitial = useCallback(async () => {
    return controllerRef.current?.handleRetryInitial() ?? false;
  }, []);

  const handleDismissError = useCallback(() => {
    controllerRef.current?.handleDismissError();
  }, []);

  return {
    pendingDispatch: controller.pending,
    failedInitialDispatch: controller.failedInitialDispatch,
    displayError: controller.displayError,
    canRetryInitial: controller.canRetryInitial,
    isInitialDispatchInFlight: controller.isInitialDispatchInFlight,
    handleRetryInitial,
    handleDismissError,
  };
}
