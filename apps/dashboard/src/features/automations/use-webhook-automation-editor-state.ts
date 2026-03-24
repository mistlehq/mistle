import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { resolveLatestVersion } from "../pages/sandbox-profile-integrations-state.js";
import {
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionIntegrationBindings,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfileVersionIntegrationBinding } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-form.js";
import {
  buildWebhookAutomationEventOptions,
  createWebhookAutomationTriggerId,
  resolveEligibleProfileAutomationConnectionIds,
} from "./webhook-automation-list-helpers.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./webhook-automations-query-keys.js";
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
};

type WebhookAutomationOption = {
  value: string;
  label: string;
  description?: string;
};

type SelectedProfileTriggerState = {
  eligibleConnectionIds: readonly string[];
  disabledReason: string | null;
};

const NoProfileSelectedMessage = "Select a sandbox profile to choose triggers.";
const InvalidProfileBindingMessage =
  "The selected profile has no bindings with automation triggers.";
const LoadProfileBindingsErrorMessage = "Could not load profile bindings.";
const UnselectedProfileQueryId = "__unselected__";
const MissingProfileVersionQueryId = 0;

export function resolveSelectedProfileTriggerState(input: {
  selectedProfileId: string;
  hasBindingData: boolean;
  isBindingDataPending: boolean;
  bindingErrorMessage: string | null;
  bindings: readonly SandboxProfileVersionIntegrationBinding[];
  directoryData: DirectoryData;
}): SelectedProfileTriggerState {
  if (input.selectedProfileId.trim().length === 0) {
    return {
      eligibleConnectionIds: [],
      disabledReason: NoProfileSelectedMessage,
    };
  }

  if (input.bindingErrorMessage !== null) {
    return {
      eligibleConnectionIds: [],
      disabledReason: input.bindingErrorMessage,
    };
  }

  if (input.isBindingDataPending || !input.hasBindingData) {
    return {
      eligibleConnectionIds: [],
      disabledReason: "Loading profile bindings...",
    };
  }

  const eligibleConnectionIds = resolveEligibleProfileAutomationConnectionIds({
    bindings: input.bindings,
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
  });

  return {
    eligibleConnectionIds,
    disabledReason: eligibleConnectionIds.length === 0 ? InvalidProfileBindingMessage : null,
  };
}

function resolveSelectedProfileQueryId(selectedProfileId: string): string {
  return selectedProfileId.length === 0 ? UnselectedProfileQueryId : selectedProfileId;
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

function useSelectedProfileTriggerState(input: {
  selectedProfileId: string;
  directoryData: DirectoryData;
}): SelectedProfileTriggerState {
  const selectedProfileQueryId = resolveSelectedProfileQueryId(input.selectedProfileId);

  const selectedProfileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(selectedProfileQueryId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: input.selectedProfileId,
        signal,
      }),
    enabled: input.selectedProfileId.length > 0,
    retry: false,
  });

  const selectedProfileVersion = useMemo(
    () => resolveLatestVersion(selectedProfileVersionsQuery.data?.versions ?? []),
    [selectedProfileVersionsQuery.data],
  );

  const selectedProfileBindingsQuery = useQuery({
    queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
      profileId: selectedProfileQueryId,
      version: selectedProfileVersion ?? MissingProfileVersionQueryId,
    }),
    queryFn: async ({ signal }) => {
      if (selectedProfileVersion === null) {
        throw new Error("No sandbox profile version is available for this profile.");
      }

      return getSandboxProfileVersionIntegrationBindings({
        profileId: input.selectedProfileId,
        version: selectedProfileVersion,
        signal,
      });
    },
    enabled: input.selectedProfileId.length > 0 && selectedProfileVersion !== null,
    retry: false,
  });

  return useMemo(
    () =>
      resolveSelectedProfileTriggerState({
        selectedProfileId: input.selectedProfileId,
        hasBindingData:
          selectedProfileVersion === null || selectedProfileBindingsQuery.data !== undefined,
        isBindingDataPending:
          input.selectedProfileId.length > 0 &&
          (selectedProfileVersionsQuery.isPending || selectedProfileBindingsQuery.isPending),
        bindingErrorMessage: resolveSelectedProfileBindingsErrorMessage({
          versionError: selectedProfileVersionsQuery.error,
          bindingsError: selectedProfileBindingsQuery.error,
        }),
        bindings: selectedProfileBindingsQuery.data?.bindings ?? [],
        directoryData: input.directoryData,
      }),
    [
      input.directoryData,
      input.selectedProfileId,
      selectedProfileBindingsQuery.data,
      selectedProfileBindingsQuery.error,
      selectedProfileBindingsQuery.isPending,
      selectedProfileVersion,
      selectedProfileVersionsQuery.error,
      selectedProfileVersionsQuery.isPending,
    ],
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
    nextValues.conversationKeyTemplate = resolveNormalizedConversationKeyTemplate({
      values: nextValues,
      eventOptions: input.eventOptions,
    });
  }

  if (input.key === "sandboxProfileId") {
    nextValues.triggerIds = [];
    nextValues.triggerParameterValues = {};
    nextValues.conversationKeyTemplate = "";
  }

  return nextValues;
}

type LoadedWebhookAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
  initialValues: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  directoryData: DirectoryData;
  preservedConnectionId?: string;
};

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
      connectionId: input.automation.integrationConnectionId,
      eventType,
    }),
  );
  const hydrationEventOptions = buildWebhookAutomationEventOptions({
    connections: input.directoryData.connections,
    targets: input.directoryData.targets,
    preservedConnectionId: input.automation.integrationConnectionId,
    selectedTriggerIds: automationTriggerIds,
  });

  return toWebhookAutomationFormValues(input.automation, hydrationEventOptions);
}

export function useLoadedWebhookAutomationEditorState(
  input: LoadedWebhookAutomationEditorStateInput,
): {
  connectionOptions: readonly WebhookAutomationOption[];
  sandboxProfileOptions: readonly WebhookAutomationOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  triggerPickerDisabledReason: string | null;
  values: WebhookAutomationFormValues;
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>;
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
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof WebhookAutomationFormValues, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selectedProfileId = formValues.sandboxProfileId.trim();
  const selectedProfileTriggerState = useSelectedProfileTriggerState({
    selectedProfileId,
    directoryData: input.directoryData,
  });

  const webhookEventOptions = useMemo(
    () =>
      buildWebhookAutomationEventOptions({
        connections: input.directoryData.connections.filter((connection) =>
          selectedProfileTriggerState.eligibleConnectionIds.includes(connection.id),
        ),
        targets: input.directoryData.targets,
        ...(input.preservedConnectionId === undefined
          ? {}
          : { preservedConnectionId: input.preservedConnectionId }),
        selectedTriggerIds: formValues.triggerIds,
      }),
    [
      formValues.triggerIds,
      input.directoryData,
      input.preservedConnectionId,
      selectedProfileTriggerState.eligibleConnectionIds,
    ],
  );

  const createMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values, webhookEventOptions),
      }),
    onSuccess: async (automation) => {
      setFormError(null);
      await invalidateAutomationsQuery(queryClient);
      await input.navigate(`/automations/${automation.id}`);
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
      setFormValues(toWebhookAutomationFormValues(automation, webhookEventOptions));
      setFieldErrors({});
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
      await input.navigate("/automations");
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

    setFormValues(nextValues);
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      [key]: undefined,
    }));
    setFormError(null);
  }

  function onSubmit(): void {
    const nextFieldErrors = validateWebhookAutomationFormValues(formValues, webhookEventOptions);
    setFieldErrors(nextFieldErrors);
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
    webhookEventOptions,
    triggerPickerDisabledReason: selectedProfileTriggerState.disabledReason,
    values: formValues,
    fieldErrors,
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
