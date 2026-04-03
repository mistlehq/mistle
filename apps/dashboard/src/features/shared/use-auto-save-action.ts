import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { readApiErrorMessage } from "../api/http-api-error.js";

export type UseAutoSaveActionOptions<TInput> = {
  save: (input: TInput) => Promise<void>;
  afterSave?: (input: TInput) => Promise<void>;
  fallbackMessage?: string;
};

export function useAutoSaveAction<TInput>(input: UseAutoSaveActionOptions<TInput>): {
  clearError: () => void;
  errorMessage: string | null;
  isSaving: boolean;
  run: (value: TInput) => Promise<void>;
} {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: input.save,
    onMutate: () => {
      setErrorMessage(null);
    },
    onError: (error: unknown) => {
      setErrorMessage(resolveAutoSaveActionErrorMessage(error, input.fallbackMessage));
    },
    onSuccess: async (_result, variables) => {
      setErrorMessage(null);
      await input.afterSave?.(variables);
    },
  });

  return {
    clearError: () => {
      setErrorMessage(null);
    },
    errorMessage,
    isSaving: mutation.isPending,
    run: async (value) => {
      try {
        await mutation.mutateAsync(value);
      } catch (error) {
        const message = resolveAutoSaveActionErrorMessage(error, input.fallbackMessage);
        if (message !== null) {
          throw new Error(message);
        }

        throw error;
      }
    },
  };
}

function resolveAutoSaveActionErrorMessage(
  error: unknown,
  fallbackMessage: string | undefined,
): string | null {
  const apiErrorMessage = readApiErrorMessage(error);
  if (apiErrorMessage !== null) {
    return apiErrorMessage;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage ?? null;
}
