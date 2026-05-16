import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { sandboxProfileVersionTriggerConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfileVersionTriggerConfig } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersionIntegrationBinding } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { TriggerCreateSuccessPath } from "./trigger-editor-navigation.js";
import type { TriggerFormShellStatusMessage } from "./trigger-form-shell.js";
import { TRIGGERS_QUERY_KEY_PREFIX } from "./triggers-query-keys.js";
import { useSelectedSandboxProfileVersion } from "./use-selected-sandbox-profile-version.js";
import { resolveConversationKeyFieldOptions } from "./webhook-trigger-conversation-key-field.js";
import {
  resolveSelectedWebhookTriggerEventOptions,
  type WebhookTriggerEventPickerDisabledState,
} from "./webhook-trigger-event-picker-state.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import {
  toCreateWebhookTriggerPayload,
  toUpdateWebhookTriggerPayload,
  toWebhookTriggerFormValues,
  validateWebhookTriggerFormValues,
} from "./webhook-trigger-form-helpers.js";
import type {
  WebhookTriggerFormOption,
  WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import {
  buildWebhookTriggerPrimaryRepositoryOptions,
  buildWebhookTriggerEventOptions,
  createWebhookTriggerEventId,
  resolveEligibleProfileTriggerConnectionIds,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
  withSelectedSandboxProfileOptionVersion,
} from "./webhook-trigger-option-builders.js";
import {
  createWebhookTrigger,
  deleteWebhookTrigger,
  updateWebhookTrigger,
} from "./webhook-triggers-service.js";
import type { WebhookTrigger } from "./webhook-triggers-types.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type DirectoryData = {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
  webhookSources: readonly IntegrationWebhookSource[];
};

type SelectedProfileTriggerState = {
  selectableConnectionIds: readonly string[];
  disabledState: WebhookTriggerEventPickerDisabledState | null;
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
  return `The sandbox profile ${input.selectedProfileName ?? input.selectedProfileId} has no active version. Publish the profile before creating triggers.`;
}

function hasRequiredFieldErrors(
  fieldErrors: Partial<Record<keyof WebhookTriggerFormValues, string>>,
): boolean {
  return (
    fieldErrors.name !== undefined ||
    fieldErrors.sandboxProfileId !== undefined ||
    fieldErrors.inputTemplate !== undefined ||
    fieldErrors.eventIds === RequiredTriggerSelectionMessage
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

  const selectableConnectionIds = resolveEligibleProfileTriggerConnectionIds({
    bindings: input.bindings,
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
  });

  return {
    selectableConnectionIds,
    disabledState:
      selectableConnectionIds.length === 0
        ? {
            reason: `The sandbox profile ${input.selectedProfileName ?? input.selectedProfileId} has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.`,
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

function resolveTriggerMutationErrorMessage(input: {
  error: unknown;
  fallbackMessage: string;
}): string {
  return resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: input.fallbackMessage,
  });
}

async function invalidateTriggersQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: TRIGGERS_QUERY_KEY_PREFIX,
  });
}

function applyWebhookTriggerValueChange(input: {
  values: WebhookTriggerFormValues;
  key: keyof WebhookTriggerFormValues;
  value: string | boolean | string[] | WebhookTriggerFormValues["eventParameterValues"];
  eventOptions: readonly WebhookTriggerEventOption[];
}): WebhookTriggerFormValues {
  const nextValues: WebhookTriggerFormValues = {
    ...input.values,
    [input.key]: input.value,
  };

  if (input.key === "eventIds") {
    nextValues.eventParameterValues = Object.fromEntries(
      nextValues.eventIds.map((triggerId) => [
        triggerId,
        nextValues.eventParameterValues[triggerId] ?? {},
      ]),
    );
  }

  if (input.key === "eventIds" || input.key === "eventParameterValues") {
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
  values: WebhookTriggerFormValues;
  eventOptions: readonly WebhookTriggerEventOption[];
}): WebhookTriggerFormValues {
  return {
    ...input.values,
    primaryRepositoryId: "",
    conversationKeyTemplate: resolveNormalizedConversationKeyTemplate({
      values: input.values,
      eventOptions: input.eventOptions,
    }),
  };
}

type LoadedWebhookTriggerEditorStateInput = {
  mode: "create" | "edit";
  triggerId: string | undefined;
  navigate: NavigateFunction;
  createSuccessPath?: TriggerCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: WebhookTriggerFormValues;
  initialSandboxProfileVersion?: number;
  connectionOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileOptions: readonly WebhookTriggerFormOption[];
  directoryData: DirectoryData;
  preservedWebhookSourceId?: string;
};

function resolvePrimaryRepositorySelectionNormalization(input: {
  currentValues: WebhookTriggerFormValues;
  selectedProfileId: string;
  hasLoadedTriggerConfig: boolean;
  primaryRepositoryOptions: readonly WebhookTriggerFormOption[];
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

function resolveNormalizedConversationKeyTemplate(input: {
  values: WebhookTriggerFormValues;
  eventOptions: readonly WebhookTriggerEventOption[];
}): string {
  const selectedTriggerOptions = resolveSelectedWebhookTriggerEventOptions({
    eventOptions: input.eventOptions,
    selectedEventIds: input.values.eventIds,
  });
  const conversationKeyFieldOptions = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.values.conversationKeyTemplate,
    eventParameterValues: input.values.eventParameterValues,
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

export function resolveWebhookTriggerEditInitialValues(input: {
  trigger: WebhookTrigger;
  directoryData: DirectoryData;
}): WebhookTriggerFormValues {
  const triggerEventIds = (input.trigger.eventTypes ?? []).map((eventType) =>
    createWebhookTriggerEventId({
      webhookSourceId: input.trigger.integrationWebhookSourceId,
      eventType,
    }),
  );
  const preservedConnectionId =
    input.directoryData.webhookSources.find(
      (source) => source.id === input.trigger.integrationWebhookSourceId,
    )?.integrationConnectionId ?? undefined;
  const hydrationEventOptions = buildWebhookTriggerEventOptions({
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
    webhookSources: input.directoryData.webhookSources,
    ...(preservedConnectionId === undefined ? {} : { preservedConnectionId }),
    selectedEventIds: triggerEventIds,
  });

  return toWebhookTriggerFormValues(input.trigger, hydrationEventOptions);
}

export function useLoadedWebhookTriggerEditorState(input: LoadedWebhookTriggerEditorStateInput): {
  connectionOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileOptions: readonly WebhookTriggerFormOption[];
  primaryRepositoryOptions: readonly WebhookTriggerFormOption[];
  sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  triggerPickerDisabledState: WebhookTriggerEventPickerDisabledState | null;
  values: WebhookTriggerFormValues;
  fieldErrors: Partial<Record<keyof WebhookTriggerFormValues, string>>;
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
    key: keyof WebhookTriggerFormValues,
    value: string | boolean | string[] | WebhookTriggerFormValues["eventParameterValues"],
  ) => void;
} {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState(input.initialValues);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof WebhookTriggerFormValues, string>>
  >({});
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const {
    effectiveSelectedProfileVersion,
    hasActiveProfileVersion,
    isUsingPinnedSelectedProfileVersion,
    selectedProfileVersionsQuery,
    setSelectedSandboxProfileVersion,
  } = useSelectedSandboxProfileVersion({
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
  const selectedProfileBindingsErrorMessage = resolveSelectedProfileBindingsErrorMessage({
    versionError: isUsingPinnedSelectedProfileVersion ? null : selectedProfileVersionsQuery.error,
    bindingsError: selectedProfileTriggerConfigQuery.error,
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
  const selectedProfileName = sandboxProfileOptions.find(
    (option) => option.value === selectedProfileId,
  )?.label;
  const selectedProfileTriggerState = useMemo(
    () =>
      resolveSelectedProfileTriggerState({
        selectedProfileId,
        selectedProfileName,
        hasActiveProfileVersion,
        hasBindingData: hasLoadedSelectedProfileTriggerConfig,
        isBindingDataPending:
          selectedProfileId.length > 0 &&
          ((isUsingPinnedSelectedProfileVersion ? false : selectedProfileVersionsQuery.isPending) ||
            (effectiveSelectedProfileVersion !== null &&
              selectedProfileTriggerConfigQuery.isPending)),
        bindingErrorMessage: selectedProfileBindingsErrorMessage,
        bindings: selectedProfileTriggerConfig?.bindings ?? [],
        directoryData: input.directoryData,
      }),
    [
      effectiveSelectedProfileVersion,
      hasActiveProfileVersion,
      hasLoadedSelectedProfileTriggerConfig,
      input.directoryData,
      isUsingPinnedSelectedProfileVersion,
      selectedProfileTriggerConfig,
      selectedProfileTriggerConfigQuery.isPending,
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
      buildWebhookTriggerEventOptions({
        connections: input.directoryData.connections,
        targets: input.directoryData.targets,
        webhookSources: input.directoryData.webhookSources,
        selectableConnectionIds: selectedProfileTriggerState.selectableConnectionIds,
        ...(preservedConnectionId === undefined ? {} : { preservedConnectionId }),
        selectedEventIds: formValues.eventIds,
      }),
    [
      formValues.eventIds,
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
    mutationFn: async (values: WebhookTriggerFormValues) =>
      createWebhookTrigger({
        payload: toCreateWebhookTriggerPayload(values, webhookEventOptions),
      }),
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery(queryClient);
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
    mutationFn: async (values: WebhookTriggerFormValues) => {
      if (input.triggerId === undefined) {
        throw new Error("Trigger id is required.");
      }

      return updateWebhookTrigger({
        payload: {
          triggerId: input.triggerId,
          payload: toUpdateWebhookTriggerPayload(values, webhookEventOptions),
        },
      });
    },
    onSuccess: async (trigger) => {
      setSelectedSandboxProfileVersion({
        profileId: trigger.target.sandboxProfileId,
        version: trigger.target.sandboxProfileVersion,
      });
      setFormValues(toWebhookTriggerFormValues(trigger, webhookEventOptions));
      setFieldErrors({});
      setValidationSummaryError(null);
      setFormError(null);
      await invalidateTriggersQuery(queryClient);
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

      return deleteWebhookTrigger({
        triggerId: input.triggerId,
      });
    },
    onSuccess: async () => {
      await invalidateTriggersQuery(queryClient);
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

  function onValueChange(
    key: keyof WebhookTriggerFormValues,
    value: string | boolean | string[] | WebhookTriggerFormValues["eventParameterValues"],
  ): void {
    const nextValues = applyWebhookTriggerValueChange({
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
          eventIds: _eventIds,
          conversationKeyTemplate: _conversationKeyTemplate,
          ...remainingErrors
        } = currentErrors;

        void _sandboxProfileId;
        void _eventIds;
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
    const nextFieldErrors = validateWebhookTriggerFormValues(formValues, webhookEventOptions);
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
    sandboxProfileOptions,
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
