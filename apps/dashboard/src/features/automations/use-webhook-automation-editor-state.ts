import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionAutomationConfig,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersionIntegrationBinding } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { AutomationCreateSuccessPath } from "./automation-editor-navigation.js";
import type { AutomationFormShellStatusMessage } from "./automation-form-shell.js";
import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./automations-query-keys.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type { WebhookAutomationFormValues } from "./webhook-automation-form-types.js";
import {
  buildWebhookAutomationPrimaryRepositoryOptions,
  buildWebhookAutomationEventOptions,
  createWebhookAutomationTriggerId,
  resolveEligibleProfileAutomationConnectionIds,
  WebhookAutomationWorkspaceRootRepositoryOptionValue,
} from "./webhook-automation-option-builders.js";
import {
  resolveSelectedWebhookAutomationEventOptions,
  type WebhookAutomationTriggerPickerDisabledState,
} from "./webhook-automation-trigger-picker-state.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import {
  createWebhookAutomation,
  deleteWebhookAutomation,
  updateWebhookAutomation,
} from "./webhook-automations-service.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type DirectoryData = {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
};

type WebhookAutomationOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

type SelectedProfileTriggerState = {
  selectableConnectionIds: readonly string[];
  disabledState: WebhookAutomationTriggerPickerDisabledState | null;
};

const NoProfileSelectedMessage = "Select a sandbox profile to choose events.";
const LoadProfileBindingsErrorMessage = "Could not load profile bindings.";
const RequiredFieldSummaryMessage = "Please address the fields highlighted in red.";
const RequiredTriggerSelectionMessage = "Please add an event";
const MissingProfileVersionQueryId = 0;

export function resolveNoActiveProfileVersionMessage(input: {
  selectedProfileId: string;
  selectedProfileName?: string | undefined;
}): string {
  return `The sandbox profile ${input.selectedProfileName ?? input.selectedProfileId} has no active version. Publish the profile before creating automations.`;
}

function resolveActiveVersion(versions: readonly SandboxProfileVersion[]): number | null {
  const activeVersion = versions.find((version) => version.isActive);
  return activeVersion?.version ?? null;
}

function hasRequiredFieldErrors(
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>,
): boolean {
  return (
    fieldErrors.name !== undefined ||
    fieldErrors.sandboxProfileId !== undefined ||
    fieldErrors.inputTemplate !== undefined ||
    fieldErrors.triggerIds === RequiredTriggerSelectionMessage
  );
}

export function resolveSelectedProfileTriggerState(input: {
  selectedProfileId: string;
  selectedProfileName?: string | undefined;
  hasActiveProfileVersion: boolean | null;
  hasBindingData: boolean;
  isBindingDataPending: boolean;
  bindingErrorMessage: string | null;
  bindings: readonly SandboxProfileVersionIntegrationBinding[];
  directoryData: DirectoryData;
}): SelectedProfileTriggerState {
  if (input.selectedProfileId.trim().length === 0) {
    return {
      selectableConnectionIds: [],
      disabledState: {
        reason: NoProfileSelectedMessage,
        variant: "default",
      },
    };
  }

  if (input.bindingErrorMessage !== null) {
    return {
      selectableConnectionIds: [],
      disabledState: {
        reason: input.bindingErrorMessage,
        variant: "alert",
      },
    };
  }

  if (input.hasActiveProfileVersion === false) {
    return {
      selectableConnectionIds: [],
      disabledState: {
        reason: "Select a sandbox profile with an active version to choose events.",
        variant: "default",
      },
    };
  }

  if (input.isBindingDataPending || !input.hasBindingData) {
    return {
      selectableConnectionIds: [],
      disabledState: {
        reason: "Loading profile bindings...",
        variant: "default",
      },
    };
  }

  const selectableConnectionIds = resolveEligibleProfileAutomationConnectionIds({
    bindings: input.bindings,
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
  });

  return {
    selectableConnectionIds,
    disabledState:
      selectableConnectionIds.length === 0
        ? {
            reason: `The sandbox profile ${input.selectedProfileName ?? input.selectedProfileId} has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event automation.`,
            variant: "default",
          }
        : null,
  };
}

function resolveSelectedProfileBindingsErrorMessage(input: {
  versionError: unknown;
  bindingsError: unknown;
}): string | null {
  const selectedProfileBindingsError = input.versionError ?? input.bindingsError;
  if (selectedProfileBindingsError === null) {
    return null;
  }

  return resolveApiErrorMessage({
    error: selectedProfileBindingsError,
    fallbackMessage: LoadProfileBindingsErrorMessage,
  });
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

async function invalidateAutomationsQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
  });
}

function applyWebhookAutomationValueChange(input: {
  values: WebhookAutomationFormValues;
  key: keyof WebhookAutomationFormValues;
  value: string | boolean | string[] | WebhookAutomationFormValues["triggerParameterValues"];
  eventOptions: readonly WebhookAutomationEventOption[];
}): WebhookAutomationFormValues {
  const nextValues: WebhookAutomationFormValues = {
    ...input.values,
    [input.key]: input.value,
  };

  if (input.key === "triggerIds") {
    nextValues.triggerParameterValues = Object.fromEntries(
      nextValues.triggerIds.map((triggerId) => [
        triggerId,
        nextValues.triggerParameterValues[triggerId] ?? {},
      ]),
    );
    nextValues.conversationKeyTemplate = resolveNormalizedConversationKeyTemplate({
      values: nextValues,
      eventOptions: input.eventOptions,
    });
  }

  if (input.key === "sandboxProfileId") {
    return applySandboxProfileSelectionChange({
      values: nextValues,
      eventOptions: input.eventOptions,
    });
  }

  return nextValues;
}

function applySandboxProfileSelectionChange(input: {
  values: WebhookAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): WebhookAutomationFormValues {
  return {
    ...input.values,
    primaryRepositoryId: "",
    conversationKeyTemplate: resolveNormalizedConversationKeyTemplate({
      values: input.values,
      eventOptions: input.eventOptions,
    }),
  };
}

type LoadedWebhookAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
  createSuccessPath?: AutomationCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: WebhookAutomationFormValues;
  initialSandboxProfileVersion?: number;
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  directoryData: DirectoryData;
  preservedWebhookSourceId?: string;
};

type SelectedSandboxProfileVersion = {
  profileId: string;
  version: number;
};

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: WebhookAutomationFormValues;
  selectedProfileId: string;
  hasLoadedAutomationConfig: boolean;
  primaryRepositoryOptions: readonly WebhookAutomationOption[];
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

function resolveNormalizedConversationKeyTemplate(input: {
  values: WebhookAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): string {
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.values.triggerIds,
  });
  const conversationKeyFieldOptions = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.values.conversationKeyTemplate,
  });

  if (conversationKeyFieldOptions.options.length === 0) {
    return input.values.conversationKeyTemplate;
  }

  if (conversationKeyFieldOptions.hasUnsupportedCurrentTemplate) {
    return "";
  }

  if (
    input.values.conversationKeyTemplate.trim().length === 0 ||
    conversationKeyFieldOptions.selectedTemplate.length === 0
  ) {
    return conversationKeyFieldOptions.options[0]?.template ?? "";
  }

  return input.values.conversationKeyTemplate;
}

export function resolveWebhookAutomationEditInitialValues(input: {
  automation: WebhookAutomation;
  directoryData: DirectoryData;
}): WebhookAutomationFormValues {
  const automationTriggerIds = (input.automation.eventTypes ?? []).map((eventType) =>
    createWebhookAutomationTriggerId({
      webhookSourceId: input.automation.integrationWebhookSourceId,
      eventType,
    }),
  );
  const preservedConnectionId =
    input.directoryData.webhookSources.find(
      (source) => source.id === input.automation.integrationWebhookSourceId,
    )?.integrationConnectionId ?? undefined;
  const hydrationEventOptions = buildWebhookAutomationEventOptions({
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
    webhookSources: input.directoryData.webhookSources,
    ...(preservedConnectionId === undefined ? {} : { preservedConnectionId }),
    selectedTriggerIds: automationTriggerIds,
  });

  return toWebhookAutomationFormValues(input.automation, hydrationEventOptions);
}

export function useLoadedWebhookAutomationEditorState(
  input: LoadedWebhookAutomationEditorStateInput,
): {
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  primaryRepositoryOptions: readonly WebhookAutomationOption[];
  sandboxProfileStatusMessage?: AutomationFormShellStatusMessage | undefined;
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledState: WebhookAutomationTriggerPickerDisabledState | null;
  values: WebhookAutomationFormValues;
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>;
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
  onValueChange: (
    key: keyof WebhookAutomationFormValues,
    value: string | boolean | string[] | WebhookAutomationFormValues["triggerParameterValues"],
  ) => void;
} {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState(input.initialValues);
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
    Partial<Record<keyof WebhookAutomationFormValues, string>>
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
  const hasActiveProfileVersion =
    selectedProfileId.length === 0
      ? null
      : isUsingPinnedSelectedProfileVersion
        ? true
        : selectedProfileVersionsQuery.data === undefined
          ? null
          : activeSelectedProfileVersion !== null;
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
  const selectedProfileBindingsErrorMessage = resolveSelectedProfileBindingsErrorMessage({
    versionError: isUsingPinnedSelectedProfileVersion ? null : selectedProfileVersionsQuery.error,
    bindingsError: selectedProfileAutomationConfigQuery.error,
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
  const selectedProfileName = input.sandboxProfileOptions.find(
    (option) => option.value === selectedProfileId,
  )?.label;
  const selectedProfileTriggerState = useMemo(
    () =>
      resolveSelectedProfileTriggerState({
        selectedProfileId,
        selectedProfileName,
        hasActiveProfileVersion,
        hasBindingData: hasLoadedSelectedProfileAutomationConfig,
        isBindingDataPending:
          selectedProfileId.length > 0 &&
          ((isUsingPinnedSelectedProfileVersion ? false : selectedProfileVersionsQuery.isPending) ||
            (effectiveSelectedProfileVersion !== null &&
              selectedProfileAutomationConfigQuery.isPending)),
        bindingErrorMessage: selectedProfileBindingsErrorMessage,
        bindings: selectedProfileAutomationConfig?.bindings ?? [],
        directoryData: input.directoryData,
      }),
    [
      effectiveSelectedProfileVersion,
      hasActiveProfileVersion,
      hasLoadedSelectedProfileAutomationConfig,
      input.directoryData,
      isUsingPinnedSelectedProfileVersion,
      selectedProfileAutomationConfig,
      selectedProfileAutomationConfigQuery.isPending,
      selectedProfileBindingsErrorMessage,
      selectedProfileId,
      selectedProfileName,
      selectedProfileVersionsQuery.isPending,
    ],
  );
  const sandboxProfileStatusMessage =
    hasActiveProfileVersion === false
      ? {
          message: resolveNoActiveProfileVersionMessage({
            selectedProfileId,
            selectedProfileName,
          }),
          variant: "alert" as const,
        }
      : undefined;
  const preservedConnectionId =
    input.preservedWebhookSourceId === undefined
      ? undefined
      : input.directoryData.webhookSources.find(
          (source) => source.id === input.preservedWebhookSourceId,
        )?.integrationConnectionId;

  const webhookEventOptions = useMemo(
    () =>
      buildWebhookAutomationEventOptions({
        connections: input.directoryData.connections,
        targets: input.directoryData.targets,
        webhookSources: input.directoryData.webhookSources,
        selectableConnectionIds: selectedProfileTriggerState.selectableConnectionIds,
        ...(preservedConnectionId === undefined ? {} : { preservedConnectionId }),
        selectedTriggerIds: formValues.triggerIds,
      }),
    [
      formValues.triggerIds,
      input.directoryData,
      preservedConnectionId,
      selectedProfileTriggerState.selectableConnectionIds,
    ],
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
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values, webhookEventOptions),
      }),
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery(queryClient);
      await input.navigate(
        input.createSuccessPath === undefined
          ? `/automations/${automation.id}`
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
    mutationFn: async (values: WebhookAutomationFormValues) => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return updateWebhookAutomation({
        payload: {
          automationId: input.automationId,
          payload: toUpdateWebhookAutomationPayload(values, webhookEventOptions),
        },
      });
    },
    onSuccess: async (automation) => {
      setSelectedSandboxProfileVersion({
        profileId: automation.target.sandboxProfileId,
        version: automation.target.sandboxProfileVersion,
      });
      setFormValues(toWebhookAutomationFormValues(automation, webhookEventOptions));
      setFieldErrors({});
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateAutomationsQuery(queryClient);
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

      return deleteWebhookAutomation({
        automationId: input.automationId,
      });
    },
    onSuccess: async () => {
      await invalidateAutomationsQuery(queryClient);
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

  function onValueChange(
    key: keyof WebhookAutomationFormValues,
    value: string | boolean | string[] | WebhookAutomationFormValues["triggerParameterValues"],
  ): void {
    const nextValues = applyWebhookAutomationValueChange({
      values: formValues,
      key,
      value,
      eventOptions: webhookEventOptions,
    });

    if (key === "sandboxProfileId") {
      setSelectedSandboxProfileVersion(null);
    }

    setFormValues(nextValues);
    setFieldErrors((currentErrors) => {
      if (key === "sandboxProfileId") {
        const {
          sandboxProfileId: _sandboxProfileId,
          triggerIds: _triggerIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _sandboxProfileId;
        void _triggerIds;
        void _conversationKeyTemplate;

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
    const nextFieldErrors = validateWebhookAutomationFormValues(formValues, webhookEventOptions);
    if (hasActiveProfileVersion === false) {
      nextFieldErrors.sandboxProfileId = resolveNoActiveProfileVersionMessage({
        selectedProfileId,
        selectedProfileName,
      });
    }
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
    connectionOptions: input.connectionOptions,
    sandboxProfileOptions: input.sandboxProfileOptions,
    primaryRepositoryOptions,
    sandboxProfileStatusMessage,
    webhookEventOptions,
    triggerPickerDisabledState: selectedProfileTriggerState.disabledState,
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
