import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionAutomationConfig,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { AutomationCreateSuccessPath } from "./automation-editor-navigation.js";
import {
  toCreateScheduledAutomationPayload,
  toScheduledAutomationFormValues,
  toUpdateScheduledAutomationPayload,
  validateScheduledAutomationFormValues,
} from "./scheduled-automation-form-helpers.js";
import type {
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import { scheduledAutomationDetailQueryKey } from "./scheduled-automations-query-keys.js";
import {
  createScheduledAutomation,
  deleteScheduledAutomation,
  updateScheduledAutomation,
} from "./scheduled-automations-service.js";
import { buildWebhookAutomationPrimaryRepositoryOptions } from "./webhook-automation-option-builders.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";
import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./webhook-automations-query-keys.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type LoadedScheduledAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
  createSuccessPath?: AutomationCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ScheduledAutomationFormValues;
  initialSandboxProfileVersion?: number;
  sandboxProfileOptions: readonly ScheduledAutomationFormOption[];
};

type SelectedSandboxProfileVersion = {
  profileId: string;
  version: number;
};

const MissingProfileVersionQueryId = 0;
const RequiredFieldSummaryMessage = "Please address the fields highlighted in red.";

function resolveActiveVersion(versions: readonly SandboxProfileVersion[]): number | null {
  const activeVersion = versions.find((version) => version.isActive);
  return activeVersion?.version ?? null;
}

function hasRequiredFieldErrors(
  fieldErrors: Partial<Record<ScheduledAutomationFormValueKey, string>>,
): boolean {
  return (
    fieldErrors.name !== undefined ||
    fieldErrors.sandboxProfileId !== undefined ||
    fieldErrors.cronExpression !== undefined ||
    fieldErrors.timezone !== undefined ||
    fieldErrors.inputTemplate !== undefined
  );
}

function resolveAutomationMutationErrorMessage(input: {
  error: unknown;
  fallbackMessage: string;
}): string {
  return resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: input.fallbackMessage,
  });
}

async function invalidateAutomationsQuery(input: {
  queryClient: QueryClient;
  automationId: string | undefined;
}): Promise<void> {
  await input.queryClient.invalidateQueries({
    queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
  });

  if (input.automationId !== undefined) {
    await input.queryClient.invalidateQueries({
      queryKey: scheduledAutomationDetailQueryKey(input.automationId),
    });
  }
}

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: ScheduledAutomationFormValues;
  selectedProfileId: string;
  hasLoadedAutomationConfig: boolean;
  primaryRepositoryOptions: readonly ScheduledAutomationFormOption[];
}): string | null {
  if (!input.hasLoadedAutomationConfig) {
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
    : WebhookAutomationWorkspaceRootRepositoryOptionValue;
}

function applyScheduledAutomationValueChange(input: {
  values: ScheduledAutomationFormValues;
  key: ScheduledAutomationFormValueKey;
  value: string | boolean;
}): ScheduledAutomationFormValues {
  const nextValues: ScheduledAutomationFormValues = {
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

export function useLoadedScheduledAutomationEditorState(
  input: LoadedScheduledAutomationEditorStateInput,
): {
  sandboxProfileOptions: readonly ScheduledAutomationFormOption[];
  primaryRepositoryOptions: readonly ScheduledAutomationFormOption[];
  values: ScheduledAutomationFormValues;
  fieldErrors: Partial<Record<ScheduledAutomationFormValueKey, string>>;
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
  onValueChange: (key: ScheduledAutomationFormValueKey, value: string | boolean) => void;
} {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState(input.initialValues);
  const [savedFormValues, setSavedFormValues] = useState(input.initialValues);
  const [selectedSandboxProfileVersion, setSelectedSandboxProfileVersion] =
    useState<SelectedSandboxProfileVersion | null>(
      input.initialSandboxProfileVersion === undefined ||
        input.initialValues.sandboxProfileId.trim().length === 0
        ? null
        : {
            profileId: input.initialValues.sandboxProfileId.trim(),
            version: input.initialSandboxProfileVersion,
          },
    );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ScheduledAutomationFormValueKey, string>>
  >({});
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const isUsingPinnedSelectedProfileVersion =
    selectedSandboxProfileVersion?.profileId === selectedProfileId;
  const selectedProfileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(selectedProfileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: selectedProfileId,
        signal,
      }),
    enabled: selectedProfileId.length > 0 && !isUsingPinnedSelectedProfileVersion,
    retry: false,
  });
  const activeSelectedProfileVersion = useMemo(
    () => resolveActiveVersion(selectedProfileVersionsQuery.data?.versions ?? []),
    [selectedProfileVersionsQuery.data],
  );
  const effectiveSelectedProfileVersion = isUsingPinnedSelectedProfileVersion
    ? selectedSandboxProfileVersion.version
    : activeSelectedProfileVersion;
  const selectedProfileAutomationConfigQuery = useQuery({
    queryKey: sandboxProfileVersionAutomationConfigQueryKey({
      profileId: selectedProfileId,
      version: effectiveSelectedProfileVersion ?? MissingProfileVersionQueryId,
    }),
    queryFn: async ({ signal }) => {
      if (effectiveSelectedProfileVersion === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionAutomationConfig({
        profileId: selectedProfileId,
        version: effectiveSelectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId.length > 0 && effectiveSelectedProfileVersion !== null,
    retry: false,
  });
  const selectedProfileAutomationConfig = selectedProfileAutomationConfigQuery.data;
  const hasLoadedSelectedProfileAutomationConfig = selectedProfileAutomationConfig !== undefined;
  const selectedProfileRepositoryOptions = selectedProfileAutomationConfig?.repositoryOptions ?? [];
  const primaryRepositoryOptions = useMemo(
    () =>
      buildWebhookAutomationPrimaryRepositoryOptions({
        repositoryOptions: selectedProfileRepositoryOptions,
      }),
    [selectedProfileRepositoryOptions],
  );

  useEffect(() => {
    setFormValues((currentValues) => {
      const normalizedPrimaryRepositoryId = resolvePrimaryRepositorySelectionNormalization({
        currentValues,
        selectedProfileId,
        hasLoadedAutomationConfig: hasLoadedSelectedProfileAutomationConfig,
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
    hasLoadedSelectedProfileAutomationConfig,
    selectedProfileAutomationConfig,
    selectedProfileId,
  ]);

  const createMutation = useMutation({
    mutationFn: async (values: ScheduledAutomationFormValues) =>
      createScheduledAutomation({
        payload: toCreateScheduledAutomationPayload(values),
      }),
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery({
        queryClient,
        automationId: automation.id,
      });
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/automations/schedules/${automation.id}`
          : input.createSuccessPath(automation),
      );
    },
    onError: (error: unknown) => {
      setFormError(
        resolveAutomationMutationErrorMessage({
          error,
          fallbackMessage: "Could not create automation.",
        }),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ScheduledAutomationFormValues) => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return updateScheduledAutomation({
        payload: {
          automationId: input.automationId,
          payload: toUpdateScheduledAutomationPayload(values, {
            initialValues: savedFormValues,
          }),
        },
      });
    },
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      const nextFormValues = toScheduledAutomationFormValues(automation);
      setFormValues(nextFormValues);
      setSavedFormValues(nextFormValues);
      setFieldErrors({});
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery({
        queryClient,
        automationId: automation.id,
      });
    },
    onError: (error: unknown) => {
      setFormError(
        resolveAutomationMutationErrorMessage({
          error,
          fallbackMessage: "Could not update automation.",
        }),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return deleteScheduledAutomation({
        automationId: input.automationId,
      });
    },
    onSuccess: async () => {
      await invalidateAutomationsQuery({
        queryClient,
        automationId: input.automationId,
      });
      await input.navigate(input.deleteSuccessPath ?? "/automations");
    },
    onError: (error: unknown) => {
      setDeleteError(
        resolveAutomationMutationErrorMessage({
          error,
          fallbackMessage: "Could not delete automation.",
        }),
      );
    },
  });

  function onValueChange(key: ScheduledAutomationFormValueKey, value: string | boolean): void {
    const nextValues = applyScheduledAutomationValueChange({
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
    const nextFieldErrors = validateScheduledAutomationFormValues(formValues);
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
    sandboxProfileOptions: input.sandboxProfileOptions,
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
