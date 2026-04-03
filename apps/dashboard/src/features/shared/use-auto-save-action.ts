import { useMutation } from "@tanstack/react-query";

export type UseAutoSaveActionOptions<TInput> = {
  save: (input: TInput) => Promise<void>;
  afterSave?: (input: TInput) => Promise<void>;
};

export function useAutoSaveAction<TInput>(input: UseAutoSaveActionOptions<TInput>): {
  isSaving: boolean;
  run: (value: TInput) => Promise<void>;
} {
  const mutation = useMutation({
    mutationFn: input.save,
    onSuccess: async (_result, variables) => {
      await input.afterSave?.(variables);
    },
  });

  return {
    isSaving: mutation.isPending,
    run: async (value) => {
      await mutation.mutateAsync(value);
    },
  };
}
