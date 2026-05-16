import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { sandboxProfileVersionTriggerConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfileVersionTriggerConfig } from "../sandbox-profiles/sandbox-profiles-service.js";
import {
  toCreateScheduledTriggerPayload,
  toScheduledTriggerFormValues,
  toUpdateScheduledTriggerPayload,
  validateScheduledTriggerFormValues,
} from "./scheduled-trigger-form-helpers.js";
import type {
  ScheduledTriggerFormOption,
  ScheduledTriggerFormValueKey,
  ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import {
  createScheduledTrigger,
  deleteScheduledTrigger,
  updateScheduledTrigger,
} from "./scheduled-triggers-service.js";
import type { TriggerCreateSuccessPath } from "./trigger-editor-navigation.js";
import { scheduledTriggerDetailQueryKey } from "./triggers-query-keys.js";
import { TRIGGERS_QUERY_KEY_PREFIX } from "./triggers-query-keys.js";
import { useSelectedSandboxProfileVersion } from "./use-selected-sandbox-profile-version.js";
import {
  buildWebhookTriggerPrimaryRepositoryOptions,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
  withSelectedSandboxProfileOptionVersion,
} from "./webhook-trigger-option-builders.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type LoadedScheduledTriggerEditorStateInput = {
  mode: "create" | "edit";
  triggerId: string | undefined;
  navigate: NavigateFunction;
  createSuccessPath?: TriggerCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ScheduledTriggerFormValues;
  initialSandboxProfileVersion?: number;
  sandboxProfileOptions: readonly ScheduledTriggerFormOption[];
};

const MissingProfileVersionQueryId = 0;
const RequiredFieldSummaryMessage = "Please address the fields highlighted in red.";

function hasRequiredFieldErrors(
  fieldErrors: Partial<Record<ScheduledTriggerFormValueKey, string>>,
): boolean {
  return (
    fieldErrors.name !== undefined ||
    fieldErrors.sandboxProfileId !== undefined ||
    fieldErrors.cronExpression !== undefined ||
    fieldErrors.timezone !== undefined ||
    fieldErrors.inputTemplate !== undefined
  );
}

function resolveTriggerMutationErrorMessage(input: {
  error: unknown;
  fallbackMessage: string;
}): string {
  return resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: input.fallbackMessage,
  });
}

async function invalidateTriggersQuery(input: {
  queryClient: QueryClient;
  triggerId: string | undefined;
}): Promise<void> {
  await input.queryClient.invalidateQueries({
    queryKey: TRIGGERS_QUERY_KEY_PREFIX,
  });

  if (input.triggerId !== undefined) {
    await input.queryClient.invalidateQueries({
      queryKey: scheduledTriggerDetailQueryKey(input.triggerId),
    });
  }
}

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: ScheduledTriggerFormValues;
  selectedProfileId: string;
  hasLoadedTriggerConfig: boolean;
  primaryRepositoryOptions: readonly ScheduledTriggerFormOption[];
}): string | null {
  if (!input.hasLoadedTriggerConfig) {
    return null;
  }

  if (input.currentValues.sandboxProfileId.trim() !== input.selectedProfileId) {
    return null;
  }

  if (input.primaryRepositoryOptions.length === 0) {
    return input.currentValues.primaryRepositoryId.trim().length === 0 ? null : "";
  }

  return input.primaryRepositoryOptions.some(
    (option) => option.value === input.currentValues.primaryRepositoryId,
  )
    ? null
    : WebhookTriggerWorkspaceRootRepositoryOptionValue;
}

function applyScheduledTriggerValueChange(input: {
  values: ScheduledTriggerFormValues;
  key: ScheduledTriggerFormValueKey;
  value: string | boolean;
}): ScheduledTriggerFormValues {
  const nextValues: ScheduledTriggerFormValues = {
    ...input.values,
    [input.key]: input.value,
  };

  if (input.key === "sandboxProfileId") {
    return {
      ...nextValues,
      primaryRepositoryId: "",
    };
  }

  return nextValues;
}

export function useLoadedScheduledTriggerEditorState(
  input: LoadedScheduledTriggerEditorStateInput,
): {
  sandboxProfileOptions: readonly ScheduledTriggerFormOption[];
  primaryRepositoryOptions: readonly ScheduledTriggerFormOption[];
  values: ScheduledTriggerFormValues;
  fieldErrors: Partial<Record<ScheduledTriggerFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  deleteError: string | null;
  isDeleteDialogOpen: boolean;
  isDeleting: boolean;
  isSaving: boolean;
  onDeleteDialogOpenChange: (isOpen: boolean) => void;
  onRequestDelete: (() => void) | null;
  onConfirmDelete: () => void;
  onSubmit: () => void;
  onValueChange: (key: ScheduledTriggerFormValueKey, value: string | boolean) => void;
} {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState(input.initialValues);
  const [savedFormValues, setSavedFormValues] = useState(input.initialValues);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ScheduledTriggerFormValueKey, string>>
  >({});
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const { effectiveSelectedProfileVersion, setSelectedSandboxProfileVersion } =
    useSelectedSandboxProfileVersion({
      initialSandboxProfileVersion: input.initialSandboxProfileVersion,
      selectedProfileId,
    });
  const selectedProfileTriggerConfigQuery = useQuery({
    queryKey: sandboxProfileVersionTriggerConfigQueryKey({
      profileId: selectedProfileId,
      version: effectiveSelectedProfileVersion ?? MissingProfileVersionQueryId,
    }),
    queryFn: async ({ signal }) => {
      if (effectiveSelectedProfileVersion === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionTriggerConfig({
        profileId: selectedProfileId,
        version: effectiveSelectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId.length > 0 && effectiveSelectedProfileVersion !== null,
    retry: false,
  });
  const selectedProfileTriggerConfig = selectedProfileTriggerConfigQuery.data;
  const hasLoadedSelectedProfileTriggerConfig = selectedProfileTriggerConfig !== undefined;
  const selectedProfileRepositoryOptions = selectedProfileTriggerConfig?.repositoryOptions ?? [];
  const primaryRepositoryOptions = useMemo(
    () =>
      buildWebhookTriggerPrimaryRepositoryOptions({
        repositoryOptions: selectedProfileRepositoryOptions,
      }),
    [selectedProfileRepositoryOptions],
  );
  const sandboxProfileOptions = useMemo(
    () =>
      withSelectedSandboxProfileOptionVersion({
        options: input.sandboxProfileOptions,
        selectedProfileId,
        selectedVersion: effectiveSelectedProfileVersion,
      }),
    [effectiveSelectedProfileVersion, input.sandboxProfileOptions, selectedProfileId],
  );

  useEffect(() => {
    setFormValues((currentValues) => {
      const normalizedPrimaryRepositoryId = resolvePrimaryRepositorySelectionNormalization({
        currentValues,
        selectedProfileId,
        hasLoadedTriggerConfig: hasLoadedSelectedProfileTriggerConfig,
        primaryRepositoryOptions,
      });
      if (normalizedPrimaryRepositoryId === null) {
        return currentValues;
      }

      return {
        ...currentValues,
        primaryRepositoryId: normalizedPrimaryRepositoryId,
      };
    });
  }, [
    primaryRepositoryOptions,
    hasLoadedSelectedProfileTriggerConfig,
    selectedProfileTriggerConfig,
    selectedProfileId,
  ]);

  const createMutation = useMutation({
    mutationFn: async (values: ScheduledTriggerFormValues) =>
      createScheduledTrigger({
        payload: toCreateScheduledTriggerPayload(values),
      }),
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery({
        queryClient,
        triggerId: trigger.id,
      });
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/triggers/${trigger.id}`
          : input.createSuccessPath(trigger),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveTriggerMutationErrorMessage({
          error,
          fallbackMessage: "Could not create trigger.",
        }),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ScheduledTriggerFormValues) => {
      if (input.triggerId === undefined) {
        throw new Error("Trigger id is required.");
      }

      return updateScheduledTrigger({
        payload: {
          triggerId: input.triggerId,
          payload: toUpdateScheduledTriggerPayload(values, {
            initialValues: savedFormValues,
          }),
        },
      });
    },
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      const nextFormValues = toScheduledTriggerFormValues(trigger);
      setFormValues(nextFormValues);
      setSavedFormValues(nextFormValues);
      setFieldErrors({});
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery({
        queryClient,
        triggerId: trigger.id,
      });
    },
    onError: (error: unknown) => {
      setFormError(
        resolveTriggerMutationErrorMessage({
          error,
          fallbackMessage: "Could not update trigger.",
        }),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (input.triggerId === undefined) {
        throw new Error("Trigger id is required.");
      }

      return deleteScheduledTrigger({
        triggerId: input.triggerId,
      });
    },
    onSuccess: async () => {
      await invalidateTriggersQuery({
        queryClient,
        triggerId: input.triggerId,
      });
      await input.navigate(input.deleteSuccessPath ?? "/triggers");
    },
    onError: (error: unknown) => {
      setDeleteError(
        resolveTriggerMutationErrorMessage({
          error,
          fallbackMessage: "Could not delete trigger.",
        }),
      );
    },
  });

  function onValueChange(key: ScheduledTriggerFormValueKey, value: string | boolean): void {
    const nextValues = applyScheduledTriggerValueChange({
      values: formValues,
      key,
      value,
    });

    if (key === "sandboxProfileId") {
      setSelectedSandboxProfileVersion(null);
    }

    setFormValues(nextValues);
    setFieldErrors((currentErrors) => {
      if (key === "sandboxProfileId") {
        const {
          sandboxProfileId: _sandboxProfileId,
          primaryRepositoryId: _primaryRepositoryId,
          ...remainingErrors
        } = currentErrors;

        void _sandboxProfileId;
        void _primaryRepositoryId;

        return {
          ...remainingErrors,
        };
      }

      return {
        ...currentErrors,
        [key]: undefined,
      };
    });
    setValidationSummaryError(null);
    setFormError(null);
  }

  function onSubmit(): void {
    const nextFieldErrors = validateScheduledTriggerFormValues(formValues);
    setFieldErrors(nextFieldErrors);
    setValidationSummaryError(
      hasRequiredFieldErrors(nextFieldErrors) ? RequiredFieldSummaryMessage : null,
    );
    setFormError(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    if (input.mode === "create") {
      createMutation.mutate(formValues);
      return;
    }

    updateMutation.mutate(formValues);
  }

  function requestDelete(): void {
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  }

  function confirmDelete(): void {
    deleteMutation.mutate();
  }

  return {
    sandboxProfileOptions,
    primaryRepositoryOptions,
    values: formValues,
    fieldErrors,
    validationSummaryError,
    formError,
    deleteError,
    isDeleteDialogOpen,
    isDeleting: deleteMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
    onDeleteDialogOpenChange: setIsDeleteDialogOpen,
    onRequestDelete: input.mode === "edit" ? requestDelete : null,
    onConfirmDelete: confirmDelete,
    onSubmit,
    onValueChange,
  };
}
